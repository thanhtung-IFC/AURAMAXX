"""Admin mutations and their audit records must commit or roll back together."""

import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from auth_store import AuthStore
from backend.database import initialize_database
from backend.routers import manage
from face_store import FaceStore


class CommitFailingConnection(sqlite3.Connection):
    fail_next_commit = False

    def commit(self):
        if self.fail_next_commit:
            self.fail_next_commit = False
            raise sqlite3.OperationalError("injected commit failure")
        super().commit()


class AdminAtomicAuditTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.app_path = Path(self.folder.name) / "application.sqlite3"
        initialize_database(lambda: sqlite3.connect(self.app_path))
        self.connection = sqlite3.connect(self.app_path, factory=CommitFailingConnection)
        self.addCleanup(self.connection.close)
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA foreign_keys = ON")

        faces = FaceStore(Path(self.folder.name) / "faces.sqlite3")
        faces.initialize()
        self.auth = AuthStore(faces)
        self.auth.initialize()
        self.actor = self.auth.create_account("central_admin", "Central Admin", "password123", role="admin")
        self.user = {"account_id": self.actor["id"]}
        self.connection.execute(
            "INSERT INTO users (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
            ("user-1", "test@example.test", "test-hash", "2026-01-01"),
        )
        self.connection.execute(
            "INSERT INTO ai_conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
            ("conversation-1", "user-1", "Test conversation", "2026-01-01", "2026-01-01"),
        )
        self.connection.execute(
            "INSERT INTO ai_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
            ("message-1", "conversation-1", "user", "Test message", "2026-01-01"),
        )
        self.connection.commit()
        auth_patch = patch.object(manage, "legacy_auth", return_value=self.auth)
        auth_patch.start()
        self.addCleanup(auth_patch.stop)

    def app_rows(self, query, parameters=()):
        with closing(sqlite3.connect(self.app_path)) as connection:
            return connection.execute(query, parameters).fetchall()

    def mutation_events(self):
        with self.auth.faces._connect() as connection:
            return [tuple(row) for row in connection.execute(
                "SELECT actor_id, action, target_id FROM audit_logs "
                "WHERE action LIKE 'feature.%' OR action = 'application_data.deleted'"
            ).fetchall()]

    def fail_after_audit_insert(self, connection, actor, action, target):
        AuthStore.audit(connection, actor, action, target)
        raise sqlite3.OperationalError("injected audit failure")

    def update_feature(self):
        return manage.update_feature("aura_ai", manage.FeatureUpdate(enabled=False), self.user, self.connection)

    def delete_conversation(self):
        return manage.delete_application_record("ai_conversations", "conversation-1", self.user, self.connection)

    def test_feature_update_rolls_back_when_audit_fails(self):
        before = self.app_rows("SELECT * FROM admin_feature_flags WHERE feature_key = 'aura_ai'")
        with patch.object(self.auth, "audit", side_effect=self.fail_after_audit_insert):
            with self.assertRaisesRegex(sqlite3.OperationalError, "injected audit failure"):
                self.update_feature()
        self.assertEqual(self.app_rows("SELECT * FROM admin_feature_flags WHERE feature_key = 'aura_ai'"), before)
        self.assertEqual(self.mutation_events(), [])

    def test_ai_settings_and_user_quota_roll_back_with_failed_audit(self):
        target = self.auth.create_account("quota_user", "Quota User", "password123")
        with patch("backend.identity.legacy_auth", return_value=self.auth):
            projected = manage.project_account(self.connection, target)
        with patch.object(self.auth, "audit", side_effect=self.fail_after_audit_insert):
            with self.assertRaises(sqlite3.OperationalError):
                manage.update_ai_settings(manage.ai_quota.QuotaSettings(daily_limit=10), self.user, self.connection)
            with self.assertRaises(sqlite3.OperationalError):
                manage.update_ai_quota(target["id"], manage.ai_quota.QuotaPolicy(daily_limit=2), self.user, self.connection)
        self.assertEqual(self.app_rows("SELECT * FROM ai_quota_settings"), [])
        self.assertEqual(self.app_rows("SELECT * FROM ai_user_quotas"), [])
        manage.update_ai_quota(target["id"], manage.ai_quota.QuotaPolicy(daily_limit=2), self.user, self.connection)
        with patch.object(self.auth, "audit", side_effect=self.fail_after_audit_insert):
            with self.assertRaises(sqlite3.OperationalError):
                manage.default_ai_quota(target["id"], self.user, self.connection)
        self.assertEqual(self.app_rows("SELECT daily_limit FROM ai_user_quotas WHERE user_id=?", (projected["id"],)), [(2,)])
        with self.auth.faces._connect() as connection:
            events = connection.execute("SELECT action FROM audit_logs WHERE action LIKE 'ai_quota.%'").fetchall()
        self.assertEqual([row[0] for row in events], ["ai_quota.user_updated"])

    def test_delegated_admin_cannot_edit_admin_ai_quota(self):
        delegate = self.auth.create_account("quota_delegate", "Delegate", "password123", role="admin")
        with self.assertRaises(HTTPException) as error:
            manage.update_ai_quota(self.actor["id"], manage.ai_quota.QuotaPolicy(daily_limit=1000), {"account_id": delegate["id"]}, self.connection)
        self.assertEqual(error.exception.status_code, 403)
        self.assertEqual(self.app_rows("SELECT * FROM ai_user_quotas"), [])

    def test_anonymous_usage_is_not_assigned_to_unprojected_accounts(self):
        from datetime import datetime, timezone
        target = self.auth.create_account("unprojected_user", "Not logged in yet", "password123")
        self.connection.execute("INSERT INTO ai_usage_events VALUES ('anonymous', NULL, ?)", (datetime.now(timezone.utc).isoformat(),))
        self.connection.commit()
        dashboard = manage.ai_usage(self.user, self.connection)
        account = next(item for item in dashboard["accounts"] if item["id"] == target["id"])
        self.assertEqual(account["usage"], {"today": 0, "month": 0})
        self.assertEqual(dashboard["usage"], {"today": 1, "month": 1})

    def test_new_feature_flag_rolls_back_when_audit_fails(self):
        self.connection.execute("DELETE FROM admin_feature_flags WHERE feature_key = 'aura_ai'")
        self.connection.commit()
        with patch.object(self.auth, "audit", side_effect=self.fail_after_audit_insert):
            with self.assertRaisesRegex(sqlite3.OperationalError, "injected audit failure"):
                self.update_feature()
        self.assertEqual(self.app_rows("SELECT * FROM admin_feature_flags WHERE feature_key = 'aura_ai'"), [])
        self.assertEqual(self.mutation_events(), [])

    def test_feature_update_commits_with_audit(self):
        self.assertEqual(self.update_feature(), {"key": "aura_ai", "enabled": False})
        self.assertEqual(self.app_rows("SELECT enabled FROM admin_feature_flags WHERE feature_key = 'aura_ai'"), [(0,)])
        self.assertEqual(self.mutation_events(), [(self.actor["id"], "feature.disabled", "aura_ai")])

    def test_delete_restores_parent_and_cascaded_children_when_audit_fails(self):
        with patch.object(self.auth, "audit", side_effect=self.fail_after_audit_insert):
            with self.assertRaisesRegex(sqlite3.OperationalError, "injected audit failure"):
                self.delete_conversation()
        self.assertEqual(self.app_rows("SELECT id FROM ai_conversations"), [("conversation-1",)])
        self.assertEqual(self.app_rows("SELECT id FROM ai_messages"), [("message-1",)])
        self.assertEqual(self.mutation_events(), [])

    def test_delete_commits_with_audit(self):
        self.assertTrue(self.delete_conversation()["success"])
        self.assertEqual(self.app_rows("SELECT id FROM ai_conversations"), [])
        self.assertEqual(self.app_rows("SELECT id FROM ai_messages"), [])
        self.assertEqual(self.mutation_events(), [
            (self.actor["id"], "application_data.deleted", "ai_conversations:conversation-1")
        ])

    def test_missing_record_does_not_create_audit_event(self):
        with self.assertRaises(HTTPException) as caught:
            manage.delete_application_record("ai_conversations", "missing", self.user, self.connection)
        self.assertEqual(caught.exception.status_code, 404)
        self.assertEqual(self.mutation_events(), [])
        self.assertFalse(self.connection.in_transaction)

    def test_feature_and_audit_roll_back_when_commit_fails(self):
        self.connection.fail_next_commit = True
        with self.assertRaisesRegex(sqlite3.OperationalError, "injected commit failure"):
            self.update_feature()
        self.assertEqual(self.app_rows("SELECT enabled FROM admin_feature_flags WHERE feature_key = 'aura_ai'"), [(1,)])
        self.assertEqual(self.mutation_events(), [])

    def test_deletion_and_audit_roll_back_when_commit_fails(self):
        self.connection.fail_next_commit = True
        with self.assertRaisesRegex(sqlite3.OperationalError, "injected commit failure"):
            self.delete_conversation()
        self.assertEqual(self.app_rows("SELECT id FROM ai_conversations"), [("conversation-1",)])
        self.assertEqual(self.app_rows("SELECT id FROM ai_messages"), [("message-1",)])
        self.assertEqual(self.mutation_events(), [])


if __name__ == "__main__":
    unittest.main()
