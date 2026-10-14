"""Admin sessions and their audit record must succeed or roll back together."""

import hashlib
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi import HTTPException, Request, Response

from auth_store import AuthStore, LoginLimiter
from backend import identity
from backend.database import initialize_database
from backend.routers import auth as auth_router
from backend.schemas import LoginRequest
from face_store import FaceStore


class FailingConnection(sqlite3.Connection):
    fail_commit = False

    def commit(self):
        if self.fail_commit:
            self.fail_commit = False
            raise sqlite3.OperationalError("injected admin commit failure")
        super().commit()


class AdminLoginTransactionTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        path = Path(directory.name)
        self.app_path = path / "app.sqlite3"
        self.faces = FaceStore(path / "faces.sqlite3")
        self.faces.initialize()
        self.auth = AuthStore(self.faces)
        self.auth.initialize()
        self.account = self.auth.create_account("test_admin", "Admin", "Test admin password 123", role="admin")
        initialize_database(self.connect)
        self.connection = self.connect()
        self.addCleanup(self.connection.close)
        self.user_id = str(uuid4())
        self.connection.execute("INSERT INTO users VALUES (?, ?, ?, ?)", (self.user_id, "admin@example.test", "fixture-hash", self.account["created_at"]))
        identity_auth = patch.object(identity, "legacy_auth", return_value=self.auth)
        identity_auth.start(); self.addCleanup(identity_auth.stop)
        router_auth = patch.object(auth_router, "legacy_auth", return_value=self.auth)
        router_auth.start(); self.addCleanup(router_auth.stop)
        limiter = patch.object(auth_router, "login_limiter", LoginLimiter())
        limiter.start(); self.addCleanup(limiter.stop)
        identity.save_link(self.connection, self.user_id, self.account["id"])
        self.old_token = "old-browser-token"
        self.connection.execute("INSERT INTO sessions VALUES (?, ?, ?, ?, ?)", (hashlib.sha256(self.old_token.encode()).hexdigest(), self.user_id, "old-csrf", self.account["created_at"], "2100-01-01T00:00:00+00:00"))
        self.connection.commit()

    def connect(self):
        connection = sqlite3.connect(self.app_path, factory=FailingConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def snapshot(self):
        with self.faces._connect() as legacy:
            face = [tuple(row) for row in legacy.execute("SELECT last_login, role FROM accounts WHERE id = ?", (self.account["id"],))]
            audit = [tuple(row) for row in legacy.execute("SELECT * FROM audit_logs ORDER BY id")]
        sessions = [tuple(row) for row in self.connection.execute("SELECT * FROM sessions ORDER BY token_hash")]
        return face, audit, sessions

    def login(self, response):
        request = Request({"type": "http", "client": ("127.0.0.1", 1234), "headers": [(b"cookie", b"auramaxx_session=old-browser-token")]})
        # Credential correctness is covered through HTTP tests. Isolate the session
        # transaction here, while role/active state still comes from the real DB.
        with patch.object(auth_router, "verify_password", return_value=True):
            return auth_router.admin_login(LoginRequest(email="admin@example.test", password="Test admin password 123"), response, request, self.connection)

    def test_commit_failure_preserves_old_session_audit_and_last_login(self):
        before, response = self.snapshot(), Response()
        self.connection.fail_commit = True
        with self.assertRaisesRegex(sqlite3.OperationalError, "injected admin commit"):
            self.login(response)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(response.headers.getlist("set-cookie"), [])

    def test_audit_failure_preserves_old_session_and_issues_no_cookie(self):
        with self.faces._connect() as legacy:
            legacy.execute("CREATE TRIGGER fail_admin_audit BEFORE INSERT ON audit_logs WHEN NEW.action = 'account.admin_login' BEGIN SELECT RAISE(ABORT, 'injected admin audit failure'); END")
        before, response = self.snapshot(), Response()
        with self.assertRaisesRegex(sqlite3.DatabaseError, "injected admin audit"):
            self.login(response)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(response.headers.getlist("set-cookie"), [])

    def test_role_is_rechecked_inside_session_transaction(self):
        resolve = auth_router.linked_account

        def demote_after_read(connection, user_id):
            account = resolve(connection, user_id)
            with self.faces._connect() as legacy:
                legacy.execute("UPDATE accounts SET role = 'user' WHERE id = ?", (self.account["id"],))
            return account

        response = Response()
        with patch.object(auth_router, "linked_account", side_effect=demote_after_read):
            with self.assertRaises(HTTPException) as failure:
                self.login(response)
        self.assertEqual(failure.exception.status_code, 401)
        self.assertEqual(response.headers.getlist("set-cookie"), [])
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 1)

    def test_success_replaces_browser_session_with_audited_admin_session(self):
        response = Response()
        user = self.login(response)
        self.assertEqual(user.role, "admin")
        self.assertEqual(len(response.headers.getlist("set-cookie")), 2)
        with self.faces._connect() as legacy:
            self.assertIsNotNone(legacy.execute("SELECT last_login FROM accounts WHERE id = ?", (self.account["id"],)).fetchone()[0])
            self.assertEqual(legacy.execute("SELECT COUNT(*) FROM audit_logs WHERE action = 'account.admin_login'").fetchone()[0], 1)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM sessions").fetchone()[0], 1)
        self.assertIsNone(self.connection.execute("SELECT token_hash FROM sessions WHERE token_hash = ?", (hashlib.sha256(self.old_token.encode()).hexdigest(),)).fetchone())


if __name__ == "__main__":
    unittest.main()
