"""Verify completed-turn persistence and provider failures using disposable SQLite."""
import json
import sqlite3
import unittest
from unittest.mock import patch

from backend.routers.aura import _stream_chat
from backend.schemas import AuraChatRequest
from backend.services.ai_service import AIServiceUnavailable


class AuraChatTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.connection = sqlite3.connect(":memory:")
        self.connection.row_factory = sqlite3.Row
        self.addCleanup(self.connection.close)
        self.connection.executescript("""
            CREATE TABLE ai_conversations (id TEXT PRIMARY KEY, user_id TEXT, title TEXT, created_at TEXT, updated_at TEXT);
            CREATE TABLE ai_messages (id TEXT PRIMARY KEY, conversation_id TEXT, role TEXT, content TEXT, created_at TEXT);
        """)

    async def events(self, provider, **payload):
        with patch("backend.routers.aura.get_ai_service", return_value=provider):
            return [json.loads(chunk.decode().removeprefix("data: ")) async for chunk in _stream_chat(AuraChatRequest(**payload), "owner", self.connection)]

    async def test_followup_uses_saved_history_and_first_question_names_conversation(self):
        seen = []
        class Provider:
            provider = "gemini"
            model = "test-gemini"
            async def stream_reply(self, messages):
                seen.append(messages)
                yield "Xin "
                yield "chào!"
        first = await self.events(Provider(), message="Một routine đơn giản")
        self.assertEqual(first[-1]["provider"], "gemini")
        conversation_id = first[-1]["conversation_id"]
        second = await self.events(Provider(), conversation_id=conversation_id, message="Giải thích thêm")
        self.assertEqual(second[-1]["type"], "done")
        self.assertEqual([item["role"] for item in seen[-1]], ["user", "assistant", "user"])
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM ai_messages").fetchone()[0], 4)
        self.assertEqual(self.connection.execute("SELECT title FROM ai_conversations").fetchone()[0], "Một routine đơn giản")

    async def test_failed_stream_does_not_save_partial_turn(self):
        class Provider:
            async def stream_reply(self, messages):
                yield "Partial answer"
                raise AIServiceUnavailable("Interrupted", kind="interrupted_stream", status_code=502)
        events = await self.events(Provider(), message="Hello")
        self.assertEqual(events[-1]["type"], "error")
        self.assertEqual(events[-1]["status"], 502)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM ai_messages").fetchone()[0], 0)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM ai_conversations").fetchone()[0], 0)

    async def test_first_successful_turn_renames_default_title(self):
        conversation_id = "e54be7ab-7175-4cc2-90c5-d94b80f36df5"
        self.connection.execute("INSERT INTO ai_conversations VALUES (?, 'owner', 'Cuộc trò chuyện mới', '', '')", (conversation_id,))
        self.connection.commit()
        class Provider:
            async def stream_reply(self, messages):
                yield "Answer"
        await self.events(Provider(), conversation_id=conversation_id, message="Chăm sóc da")
        self.assertEqual(self.connection.execute("SELECT title FROM ai_conversations").fetchone()[0], "Chăm sóc da")


if __name__ == "__main__":
    unittest.main()
