"""Failure-injection checks for account changes spanning the two local databases."""

import hashlib
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException, Request, Response

from auth_store import AuthStore, LoginLimiter
from backend import identity
from backend.database import initialize_database
from backend.routers import auth as auth_router
from backend.routers import vision
from backend.schemas import RegisterRequest
from face_store import FaceStore


class CommitFailureConnection(sqlite3.Connection):
    fail_commit = False

    def commit(self):
        if self.fail_commit:
            self.fail_commit = False
            raise sqlite3.OperationalError("injected commit failure")
        return super().commit()


class AccountTransactionTests(unittest.TestCase):
    APP_TABLES = ("users", "legacy_account_links", "sessions", "habit_entries")
    FACE_TABLES = (
        "accounts", "people", "face_samples", "account_people", "auth_sessions",
        "user_data", "audit_logs", "metadata",
    )

    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.app_path = Path(temporary.name) / "application.sqlite3"
        self.faces = FaceStore(Path(temporary.name) / "faces.sqlite3")
        self.faces.initialize()
        self.auth = AuthStore(self.faces)
        self.auth.initialize()
        initialize_database(self.connect_app)
        self.connection = self.connect_app()
        self.addCleanup(self.connection.close)
        legacy = patch.object(identity, "legacy_auth", return_value=self.auth)
        legacy.start()
        self.addCleanup(legacy.stop)
        limiter = patch.object(auth_router, "login_limiter", LoginLimiter())
        limiter.start()
        self.addCleanup(limiter.stop)

    def connect_app(self):
        connection = sqlite3.connect(self.app_path, factory=CommitFailureConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def snapshot(self):
        # Read committed state with fresh connections, including audit and cache revision.
        with closing(self.connect_app()) as application, self.faces._connect() as legacy:
            return {
                "application": {
                    table: [tuple(row) for row in application.execute(f"SELECT * FROM {table} ORDER BY rowid")]
                    for table in self.APP_TABLES
                },
                "faces": {
                    table: [tuple(row) for row in legacy.execute(f"SELECT * FROM {table} ORDER BY rowid")]
                    for table in self.FACE_TABLES
                },
            }

    @staticmethod
    def failing_trigger(connection, table, operation):
        # Identifiers come only from the fixed table/operation literals in these tests.
        connection.execute(
            f"CREATE TRIGGER fail_account_change BEFORE {operation} ON {table} "
            "BEGIN SELECT RAISE(ABORT, 'injected account change failure'); END"
        )
        connection.commit()

    def register(self, response, email="atomic@example.test"):
        return auth_router.register(
            RegisterRequest(email=email, password="Transaction password 123", display_name="Atomic User"),
            response,
            Request({"type": "http", "client": ("127.0.0.1", 12345)}),
            self.connection,
        )

    def assert_registration_rolls_back(self):
        before = self.snapshot()
        response = Response()
        with self.assertRaises((sqlite3.DatabaseError, HTTPException)) as failure:
            self.register(response)
        cause = failure.exception.__cause__ or failure.exception
        self.assertIn("injected", str(cause))
        self.assertFalse(self.connection.in_transaction)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(response.headers.getlist("set-cookie"), [])

    def seed_account(self, username="target", role="user"):
        account = self.auth.create_account(username, username, "Transaction password 123", role=role)
        user_id = str(uuid4())
        with self.faces._connect() as legacy:
            hashed = legacy.execute("SELECT password_hash FROM accounts WHERE id = ?", (account["id"],)).fetchone()[0]
            legacy.execute(
                "INSERT INTO auth_sessions VALUES (?, ?, ?, ?)",
                (username + "-legacy-token", account["id"], "legacy-csrf", 4102444800),
            )
            legacy.execute(
                "INSERT INTO user_data (account_id, latest_report_json, streak_count, updated_at) VALUES (?, ?, ?, ?)",
                (account["id"], '{"score": 80}', 4, account["created_at"]),
            )
        self.connection.execute(
            "INSERT INTO users VALUES (?, ?, ?, ?)",
            (user_id, username + "@example.test", "test-password-hash", account["created_at"]),
        )
        self.connection.execute(
            "INSERT INTO legacy_account_links VALUES (?, ?, ?)",
            (user_id, account["id"], hashlib.sha256(hashed.encode()).hexdigest()),
        )
        self.connection.execute(
            "INSERT INTO sessions VALUES (?, ?, ?, ?, ?)",
            (username + "-app-token", user_id, "app-csrf", account["created_at"], "2100-01-01T00:00:00+00:00"),
        )
        self.connection.execute(
            "INSERT INTO habit_entries (id, user_id, category, value, recorded_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (username + "-habit", user_id, "water", "2", account["created_at"], account["created_at"]),
        )
        self.connection.commit()
        person = self.faces.register(username, [.1] * 60, owner_account_id=account["id"])
        return user_id, account, person

    def assert_deletion_rolls_back(self, user_id):
        before = self.snapshot()
        with self.assertRaisesRegex(sqlite3.DatabaseError, "injected"):
            identity.delete_user_account(self.connection, user_id)
        self.assertFalse(self.connection.in_transaction)
        self.assertEqual(self.snapshot(), before)

    def assert_password_change_rolls_back(self, commit_failure=False):
        user_id, _, _ = self.seed_account()
        self.connection.execute("UPDATE users SET password_hash = 'legacy' WHERE id = ?", (user_id,))
        self.connection.commit()
        if commit_failure:
            self.connection.fail_commit = True
        else:
            with self.faces._connect() as legacy:
                self.failing_trigger(legacy, "audit_logs", "INSERT")
        before = self.snapshot()
        user = dict(self.connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())
        response = Response()
        with patch.object(vision, "legacy_auth", return_value=self.auth):
            with self.assertRaisesRegex(sqlite3.DatabaseError, "injected"):
                vision.change_password({"current_password": "Transaction password 123", "new_password": "Changed password 456"},
                                       Request({"type": "http", "headers": []}), response, user, None, self.connection)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(response.headers.getlist("set-cookie"), [])
        self.assertFalse(self.connection.in_transaction)

    def test_password_audit_failure_preserves_both_credentials_and_sessions(self):
        self.assert_password_change_rolls_back()

    def test_password_commit_failure_preserves_both_credentials_and_sessions(self):
        self.assert_password_change_rolls_back(commit_failure=True)

    def test_registration_link_failure_rolls_back_user_face_account_audit_and_session(self):
        self.failing_trigger(self.connection, "legacy_account_links", "INSERT")
        self.assert_registration_rolls_back()

    def test_registration_session_failure_rolls_back_both_databases_without_cookies(self):
        self.failing_trigger(self.connection, "sessions", "INSERT")
        self.assert_registration_rolls_back()

    def test_registration_audit_failure_rolls_back_both_databases(self):
        with self.faces._connect() as legacy:
            self.failing_trigger(legacy, "audit_logs", "INSERT")
        self.assert_registration_rolls_back()

    def test_registration_commit_failure_rolls_back_and_allows_same_email_retry(self):
        self.connection.fail_commit = True
        self.assert_registration_rolls_back()
        response = Response()
        user = self.register(response)
        self.assertEqual(user.email, "atomic@example.test")
        self.assertEqual(len(response.headers.getlist("set-cookie")), 2)
        committed = self.snapshot()
        for table in ("users", "legacy_account_links", "sessions"):
            self.assertEqual(len(committed["application"][table]), 1, table)
        self.assertEqual(len(committed["faces"]["accounts"]), 1)
        self.assertEqual(len(committed["faces"]["audit_logs"]), 1)

    def test_duplicate_email_returns_conflict_without_additional_rows_or_cookies(self):
        self.register(Response())
        before, response = self.snapshot(), Response()
        with self.assertRaises(HTTPException) as failure:
            self.register(response)
        self.assertEqual(failure.exception.status_code, 409)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(response.headers.getlist("set-cookie"), [])

    def test_admin_can_delete_unprojected_legacy_user_without_creating_app_rows(self):
        from backend.routers import manage

        account = self.auth.create_account("legacy_only", "Legacy only", "Transaction password 123")
        self.faces.register("Legacy face", [.1] * 60, owner_account_id=account["id"])
        with patch.object(manage, "legacy_auth", return_value=self.auth), patch.object(
            manage, "ensure_legacy_account", return_value={"id": "admin-actor"}
        ):
            result = manage.delete_account(account["id"], {"id": "admin-user"}, self.connection)
        self.assertTrue(result["success"])
        self.assertIsNone(self.auth.account(account["id"]))
        self.assertEqual(self.faces.matching_faces(), [])
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM users").fetchone()[0], 0)
        with self.faces._connect() as legacy:
            self.assertEqual(legacy.execute(
                "SELECT actor_id FROM audit_logs WHERE action = 'account.deleted' AND target_id = ?", (account["id"],)
            ).fetchone()[0], "admin-actor")

    def test_application_delete_failure_restores_account_faces_and_sessions(self):
        user_id, _, _ = self.seed_account()
        self.failing_trigger(self.connection, "users", "DELETE")
        self.assert_deletion_rolls_back(user_id)

    def test_face_delete_failure_restores_application_data(self):
        user_id, _, _ = self.seed_account()
        with self.faces._connect() as legacy:
            self.failing_trigger(legacy, "people", "DELETE")
        self.assert_deletion_rolls_back(user_id)

    def test_legacy_account_delete_failure_restores_deleted_faces(self):
        user_id, _, _ = self.seed_account()
        with self.faces._connect() as legacy:
            self.failing_trigger(legacy, "accounts", "DELETE")
        self.assert_deletion_rolls_back(user_id)

    def test_deletion_audit_failure_rolls_back_data_changes(self):
        user_id, _, _ = self.seed_account()
        with self.faces._connect() as legacy:
            self.failing_trigger(legacy, "audit_logs", "INSERT")
        self.assert_deletion_rolls_back(user_id)

    def test_deletion_commit_failure_restores_both_databases(self):
        user_id, _, _ = self.seed_account()
        self.connection.fail_commit = True
        self.assert_deletion_rolls_back(user_id)

    def test_disabled_account_deletion_removes_only_owned_data_and_invalidates_face_cache(self):
        user_id, account, person = self.seed_account()
        other_user_id, other_account, other_person = self.seed_account("unrelated")
        self.assertEqual(len(self.faces.matching_faces()), 2)
        with self.faces._connect() as legacy:
            legacy.execute("UPDATE accounts SET is_active = 0 WHERE id = ?", (account["id"],))

        identity.delete_user_account(self.connection, user_id)

        self.assertFalse(self.connection.in_transaction)
        self.assertIsNone(self.auth.account(account["id"]))
        self.assertEqual(self.auth.account(other_account["id"]), other_account)
        for table, key in (("users", "id"), ("sessions", "user_id"), ("legacy_account_links", "user_id"), ("habit_entries", "user_id")):
            rows = self.connection.execute(f"SELECT {key} FROM {table}").fetchall()
            self.assertEqual([row[0] for row in rows], [other_user_id], table)
        self.assertEqual([row["id"] for row in self.faces.matching_faces()], [other_person["id"]])
        with self.faces._connect() as legacy:
            for table in ("auth_sessions", "user_data", "account_people"):
                self.assertEqual(
                    [row[0] for row in legacy.execute(f"SELECT account_id FROM {table}")],
                    [other_account["id"]], table,
                )
            self.assertIsNone(legacy.execute("SELECT id FROM face_samples WHERE person_id = ?", (person["id"],)).fetchone())

    def test_admin_account_cannot_be_deleted_even_if_disabled(self):
        user_id, account, _ = self.seed_account(role="admin")
        with self.faces._connect() as legacy:
            legacy.execute("UPDATE accounts SET is_active = 0 WHERE id = ?", (account["id"],))
        before = self.snapshot()
        with self.assertRaises(HTTPException) as failure:
            identity.delete_user_account(self.connection, user_id)
        self.assertEqual(failure.exception.status_code, 403)
        self.assertEqual(self.snapshot(), before)


if __name__ == "__main__":
    unittest.main()
