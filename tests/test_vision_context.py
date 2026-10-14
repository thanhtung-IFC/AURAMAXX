import json
import sqlite3
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from backend.schemas import AuraChatRequest
from backend.services.vision_context import sanitize_analysis
from backend.routers.aura import _stream_chat, chat


class VisionContextTests(unittest.IsolatedAsyncioTestCase):
    def test_filter_preserves_measurements_and_removes_private_data(self):
        report = {"image": "private", "name": "private", "overall_harmony_score": 72,
                  "symmetry": {"overall_symmetry_score": 80, "midline_axis": {"x": 3}},
                  "profile": {"visual_guides": [1], "profile_gonial_angle_deg": 122},
                  "skin": {"image": "private", "smoothness_score": 66, "unknown": float("nan")}}
        clean = AuraChatRequest(message="Routine?", analysis=report).analysis
        self.assertEqual(clean["overall_harmony_score"], 72)
        self.assertEqual(clean["profile"], {"profile_gonial_angle_deg": 122})
        self.assertNotIn("private", json.dumps(clean))
        self.assertNotIn("midline_axis", clean["symmetry"])
        self.assertIsNone(clean["skin"]["unknown"])
        self.assertLessEqual(len(json.dumps(sanitize_analysis({"hair": {"advice": ["a" * 2000] * 20}}))), 7000)
        with self.assertRaises(ValueError):
            sanitize_analysis({"hair": "a" * 50_001})

    async def test_report_reaches_provider_but_saved_question_has_no_raw_report(self):
        connection = sqlite3.connect(":memory:")
        self.addCleanup(connection.close)
        connection.executescript("""
            CREATE TABLE ai_conversations (id TEXT, user_id TEXT, title TEXT, created_at TEXT, updated_at TEXT);
            CREATE TABLE ai_messages (id TEXT, conversation_id TEXT, role TEXT, content TEXT, created_at TEXT);
        """)
        seen = []
        class Provider:
            async def stream_reply(self, history):
                seen.extend(history)
                yield "Hỏi thêm về mục tiêu và thói quen."
        payload = AuraChatRequest(message="Giúp tôi tạo routine", analysis={"overall_harmony_score": 72, "image": "private"})
        with patch("backend.routers.aura.get_ai_service", return_value=Provider()):
            events = [chunk async for chunk in _stream_chat(payload, "user", connection)]
        self.assertIn('"overall_harmony_score": 72', seen[-1]["content"])
        self.assertNotIn("private", seen[-1]["content"])
        self.assertIn(b'"type": "done"', events[-1])
        saved = connection.execute("SELECT content FROM ai_messages WHERE role = 'user'").fetchone()[0]
        self.assertEqual(saved, payload.message)

    async def test_attachment_requires_face_consent_before_provider_call(self):
        with patch("backend.routers.aura._require_ai_consent"), patch("backend.routers.aura.latest_consent", return_value=False), patch("backend.routers.aura.get_ai_service") as provider:
            with self.assertRaises(HTTPException) as error:
                await chat(AuraChatRequest(message="Routine", analysis={"overall_harmony_score": 70}), None, {"id": "user"}, None)
            self.assertEqual(error.exception.status_code, 403)
            provider.assert_not_called()


if __name__ == "__main__":
    unittest.main()
