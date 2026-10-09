"""PostgreSQL integration tests use only fresh, UUID-named schemas.

Opt in with VISIONFACE_TEST_POSTGRES pointing at an expendable local server.
"""
import os
import importlib.util
import sys
import unittest
import uuid
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from auth_store import AuthStore
from face_store import FaceStore, StorageError
from migrate_to_postgres import migrate, snapshot, fingerprint
from postgres_store import PostgresFaceStore, Row
import test_authentication as authentication
import test_database_api as api


class AdapterTests(unittest.TestCase):
    def test_rows_preserve_both_dbapi_and_mapping_access(self):
        row = Row(["id", "name"], ["1", "Tùng"])
        self.assertEqual(row[0], row["id"])
        self.assertEqual(dict(row), {"id": "1", "name": "Tùng"})
        self.assertEqual(list(row), ["1", "Tùng"])

    @unittest.skipUnless(importlib.util.find_spec("psycopg"), "Install requirements-postgres.txt")
    def test_credentials_required_and_tls_cannot_be_disabled(self):
        with self.assertRaises(ValueError):
            PostgresFaceStore(None)
        with self.assertRaises(ValueError):
            PostgresFaceStore("postgresql://secret:password@example.org/postgres?sslmode=disable")
        with self.assertRaises(ValueError):
            PostgresFaceStore("postgresql://example.org:6543/postgres")


class TemporaryPostgres:
    def setUp(self):
        self.pg_schema = "visionface_test_" + uuid.uuid4().hex
        self.pg_url = os.environ["VISIONFACE_TEST_POSTGRES"]
        self.pg_store = PostgresFaceStore(self.pg_url, schema=self.pg_schema, require_tls=False)
        self.addCleanup(self.cleanup_postgres)

    def cleanup_postgres(self):
        import psycopg
        self.pg_store.close()
        assert self.pg_schema.startswith("visionface_test_") and len(self.pg_schema) == 48
        with psycopg.connect(self.pg_url, autocommit=True) as connection:
            connection.execute(f'DROP SCHEMA IF EXISTS "{self.pg_schema}" CASCADE')


@unittest.skipUnless(os.environ.get("VISIONFACE_TEST_POSTGRES"), "PostgreSQL integration tests are opt-in")
class PostgresAuthenticationTests(TemporaryPostgres, authentication.AuthenticationTests):
    def setUp(self):
        TemporaryPostgres.setUp(self)
        # Reuse the complete API/auth suite against a real PostgreSQL connection.
        with patch.object(api, "FaceStore", lambda path: self.pg_store):
            authentication.AuthenticationTests.setUp(self)

    def test_failed_storage_write_returns_500_and_rolls_back(self):
        with self.store._connect() as connection:
            connection.execute("""CREATE FUNCTION reject_sample() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'test failure'; END; $$;
                CREATE TRIGGER reject_sample BEFORE INSERT ON face_samples
                FOR EACH ROW EXECUTE FUNCTION reject_sample();""")
        status, data = self.request("POST", "/api/register", {"name": "Rollback", "landmarks": self.points})
        self.assertEqual(status, 500)
        self.assertEqual(self.store.counts(), {"people": 0, "samples": 0})

    def test_external_sql_changes_invalidate_cached_faces(self):
        person = self.store.register("Tùng", [.1] * 60)
        self.assertEqual(self.store.matching_faces()[0]["name"], "Tùng")
        with self.store._connect() as connection:
            connection.execute("UPDATE people SET name=? WHERE id=?", ("Tên mới", person["id"]))
        self.assertEqual(self.store.matching_faces()[0]["name"], "Tên mới")


@unittest.skipUnless(os.environ.get("VISIONFACE_TEST_POSTGRES"), "PostgreSQL integration tests are opt-in")
class PostgresMigrationTests(TemporaryPostgres, unittest.TestCase):
    def setUp(self):
        import tempfile
        TemporaryPostgres.setUp(self)
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.source = FaceStore(Path(temp.name) / "source.sqlite3")
        self.source.initialize()
        self.auth = AuthStore(self.source)
        self.auth.initialize()
        self.admin = self.auth.create_account("admin", "Tùng", "Test admin password 123", role="admin")
        self.user = self.auth.create_account("alice", "Ánh", "Test user password 123")
        self.source.register("Ánh", [.1] * 60, owner_account_id=self.user["id"], actor_id=self.admin["id"])
        self.auth.login("alice", "Test user password 123", "user")

    def test_full_transfer_preserves_accounts_hashes_ownership_faces_and_audit(self):
        before = fingerprint(snapshot(self.source))
        result = migrate(self.source, self.pg_store)
        self.assertEqual(result["counts"]["accounts"], 2)
        self.assertEqual(fingerprint(snapshot(self.pg_store)), before)
        self.assertEqual(fingerprint(snapshot(self.source)), before)
        with self.pg_store._connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM auth_sessions").fetchone()[0], 0)
        _, session = AuthStore(self.pg_store).login("alice", "Test user password 123", "user")
        self.assertEqual(session["id"], self.user["id"])
        self.assertEqual(len(AuthStore(self.pg_store).owned_ids(session["id"])), 1)
        with self.assertRaises(ValueError):
            migrate(self.source, self.pg_store)

    def test_nonempty_destination_is_never_overwritten(self):
        self.pg_store.initialize()
        AuthStore(self.pg_store).initialize()
        self.pg_store.register("Existing", [.2] * 60)
        with self.assertRaises(ValueError):
            migrate(self.source, self.pg_store)
        self.assertEqual(self.pg_store.list_people()[0]["name"], "Existing")

    def test_failed_transfer_rolls_back_accounts_faces_and_marker(self):
        self.pg_store.initialize()
        AuthStore(self.pg_store).initialize()
        with self.pg_store._connect() as connection:
            connection.execute("""CREATE FUNCTION reject_sample() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'test failure'; END; $$;
                CREATE TRIGGER reject_sample BEFORE INSERT ON face_samples
                FOR EACH ROW EXECUTE FUNCTION reject_sample();""")
        with self.assertRaises(StorageError):
            migrate(self.source, self.pg_store)
        with self.pg_store._connect() as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM accounts").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM people").fetchone()[0], 0)
            self.assertIsNone(connection.execute("SELECT value FROM metadata WHERE key='full_import_completed'").fetchone())


if __name__ == "__main__":
    unittest.main()
