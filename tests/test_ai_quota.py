"""AI budgets use disposable SQLite and mocked providers, never real API keys."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from pydantic import ValidationError

from backend.database import initialize_database
from backend.routers import aura, assistant
from backend.schemas import AuraChatRequest, AssistantMessageRequest
from backend.services import ai_quota
from backend.services.ai_service import AIServiceUnavailable


class QuotaTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.path = Path(self.folder.name) / "app.sqlite3"
        initialize_database(lambda: sqlite3.connect(self.path))
        self.connection = self.connect()
        self.addCleanup(self.connection.close)
        for user_id in ("first", "second"):
            self.connection.execute("INSERT INTO users VALUES (?, ?, 'hash', '2026-01-01')", (user_id, user_id + "@example.test"))
            self.connection.execute("INSERT INTO user_consents VALUES (?, ?, 'ai_chat', 1, 'v1', '2026-01-01')", (user_id, user_id))
        self.connection.commit()
        self.now = datetime(2026, 10, 15, 4, tzinfo=timezone.utc)

    def connect(self):
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def defaults(self, **kwargs):
        limits = ai_quota.QuotaSettings(**kwargs)
        self.connection.execute("DELETE FROM ai_quota_settings")
        self.connection.execute("INSERT INTO ai_quota_settings VALUES (1, ?, ?, ?, ?, ?, ?)", (
            limits.daily_limit, limits.monthly_limit, limits.per_minute, limits.global_daily_limit, limits.global_monthly_limit, self.now.isoformat()))
        self.connection.commit()

    def override(self, user_id="first", **kwargs):
        limits = ai_quota.QuotaPolicy(**kwargs)
        self.connection.execute("INSERT INTO ai_user_quotas VALUES (?, ?, ?, ?, ?, ?)", (
            user_id, limits.daily_limit, limits.monthly_limit, limits.per_minute, int(limits.enabled), self.now.isoformat()))
        self.connection.commit()

    def test_defaults_preserve_existing_access_and_minute_limit(self):
        self.assertIsNone(ai_quota.settings(self.connection)["daily_limit"])
        self.defaults(per_minute=2)
        for _ in range(2): ai_quota.reserve_request(self.connection, "first", self.now)
        with self.assertRaises(HTTPException) as error:
            ai_quota.reserve_request(self.connection, "first", self.now)
        self.assertEqual(error.exception.status_code, 429)
        self.assertEqual(ai_quota.user_status(self.connection, "first", self.now)["usage"], {"today": 2, "month": 2})
        ai_quota.reserve_request(self.connection, "second", self.now)

    def test_concurrent_requests_cannot_exceed_daily_budget(self):
        self.defaults(daily_limit=2, per_minute=60)
        def send(_):
            connection = self.connect()
            try:
                ai_quota.reserve_request(connection, "first", self.now)
                return True
            except HTTPException:
                return False
            finally: connection.close()
        with ThreadPoolExecutor(max_workers=8) as pool:
            admitted = list(pool.map(send, range(12)))
        self.assertEqual(sum(admitted), 2)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM ai_usage_events").fetchone()[0], 2)

    def test_vietnam_midnight_resets_day_but_not_month(self):
        self.defaults(daily_limit=1, monthly_limit=2, per_minute=60)
        before = datetime.fromisoformat("2026-10-14T16:59:00+00:00")
        after = datetime.fromisoformat("2026-10-14T17:00:01+00:00")
        ai_quota.reserve_request(self.connection, "first", before)
        ai_quota.reserve_request(self.connection, "first", after)
        status = ai_quota.user_status(self.connection, "first", after)
        self.assertEqual(status["usage"], {"today": 1, "month": 2})
        self.assertEqual(status["period"]["day"], "2026-10-15")
        next_day = datetime.fromisoformat("2026-10-15T17:00:01+00:00")
        with self.assertRaises(HTTPException) as error:
            ai_quota.reserve_request(self.connection, "first", next_day)
        self.assertIn("tháng", error.exception.detail)

    def test_new_year_resets_month_and_day(self):
        self.defaults(daily_limit=1, monthly_limit=1)
        ai_quota.reserve_request(self.connection, "first", datetime.fromisoformat("2026-12-31T16:59:00+00:00"))
        now = datetime.fromisoformat("2026-12-31T17:00:01+00:00")
        ai_quota.reserve_request(self.connection, "first", now)
        status = ai_quota.user_status(self.connection, "first", now)
        self.assertEqual(status["usage"], {"today": 1, "month": 1})
        self.assertEqual(status["period"]["month"], "2027-01")

    def test_zero_pause_override_and_inheritance(self):
        self.defaults(daily_limit=0)
        with self.assertRaises(HTTPException): ai_quota.reserve_request(self.connection, "first", self.now)
        self.override(daily_limit=None, monthly_limit=None, per_minute=60)
        ai_quota.reserve_request(self.connection, "first", self.now)
        self.connection.execute("UPDATE ai_user_quotas SET enabled=0")
        self.connection.commit()
        with self.assertRaises(HTTPException) as error: ai_quota.reserve_request(self.connection, "first", self.now)
        self.assertIn("tạm dừng", error.exception.detail)
        self.connection.execute("DELETE FROM ai_user_quotas")
        self.connection.commit()
        self.assertFalse(ai_quota.user_status(self.connection, "first", self.now)["overridden"])
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM ai_usage_events").fetchone()[0], 1)

    def test_global_cap_survives_account_deletion_and_cannot_be_overridden(self):
        self.defaults(global_daily_limit=1)
        self.override(daily_limit=None, monthly_limit=None)
        ai_quota.reserve_request(self.connection, "first", self.now)
        self.connection.execute("DELETE FROM users WHERE id='first'")
        self.connection.commit()
        self.assertIsNone(self.connection.execute("SELECT user_id FROM ai_usage_events").fetchone()[0])
        with self.assertRaises(HTTPException) as error: ai_quota.reserve_request(self.connection, "second", self.now)
        self.assertIn("Hệ thống", error.exception.detail)
        self.assertEqual(ai_quota.usage(self.connection, ai_quota.periods(self.now))["today"], 1)

    def test_global_monthly_cap_spans_users_and_days(self):
        self.defaults(global_monthly_limit=2)
        ai_quota.reserve_request(self.connection, "first", datetime.fromisoformat("2026-10-14T08:00:00+00:00"))
        ai_quota.reserve_request(self.connection, "second", self.now)
        with self.assertRaises(HTTPException) as error: ai_quota.reserve_request(self.connection, "first", self.now)
        self.assertIn("Hệ thống đã hết hạn mức AI trong tháng", error.exception.detail)
        self.assertEqual(ai_quota.usage(self.connection, ai_quota.periods(self.now)), {"today": 1, "month": 2})

    def test_foreign_conversation_is_rejected_without_spending_quota(self):
        conversation_id = "ef28e4ef-155f-42a9-960a-dc3139635c78"
        self.connection.execute("INSERT INTO ai_conversations VALUES (?, 'second', 'Private', '2026-01-01', '2026-01-01')", (conversation_id,))
        self.connection.commit()
        async def check():
            with patch.object(aura, "ai_configuration", return_value={"available": True}), patch.object(aura, "get_ai_service") as provider:
                with self.assertRaises(HTTPException) as error:
                    await aura.chat(AuraChatRequest(message="Hello", conversation_id=conversation_id), None, {"id": "first"}, self.connection)
                self.assertEqual(error.exception.status_code, 404)
                provider.assert_not_called()
        asyncio.run(check())
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM ai_usage_events").fetchone()[0], 0)

    def test_invalid_limits_rejected(self):
        for values in ({"daily_limit": -1}, {"monthly_limit": 10_000_001}, {"per_minute": 0}, {"per_minute": 61}, {"api_key": "do-not-store"}):
            with self.subTest(values=values), self.assertRaises(ValidationError): ai_quota.QuotaPolicy(**values)

    def test_all_aura_entrypoints_reject_before_provider_when_quota_is_zero(self):
        self.defaults(daily_limit=0)
        async def check():
            with patch.object(aura, "ai_configuration", return_value={"available": True}), patch.object(aura, "get_ai_service") as provider:
                for endpoint, payload in ((aura.chat, AuraChatRequest(message="Hello")), (aura.legacy_send_message, AssistantMessageRequest(message="Hello")), (assistant.send_message, AssistantMessageRequest(message="Hello"))):
                    with self.assertRaises(HTTPException) as error:
                        await endpoint(payload, None, {"id": "first"}, self.connection)
                    self.assertEqual(error.exception.status_code, 429)
                provider.assert_not_called()
        asyncio.run(check())
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM ai_usage_events").fetchone()[0], 0)

    def test_failed_and_cancelled_provider_turns_still_consume_budget(self):
        self.defaults(daily_limit=2, per_minute=60)
        class Provider:
            async def stream_reply(self, history):
                yield "partial"
                raise AIServiceUnavailable("Test outage")
        async def check():
            with patch.object(aura, "ai_configuration", return_value={"available": True}), patch.object(aura, "get_ai_service", return_value=Provider()):
                response = await aura.chat(AuraChatRequest(message="Hello"), None, {"id": "first"}, self.connection)
                events = [json.loads(item.decode().removeprefix("data: ")) async for item in response.body_iterator]
                self.assertEqual(events[-1]["type"], "error")
                response = await aura.chat(AuraChatRequest(message="Cancel"), None, {"id": "first"}, self.connection)
                await anext(response.body_iterator)
                await response.body_iterator.aclose()
        asyncio.run(check())
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM ai_messages").fetchone()[0], 0)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM ai_usage_events").fetchone()[0], 2)


if __name__ == "__main__": unittest.main()
