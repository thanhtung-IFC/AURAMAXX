"""Opt-in transaction checks using disposable schemas on the configured server."""

import os
import re
import sqlite3
import unittest
from contextlib import contextmanager
from uuid import uuid4
from unittest.mock import patch

from fastapi import Request, Response

from auth_store import AuthStore, LoginLimiter
from backend import identity
from backend.database import connect_postgres, initialize_database
from backend.routers import auth as auth_router, manage
from backend.schemas import RegisterRequest


@unittest.skipUnless(os.environ.get("AURAMAXX_TEST_POSTGRES"), "Supabase transactions use disposable schemas")
class PostgresAtomicTransactionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import psycopg
        from psycopg import sql
        from postgres_store import PostgresFaceStore

        cls.url = os.environ["AURAMAXX_TEST_POSTGRES"]
        cls.app_schema = "aura_atomic_test_" + uuid4().hex
        cls.face_schema = "face_atomic_test_" + uuid4().hex
        cls.faces = PostgresFaceStore(cls.url, schema=cls.face_schema)
        cls.addClassCleanup(cls.cleanup_schemas)
        with psycopg.connect(cls.url, autocommit=True) as raw:
            raw.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(cls.app_schema)))
        initialize_database(lambda: connect_postgres(cls.url, schema=cls.app_schema))
        cls.faces.initialize()
        cls.auth = AuthStore(cls.faces)
        cls.auth.initialize()

    @classmethod
    def cleanup_schemas(cls):
        import psycopg
        from psycopg import sql

        cls.faces.close()
        for schema in (cls.app_schema, cls.face_schema):
            if not re.fullmatch(r"(?:aura|face)_atomic_test_[0-9a-f]{32}", schema):
                raise ValueError("Refusing to drop an unverified test schema")
            with psycopg.connect(cls.url, autocommit=True) as raw:
                raw.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))

    def setUp(self):
        self.connection = connect_postgres(self.url, schema=self.app_schema)
        self.addCleanup(self.connection.close)
        for module in (identity, manage):
            mocked = patch.object(module, "legacy_auth", return_value=self.auth)
            mocked.start()
            self.addCleanup(mocked.stop)
        limiter = patch.object(auth_router, "login_limiter", LoginLimiter())
        limiter.start()
        self.addCleanup(limiter.stop)

    def register(self, response=None, email=None):
        return auth_router.register(
            RegisterRequest(email=email or f"{uuid4().hex}@example.test", password="Atomic password 123"),
            response if response is not None else Response(),
            Request({"type": "http", "client": ("127.0.0.1", 12345)}), self.connection,
        )

    def snapshot(self):
        app = self.connection.execute("""SELECT
            (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM legacy_account_links) AS links,
            (SELECT COUNT(*) FROM sessions) AS sessions,
            (SELECT COUNT(*) FROM habit_entries) AS habits,
            (SELECT enabled FROM admin_feature_flags WHERE feature_key = 'aura_ai') AS enabled
        """).fetchone()
        self.connection.rollback()
        with self.faces._connect() as legacy:
            face = legacy.execute("""SELECT
                (SELECT COUNT(*) FROM accounts), (SELECT COUNT(*) FROM people),
                (SELECT COUNT(*) FROM face_samples), (SELECT COUNT(*) FROM account_people),
                (SELECT COUNT(*) FROM audit_logs), (SELECT value FROM metadata WHERE key = 'revision')
            """).fetchone()
        return tuple(app.values()), tuple(face)

    @contextmanager
    def failing_statement(self, table, operation):
        # These identifiers are fixed test literals, in a verified disposable schema.
        if (table, operation) not in {("sessions", "INSERT"), ("users", "DELETE")}:
            raise ValueError("Unsupported failure injection")
        self.connection.execute("""CREATE FUNCTION fail_atomic_change() RETURNS trigger
            LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected transaction failure'; END $$""")
        self.connection.execute(
            f"CREATE TRIGGER fail_atomic_change BEFORE {operation} ON {table} "
            "FOR EACH ROW EXECUTE FUNCTION fail_atomic_change()"
        )
        self.connection.commit()
        try:
            yield
        finally:
            self.connection.rollback()
            self.connection.execute(f"DROP TRIGGER fail_atomic_change ON {table}")
            self.connection.execute("DROP FUNCTION fail_atomic_change()")
            self.connection.commit()

    @staticmethod
    def fail_after_audit(connection, actor, action, target=None):
        AuthStore.audit(connection, actor, action, target)
        raise sqlite3.OperationalError("injected audit failure")

    def test_registration_statement_failure_restores_both_schemas(self):
        import psycopg
        before, response = self.snapshot(), Response()
        with self.failing_statement("sessions", "INSERT"):
            with self.assertRaisesRegex(psycopg.Error, "injected transaction failure"):
                self.register(response)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(response.headers.getlist("set-cookie"), [])

    def test_registration_commit_failure_restores_both_schemas(self):
        before, response = self.snapshot(), Response()
        with patch.object(self.connection, "commit", side_effect=sqlite3.OperationalError("injected commit failure")):
            with self.assertRaisesRegex(sqlite3.OperationalError, "injected commit failure"):
                self.register(response)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(response.headers.getlist("set-cookie"), [])

    def test_registration_audit_failure_rolls_back(self):
        before = self.snapshot()
        with patch.object(self.auth, "audit", side_effect=self.fail_after_audit):
            with self.assertRaisesRegex(sqlite3.OperationalError, "injected audit failure"):
                self.register()
        self.assertEqual(self.snapshot(), before)

    def test_deletion_statement_failure_restores_faces_and_account(self):
        import psycopg
        user = self.register()
        account = identity.linked_account(self.connection, user.id)
        person = self.faces.register("Owned face", [.1] * 60, owner_account_id=account["id"])
        before = self.snapshot()
        with self.failing_statement("users", "DELETE"):
            with self.assertRaisesRegex(psycopg.Error, "injected transaction failure"):
                identity.delete_user_account(self.connection, user.id)
        self.assertEqual(self.snapshot(), before)
        self.assertIsNotNone(self.auth.account(account["id"]))
        self.assertIn(person["id"], [row["id"] for row in self.faces.matching_faces()])

    def test_successful_registration_and_deletion_refresh_face_cache(self):
        response = Response()
        user = self.register(response)
        self.assertEqual(len(response.headers.getlist("set-cookie")), 2)
        account = identity.linked_account(self.connection, user.id)
        self.assertEqual(account["display_name"], user.email)
        person = self.faces.register("Deleted face", [.2] * 60, owner_account_id=account["id"])
        self.assertIn(person["id"], [row["id"] for row in self.faces.matching_faces()])
        identity.delete_user_account(self.connection, user.id)
        self.assertIsNone(self.auth.account(account["id"]))
        self.assertIsNone(self.connection.execute("SELECT id FROM users WHERE id = ?", (user.id,)).fetchone())
        self.assertNotIn(person["id"], [row["id"] for row in self.faces.matching_faces()])

    def test_feature_audit_failure_restores_flag(self):
        before = self.snapshot()
        with patch.object(self.auth, "audit", side_effect=self.fail_after_audit):
            with self.assertRaisesRegex(sqlite3.OperationalError, "injected audit failure"):
                manage.update_feature("aura_ai", manage.FeatureUpdate(enabled=False), {"account_id": "test-actor"}, self.connection)
        self.assertEqual(self.snapshot(), before)

    def test_data_deletion_audit_failure_restores_record(self):
        user = self.register()
        entry_id = str(uuid4())
        self.connection.execute(
            "INSERT INTO habit_entries (id, user_id, category, value, recorded_at, created_at) VALUES (?, ?, ?, ?, ?, ?)",
            (entry_id, user.id, "water", "2", user.created_at, user.created_at),
        )
        self.connection.commit()
        before = self.snapshot()
        with patch.object(self.auth, "audit", side_effect=self.fail_after_audit):
            with self.assertRaisesRegex(sqlite3.OperationalError, "injected audit failure"):
                manage.delete_application_record("habit_entries", entry_id, {"account_id": "test-actor"}, self.connection)
        self.assertEqual(self.snapshot(), before)
        self.assertIsNotNone(self.connection.execute("SELECT id FROM habit_entries WHERE id = ?", (entry_id,)).fetchone())


if __name__ == "__main__":
    unittest.main()
