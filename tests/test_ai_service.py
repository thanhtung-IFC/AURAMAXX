"""Unit tests for the OpenAI Responses adapter without a network connection."""

import asyncio
import json
import unittest

import httpx

from backend.services.ai_service import (
    MAX_CONTEXT_CHARS,
    MAX_CONTEXT_MESSAGES,
    AIServiceUnavailable,
    OpenAIResponsesService,
    _bounded_context,
)


class AIServiceTests(unittest.IsolatedAsyncioTestCase):
    async def test_stream_uses_server_key_bounded_context_and_no_provider_storage(self) -> None:
        received: dict[str, object] = {}

        def responder(request: httpx.Request) -> httpx.Response:
            received["authorization"] = request.headers.get("Authorization")
            received["body"] = json.loads(request.content)
            events = (
                'data: {"type":"response.output_text.delta","delta":"Xin "}\n\n'
                'data: {"type":"response.output_text.delta","delta":"chào!"}\n\n'
                'data: {"type":"response.completed"}\n\n'
            )
            return httpx.Response(200, text=events, headers={"content-type": "text/event-stream"})

        service = OpenAIResponsesService("server-test-secret", "test-model", transport=httpx.MockTransport(responder))
        reply = await service.reply([
            {"role": "user", "content": "Câu hỏi cũ"},
            {"role": "assistant", "content": "Câu trả lời cũ"},
            {"role": "user", "content": "Câu hỏi mới"},
        ])

        self.assertEqual(reply.text, "Xin chào!")
        self.assertEqual(received["authorization"], "Bearer server-test-secret")
        request_body = received["body"]
        self.assertFalse(request_body["store"])
        self.assertTrue(request_body["stream"])
        self.assertEqual(request_body["model"], "test-model")
        self.assertEqual(request_body["input"][-1]["content"], "Câu hỏi mới")
        self.assertNotIn("server-test-secret", json.dumps(request_body))

    async def test_provider_rate_limit_is_mapped_without_echoing_body(self) -> None:
        def responder(_request: httpx.Request) -> httpx.Response:
            return httpx.Response(429, text='{"error":"sensitive provider details"}')

        service = OpenAIResponsesService("secret", "test-model", transport=httpx.MockTransport(responder))
        with self.assertRaises(AIServiceUnavailable) as raised:
            await service.reply([{"role": "user", "content": "hello"}])
        self.assertEqual(raised.exception.kind, "rate_limited")
        self.assertNotIn("sensitive provider details", str(raised.exception))

    async def test_timeout_is_mapped_to_clear_error(self) -> None:
        def responder(_request: httpx.Request) -> httpx.Response:
            raise httpx.ReadTimeout("private request details")

        service = OpenAIResponsesService("secret", "test-model", transport=httpx.MockTransport(responder))
        with self.assertRaises(AIServiceUnavailable) as raised:
            await service.reply([{"role": "user", "content": "hello"}])
        self.assertEqual(raised.exception.kind, "timeout")
        self.assertNotIn("private request details", str(raised.exception))

    def test_history_is_limited_by_message_count_and_characters(self) -> None:
        messages = [{"role": "user", "content": str(index) * 2000} for index in range(20)]
        bounded = _bounded_context(messages)
        self.assertLessEqual(len(bounded), MAX_CONTEXT_MESSAGES)
        self.assertLessEqual(sum(len(item["content"]) for item in bounded), MAX_CONTEXT_CHARS)
        self.assertEqual(bounded[-1]["content"], "19" * 2000)


if __name__ == "__main__":
    unittest.main()
