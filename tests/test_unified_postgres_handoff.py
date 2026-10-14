import hashlib
import base64
import json
import os
import re
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from uuid import uuid4

from auth_store import AuthStore
from backend.data_handoff import FACE_TABLES, fingerprint, read_table, verify_export
from backend.database import connect_postgres, initialize_database
from backend.migrate_supabase import TABLES
from backend.migrate_unified_postgres import migrate, require_identical_subset, normalize_face_samples
from face_store import FaceStore


class HandoffValidationTests(unittest.TestCase):
    def test_sqlserver_binary_face_hash_is_verified_before_converting_schema(self):
        vector = json.dumps([.1] * 60)
        sample = {"vector_json": vector, "vector_hash": {"$binary": base64.b64encode(hashlib.sha256(vector.encode()).digest()).decode()}}
        converted, verified = normalize_face_samples([sample])
        self.assertEqual(verified, 1)
        self.assertEqual(converted, [{"vector_json": vector}])
        with self.assertRaisesRegex(ValueError, "checksum"):
            normalize_face_samples([{**sample, "vector_json": json.dumps([.2] * 60)}])

    def test_existing_rows_must_be_identical_and_cannot_be_overwritten(self):
        source = [{"id": "one", "note": "original"}, {"id": "two", "note": "new"}]
        require_identical_subset(source[:1], source, "habits")
        with self.assertRaises(ValueError):
            require_identical_subset([{"id": "one", "note": "remote changed"}], source, "habits")
        with self.assertRaises(ValueError):
            require_identical_subset([{"id": "other", "note": "remote only"}], source, "habits")


@unittest.skipUnless(os.environ.get("AURAMAXX_TEST_POSTGRES"), "Supabase integration uses disposable schemas")
class UnifiedPostgresHandoffTests(unittest.TestCase):
    def setUp(self):
        import psycopg
        from psycopg import sql
        self.url = os.environ["AURAMAXX_TEST_POSTGRES"]
        self.app_schema = "aura_handoff_test_" + uuid4().hex
        self.face_schema = "face_handoff_test_" + uuid4().hex
        with psycopg.connect(self.url, autocommit=True) as connection:
            connection.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(self.app_schema)))
        self.addCleanup(self.cleanup_schemas)
        temp = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parents[1] / ".test-output")
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        store = FaceStore(self.folder / "source-faces.sqlite3")
        store.initialize()
        auth = AuthStore(store)
        auth.initialize()
        account = auth.create_account("handoff_owner", "Handoff owner", "Handoff password 123", role="admin")
        store.register("Fixture face", [.1] * 60, owner_account_id=account["id"])
        with store._connect() as connection:
            connection.execute("INSERT OR IGNORE INTO metadata VALUES ('schema_version', '1')")
            faces = {table: read_table(connection, table) for table in FACE_TABLES}
        for sample in faces["face_samples"]:
            sample["vector_hash"] = {"$binary": base64.b64encode(hashlib.sha256(sample["vector_json"].encode()).digest()).decode()}
        app_path = self.folder / "source-app.sqlite3"
        initialize_database(lambda: sqlite3.connect(app_path))
        with closing(sqlite3.connect(app_path)) as connection:
            connection.execute("INSERT INTO users VALUES (?, ?, ?, ?)", ("fixture-user", "fixture@example.test", "legacy", "2026-10-14"))
            connection.execute("INSERT INTO legacy_account_links VALUES (?, ?, ?)", ("fixture-user", account["id"], "fixture-credential-hash"))
            connection.execute("INSERT INTO habit_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ("fixture-habit", "fixture-user", "water", "2", "l", "original", "2026-10-14", "2026-10-14"))
            connection.commit()
            app = {table: read_table(connection, table) for table in ("schema_version", *TABLES, "data_handoffs")}
        self.records = {"visionface": faces, "auramaxx": app}
        manifest = {"version": 1, "sources": {}}
        for name, records in self.records.items():
            content = json.dumps(records, ensure_ascii=False).encode("utf-8")
            (self.folder / (name + ".json")).write_bytes(content)
            manifest["sources"][name] = {"file": name + ".json", "sha256": hashlib.sha256(content).hexdigest(),
                                          "tables": {table: {"rows": len(rows), "sha256": fingerprint(rows)} for table, rows in records.items()}}
        (self.folder / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")

    def cleanup_schemas(self):
        import psycopg
        from psycopg import sql
        for schema in (self.app_schema, self.face_schema):
            if not re.fullmatch(r"(?:aura|face)_handoff_test_[0-9a-f]{32}", schema):
                raise ValueError("Refusing to delete an unverified test schema")
            with psycopg.connect(self.url, autocommit=True) as connection:
                connection.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))

    def test_one_database_preserves_both_stores_and_is_idempotent(self):
        result = migrate(self.folder, self.url, app_schema=self.app_schema, face_schema=self.face_schema)
        self.assertTrue(result["verified"])
        self.assertEqual(result["derived_face_hashes_verified"], 1)
        with closing(connect_postgres(self.url, schema=self.app_schema)) as connection:
            for source, schema in (("visionface", self.face_schema), ("auramaxx", self.app_schema)):
                for table, records in self.records[source].items():
                    if table == "data_handoffs":
                        continue
                    if table == "face_samples":
                        records, _ = normalize_face_samples(records)
                    self.assertEqual(fingerprint(read_table(connection, f'"{schema}"."{table}"')), fingerprint(records))
        self.assertTrue(migrate(self.folder, self.url, app_schema=self.app_schema, face_schema=self.face_schema)["already_imported"])
        verify_export(self.folder)

    def test_remote_conflict_stops_without_importing_faces_or_changing_remote_row(self):
        initialize_database(lambda: connect_postgres(self.url, schema=self.app_schema))
        with closing(connect_postgres(self.url, schema=self.app_schema)) as connection:
            user = self.records["auramaxx"]["users"][0]
            connection.execute("INSERT INTO users VALUES (?, ?, ?, ?)", tuple(user.values()))
            habit = {**self.records["auramaxx"]["habit_entries"][0], "note": "remote changed"}
            connection.execute("INSERT INTO habit_entries VALUES (?, ?, ?, ?, ?, ?, ?, ?)", tuple(habit.values()))
            connection.commit()
        with self.assertRaisesRegex(ValueError, "different data"):
            migrate(self.folder, self.url, app_schema=self.app_schema, face_schema=self.face_schema)
        with closing(connect_postgres(self.url, schema=self.app_schema)) as connection:
            self.assertEqual(connection.execute("SELECT note FROM habit_entries").fetchone()[0], "remote changed")
            self.assertEqual(connection.execute(f'SELECT COUNT(*) FROM "{self.face_schema}".accounts').fetchone()[0], 0)
        verify_export(self.folder)
