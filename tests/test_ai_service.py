"""Unit tests for the OpenAI Responses adapter without a network connection."""

import asyncio
import json
import unittest
from unittest.mock import patch

import httpx

from backend.services.ai_service import (
    MAX_CONTEXT_CHARS,
    MAX_CONTEXT_MESSAGES,
    AIServiceUnavailable,
    OpenAIResponsesService,
    GeminiService,
    ai_configuration,
    get_ai_service,
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

    async def test_incomplete_or_interrupted_openai_stream_is_not_success(self):
        for ending in ("", 'data: {"type":"response.incomplete"}\n\n',
                       'data: {"type":"response.failed","response":{"error":{"code":"server_error"}}}\n\n',
                       'data: ["invalid"]\n\n'):
            with self.subTest(ending=ending):
                events = 'data: {"type":"response.output_text.delta","delta":"Partial answer"}\n\n' + ending
                service = OpenAIResponsesService("secret", "test-model", transport=httpx.MockTransport(lambda _: httpx.Response(200, text=events)))
                with self.assertRaises(AIServiceUnavailable):
                    await service.reply([{"role": "user", "content": "hello"}])

    async def test_gemini_stream_maps_history_ignores_thought_and_reports_provider(self):
        received = {}
        def responder(request):
            received["url"] = str(request.url)
            received["key"] = request.headers.get("x-goog-api-key")
            received["body"] = json.loads(request.content)
            return httpx.Response(200, text=(
                'data: {"candidates":[{"content":{"parts":[{"text":"private thought","thought":true},{"text":"Xin "}]}}]}\r\n\r\n'
                'data: {"candidates":[{"content":{"parts":[{"text":"chào!"}]},"finishReason":"STOP"}]}'
            ))
        service = GeminiService("server-secret", "gemini-3.8-flash", transport=httpx.MockTransport(responder))
        reply = await service.reply([{"role": "user", "content": "Hi"}, {"role": "assistant", "content": "Hello"}, {"role": "user", "content": "Tiếp tục"}])
        self.assertEqual((reply.text, reply.provider, reply.model), ("Xin chào!", "gemini", "gemini-3.8-flash"))
        self.assertNotIn("server-secret", received["url"])
        self.assertEqual(received["key"], "server-secret")
        self.assertEqual([item["role"] for item in received["body"]["contents"]], ["user", "model", "user"])
        self.assertIn("systemInstruction", received["body"])
        self.assertNotIn("server-secret", json.dumps(received["body"]))

    async def test_gemini_errors_blocks_and_interrupted_stream(self):
        for status, body, kind in (
            (403, "private provider details", "invalid_key"),
            (404, "private provider details", "invalid_model"),
            (429, "private provider details", "rate_limited"),
            (200, 'data: {"promptFeedback":{"blockReason":"SAFETY"}}\n\n', "blocked_response"),
            (200, 'data: {"candidates":[{"finishReason":"MAX_TOKENS"}]}\n\n', "incomplete_response"),
            (200, 'data: {"candidates":[{"content":{"parts":[{"text":"partial"}]}}]}\n\n', "interrupted_stream"),
            (200, 'data: {"candidates":["bad data"]}\n\n', "invalid_response"),
        ):
            with self.subTest(kind=kind):
                service = GeminiService("secret", "gemini-3.8-flash", transport=httpx.MockTransport(lambda _: httpx.Response(status, text=body)))
                with self.assertRaises(AIServiceUnavailable) as raised:
                    await service.reply([{"role": "user", "content": "hello"}])
                self.assertEqual(raised.exception.kind, kind)
                self.assertNotIn("private provider details", str(raised.exception))

    def test_configuration_selects_correct_provider_and_does_not_return_key(self):
        for provider, model, expected in (("gemini", "gemini-3.8-flash", GeminiService), ("openai", "test-model", OpenAIResponsesService)):
            with patch.multiple("backend.services.ai_service", AI_PROVIDER=provider, AI_API_KEY="private-secret", AI_MODEL=model):
                self.assertTrue(ai_configuration()["available"])
                self.assertIsInstance(get_ai_service(), expected)
                self.assertNotIn("private-secret", json.dumps(ai_configuration()))
        with patch.multiple("backend.services.ai_service", AI_PROVIDER="gemini", AI_API_KEY="secret", AI_MODEL="../invalid"):
            self.assertFalse(ai_configuration()["available"])

    def test_history_is_limited_by_message_count_and_characters(self) -> None:
        messages = [{"role": "user", "content": str(index) * 2000} for index in range(20)]
        bounded = _bounded_context(messages)
        self.assertLessEqual(len(bounded), MAX_CONTEXT_MESSAGES)
        self.assertLessEqual(sum(len(item["content"]) for item in bounded), MAX_CONTEXT_CHARS)
        self.assertEqual(bounded[-1]["content"], "19" * 2000)

    def test_truncated_history_starts_with_user_turn(self):
        messages = [{"role": "user" if index % 2 == 0 else "assistant", "content": str(index)} for index in range(13)]
        bounded = _bounded_context(messages)
        self.assertEqual(bounded[0]["role"], "user")
        self.assertEqual(bounded[-1]["content"], "12")


if __name__ == "__main__":
    unittest.main()
