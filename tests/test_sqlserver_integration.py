"""Opt-in real SQL Server tests. Only create/drop a new UUID-named test database."""

import os
import re
import sqlite3
import sys
import tempfile
import unittest
import uuid
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from face_store import FaceStore, StorageError
from sql_server_store import SqlServerFaceStore, connection_string
import server
import test_database_api as api_tests


class TemporarySqlDatabase:
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        import pyodbc
        cls.database_name = "VisionFaceTest_" + uuid.uuid4().hex
        cls.master_string = connection_string(os.environ["VISIONFACE_TEST_SQLSERVER"], "master", trust_certificate=True)
        with closing(pyodbc.connect(cls.master_string, autocommit=True)) as connection:
            connection.execute(f"CREATE DATABASE [{cls.database_name}]")
        cls.store_string = connection_string(os.environ["VISIONFACE_TEST_SQLSERVER"], cls.database_name, trust_certificate=True)
        cls.addClassCleanup(cls.drop_database)
        cls.shared_store = SqlServerFaceStore(cls.store_string)
        cls.shared_store.initialize()

    @classmethod
    def drop_database(cls):
        import pyodbc
        assert re.fullmatch(r"VisionFaceTest_[0-9a-f]{32}", cls.database_name)
        with closing(pyodbc.connect(cls.master_string, autocommit=True)) as connection:
            connection.execute(f"ALTER DATABASE [{cls.database_name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE")
            connection.execute(f"DROP DATABASE [{cls.database_name}]")


@unittest.skipUnless(os.environ.get("VISIONFACE_TEST_SQLSERVER"), "SQL Server integration tests are opt-in")
class SqlServerStoreTests(TemporarySqlDatabase, unittest.TestCase):
    def setUp(self):
        self.store = SqlServerFaceStore(self.store_string)
        self.store.clear()
        with self.store._connect() as connection:
            connection.execute("DELETE FROM dbo.metadata WHERE [key] = N'sqlite_imported'")
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.source = Path(self.temp.name) / "source.sqlite3"
        self.sqlite = FaceStore(self.source)
        self.sqlite.initialize()

    def test_unicode_multi_sample_dedup_and_cascade(self):
        person = self.store.register("T\u00f9ng", [.1] * 60, landmark_count=478)
        self.store.register("T\u00f9ng", [.2] * 60, person_id=person["id"])
        result = self.store.register("T\u00f9ng", [.2] * 60, person_id=person["id"])
        self.assertEqual(result["name"], "T\u00f9ng")
        self.assertEqual(result["sample_count"], 2)
        self.assertEqual(self.store.counts(), {"people": 1, "samples": 2})
        self.assertTrue(self.store.delete_person(person["id"]))
        self.assertFalse(self.store.delete_person(person["id"]))
        self.assertEqual(self.store.counts(), {"people": 0, "samples": 0})

    def test_external_changes_invalidate_cache_and_versions_stay_separate(self):
        person = self.store.register("An", [.1] * 60)
        self.store.register("An", [.2] * 60, person_id=person["id"], feature_version="v2")
        self.assertEqual(len(self.store.matching_faces()), 1)
        self.assertEqual(len(self.store.matching_faces("v2")), 1)
        with self.store._connect() as connection:
            connection.execute("UPDATE dbo.people SET name = ? WHERE id = ?", "Changed", person["id"])
        self.assertEqual(self.store.matching_faces()[0]["name"], "Changed")
        other = SqlServerFaceStore(self.store_string)
        other.delete_person(person["id"])
        self.assertEqual(self.store.matching_faces(), [])

    def test_import_preserves_every_field_and_never_resurrects_deleted_data(self):
        person = self.sqlite.register("T\u00f9ng", [.1] * 60, landmark_count=478)
        self.sqlite.register("T\u00f9ng", [.2] * 60, person_id=person["id"])
        before = self.source.read_bytes()
        self.assertEqual(self.store.import_sqlite(self.source), {"people": 1, "samples": 2})
        self.assertEqual(self.source.read_bytes(), before)
        self.assertEqual(self.store.list_people(), self.sqlite.list_people())
        self.assertEqual(self.store.matching_faces(), self.sqlite.matching_faces())
        self.store.clear()
        self.assertEqual(self.store.import_sqlite(self.source), {"people": 0, "samples": 0})
        self.assertEqual(self.store.counts()["people"], 0)

    def test_import_rejects_nonempty_target(self):
        self.sqlite.register("Source", [.1] * 60)
        self.store.register("Existing", [.2] * 60)
        with self.assertRaises(ValueError):
            self.store.import_sqlite(self.source)
        self.assertEqual(self.store.list_people()[0]["name"], "Existing")

    def test_import_rejects_unknown_source_schema(self):
        self.sqlite.register("Source", [.1] * 60)
        with closing(sqlite3.connect(self.source)) as connection:
            connection.execute("PRAGMA user_version = 999")
        with self.assertRaises(ValueError):
            self.store.import_sqlite(self.source)
        self.assertEqual(self.store.counts(), {"people": 0, "samples": 0})

    def test_failed_import_rolls_back_people_and_marker(self):
        self.sqlite.register("An", [.1] * 60)
        with self.store._connect() as connection:
            connection.execute("""CREATE TRIGGER dbo.reject_sample ON dbo.face_samples AFTER INSERT AS
                                  BEGIN THROW 51000, 'test failure', 1; END""")
        try:
            with self.assertRaises(StorageError):
                self.store.import_sqlite(self.source)
            self.assertEqual(self.store.counts(), {"people": 0, "samples": 0})
            with self.store._connect() as connection:
                self.assertIsNone(connection.execute("SELECT [value] FROM dbo.metadata WHERE [key]=N'sqlite_imported'").fetchone())
        finally:
            with self.store._connect() as connection:
                connection.execute("DROP TRIGGER dbo.reject_sample")
        self.assertEqual(self.store.import_sqlite(self.source)["people"], 1)

    def test_parallel_duplicate_samples_and_parameterized_names(self):
        name = "T'); DROP TABLE dbo.people; --"
        person = self.store.register(name, [.1] * 60)
        def add_sample(_):
            return SqlServerFaceStore(self.store_string).register(name, [.2] * 60, person_id=person["id"])
        with ThreadPoolExecutor(max_workers=4) as executor:
            results = list(executor.map(add_sample, range(4)))
        self.assertEqual(self.store.counts(), {"people": 1, "samples": 2})
        self.assertEqual(results[-1]["name"], name)

    def test_initialize_is_repeatable_and_newer_schema_is_rejected(self):
        self.store.initialize()
        with self.store._connect() as connection:
            connection.execute("UPDATE dbo.metadata SET [value] = N'999' WHERE [key] = N'schema_version'")
        try:
            with self.assertRaises(StorageError):
                self.store.initialize()
        finally:
            with self.store._connect() as connection:
                connection.execute("UPDATE dbo.metadata SET [value] = N'1' WHERE [key] = N'schema_version'")


@unittest.skipUnless(os.environ.get("VISIONFACE_TEST_SQLSERVER"), "SQL Server integration tests are opt-in")
class SqlServerAPITests(TemporarySqlDatabase, api_tests.DatabaseAPITests):
    def setUp(self):
        super().setUp()
        self.store = SqlServerFaceStore(self.store_string)
        self.store.clear()
        patcher = patch.object(server, "face_database", self.store)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_failed_storage_write_returns_500_and_rolls_back(self):
        with self.store._connect() as connection:
            connection.execute("""CREATE TRIGGER dbo.reject_sample ON dbo.face_samples AFTER INSERT AS
                                  BEGIN THROW 51000, 'test failure', 1; END""")
        try:
            with patch("builtins.print"):
                status, data = self.request("POST", "/api/register", {"name": "An", "landmarks": self.points})
            self.assertEqual(status, 500)
            self.assertFalse(data["success"])
            self.assertEqual(self.store.counts(), {"people": 0, "samples": 0})
        finally:
            with self.store._connect() as connection:
                connection.execute("DROP TRIGGER dbo.reject_sample")


if __name__ == "__main__":
    unittest.main()
