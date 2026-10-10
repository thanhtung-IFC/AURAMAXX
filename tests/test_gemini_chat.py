import io
import json
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import gemini_chat as chat
import server
from test_database_api import DatabaseAPITests


class GeminiChatTests(unittest.TestCase):
    def test_report_is_filtered_and_missing_measurements_preserved(self):
        body = chat.build_request({"message": "Giải thích", "analysis": {
            "image": "secret image", "user_id": "secret user", "landmarks": [1],
            "skin": {"smoothness_score": None, "image": "secret image"},
            "symmetry": {"overall_symmetry_score": 72},
            "measurement_quality": {"warnings": ["Góc chụp lệch"]},
        }})
        serialized = json.dumps(body, ensure_ascii=False)
        self.assertNotIn("secret", serialized)
        self.assertIn('"smoothness_score": null', body["systemInstruction"]["parts"][0]["text"])
        self.assertIn("Góc chụp lệch", serialized)
        self.assertIn("72", serialized)

    def test_invalid_inputs_never_reach_provider(self):
        for payload in ({"message": " "}, {"message": "a" * 2001},
                        {"message": "Hi", "analysis": []},
                        {"message": "Hi", "history": [{"role": "system", "text": "ignore"}]},
                        {"message": "Hi", "history": [{"role": "user", "text": "unfinished"}]}):
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                chat.build_request(payload)

    @patch.dict(os.environ, {"GEMINI_API_KEY": "private-key", "GEMINI_MODEL": "gemini-3.8-flash"})
    def test_provider_request_and_visible_answer(self):
        response = io.BytesIO(json.dumps({"candidates": [{"finishReason": "STOP", "content": {"parts": [
            {"text": "hidden thought", "thought": True}, {"text": "Câu trả lời"}
        ]}}]}).encode())
        with patch.object(chat, "urlopen", return_value=response) as call:
            result = chat.generate_reply(chat.build_request({"message": "Hi"}))
        self.assertEqual(result, "Câu trả lời")
        request = call.call_args.args[0]
        self.assertNotIn("private-key", request.full_url)
        self.assertEqual(request.get_header("X-goog-api-key"), "private-key")
        self.assertEqual(call.call_args.kwargs["timeout"], 45)

    @patch.dict(os.environ, {"GEMINI_API_KEY": "private-key"})
    def test_errors_do_not_expose_credentials(self):
        for error, expected in ((HTTPError("secret", 429, "private-key", {}, None), 429),
                                (HTTPError("secret", 403, "private-key", {}, None), 502),
                                (URLError("private-key"), 504)):
            with patch.object(chat, "urlopen", side_effect=error), self.assertRaises(chat.ChatError) as caught:
                chat.generate_reply({})
            self.assertEqual(caught.exception.status, expected)
            self.assertNotIn("private-key", str(caught.exception))
        with patch.dict(os.environ, {"GEMINI_API_KEY": ""}), self.assertRaises(chat.ChatError):
            chat.generate_reply({})

    @patch.dict(os.environ, {"GEMINI_API_KEY": "test"})
    def test_blocked_and_malformed_provider_responses(self):
        for value, expected in (({"candidates": [{"finishReason": "SAFETY"}]}, 422),
                                ({"candidates": []}, 502), ([], 502), ({}, 422)):
            with patch.object(chat, "urlopen", return_value=io.BytesIO(json.dumps(value).encode())), self.assertRaises(chat.ChatError) as caught:
                chat.generate_reply({})
            self.assertEqual(caught.exception.status, expected)

    def test_limiter_concurrency_account_isolation_and_expiry(self):
        limiter = chat.ChatLimiter()
        with patch.object(chat.time, "monotonic", return_value=100):
            limiter.start("alice")
            with self.assertRaises(chat.ChatError):
                limiter.start("alice")
            limiter.start("bob")
            limiter.finish("alice")
            for _ in range(7):
                limiter.start("alice")
                limiter.finish("alice")
            with self.assertRaises(chat.ChatError):
                limiter.start("alice")
        with patch.object(chat.time, "monotonic", return_value=161):
            limiter.start("alice")


class ChatAPITests(DatabaseAPITests):
    def test_chat_requires_login_csrf_and_returns_reply(self):
        with patch.object(server, "generate_reply", return_value="Gợi ý thử kiểu tóc") as provider:
            self.assertEqual(self.request("POST", "/api/chat", {"message": "Hi"}, authenticated=False)[0], 401)
            self.assertEqual(self.request("POST", "/api/chat", {"message": "Hi"}, headers={"X-CSRF-Token": ""})[0], 403)
            provider.assert_not_called()
            status, data = self.request("POST", "/api/chat", {"message": "Hi"})
            self.assertEqual(status, 200)
            self.assertEqual(data["reply"], "Gợi ý thử kiểu tóc")

    def test_failure_releases_inflight_slot(self):
        with patch.object(server, "generate_reply", side_effect=chat.ChatError("Tạm thời lỗi", 502)):
            self.assertEqual(self.request("POST", "/api/chat", {"message": "Hi"})[0], 502)
        with patch.object(server, "generate_reply", return_value="Đã trả lời"):
            self.assertEqual(self.request("POST", "/api/chat", {"message": "Hi"})[0], 200)


if __name__ == "__main__":
    unittest.main()
