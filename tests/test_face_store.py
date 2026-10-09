import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from face_store import FaceStore, FEATURE_VERSION


class FaceStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / "faces.sqlite3"
        self.store = FaceStore(self.path)
        self.store.initialize()
        self.vector = [0.1] * 60
        self.legacy = Path(self.temp.name) / "face_database.json"

    def legacy_record(self, person_id="legacy-id"):
        return {"id": person_id, "name": "Nguy\u1ec5n An", "date": "12:34:56", "vector": self.vector}

    def write_legacy(self, records):
        self.legacy.write_text(json.dumps(records, ensure_ascii=False), encoding="utf-8")

    def test_migration_preserves_source_and_ids_and_runs_once(self):
        self.write_legacy([self.legacy_record()])
        original = self.legacy.read_bytes()
        self.assertEqual(self.store.migrate_json(self.legacy), 1)
        self.assertEqual(self.legacy.read_bytes(), original)
        person = self.store.list_people()[0]
        self.assertEqual(person["id"], "legacy-id")
        self.assertEqual(person["name"], "Nguy\u1ec5n An")
        self.assertEqual(person["date"], "12:34:56")
        self.assertEqual(person["sample_count"], 1)
        self.assertEqual(self.store.matching_faces()[0]["vector"], self.vector)
        self.assertEqual(self.store.migrate_json(self.legacy), 0)
        self.store.clear()
        self.assertEqual(self.store.migrate_json(self.legacy), 0)
        self.assertEqual(self.store.counts(), {"people": 0, "samples": 0})

    def test_invalid_migration_rolls_back_and_can_be_retried(self):
        invalid = self.legacy_record("invalid")
        invalid["vector"] = [0.1]
        self.write_legacy([self.legacy_record(), invalid])
        original = self.legacy.read_bytes()
        with self.assertRaises(ValueError):
            self.store.migrate_json(self.legacy)
        self.assertEqual(self.store.counts(), {"people": 0, "samples": 0})
        self.assertEqual(self.legacy.read_bytes(), original)
        self.write_legacy([self.legacy_record()])
        self.assertEqual(self.store.migrate_json(self.legacy), 1)

    def test_conflict_rolls_back_preceding_imports(self):
        existing = self.store.register("Existing", self.vector)
        self.write_legacy([self.legacy_record(), self.legacy_record(existing["id"])])
        with self.assertRaises(ValueError):
            self.store.migrate_json(self.legacy)
        self.assertEqual(self.store.counts(), {"people": 1, "samples": 1})
        self.assertEqual(self.store.list_people()[0]["id"], existing["id"])

    def test_duplicate_legacy_ids_are_not_silently_merged(self):
        self.write_legacy([self.legacy_record(), self.legacy_record()])
        with self.assertRaises(ValueError):
            self.store.migrate_json(self.legacy)
        self.assertEqual(self.store.counts()["people"], 0)

    def test_same_name_can_belong_to_two_people(self):
        a = self.store.register("Same name", self.vector)
        b = self.store.register("Same name", self.vector)
        self.assertNotEqual(a["id"], b["id"])
        self.assertEqual(self.store.counts()["people"], 2)

    def test_multiple_samples_and_duplicate_sample_are_persistent(self):
        person = self.store.register("An", self.vector, landmark_count=478)
        vector2 = self.vector.copy()
        vector2[1] = 0.2
        updated = self.store.register("An", vector2, person_id=person["id"], landmark_count=478)
        self.assertEqual(updated["sample_count"], 2)
        self.assertEqual(self.store.register("An", vector2, person_id=person["id"])["sample_count"], 2)
        reopened = FaceStore(self.path)
        reopened.initialize()
        self.assertEqual(reopened.counts(), {"people": 1, "samples": 2})
        self.assertEqual(len(reopened.matching_faces()), 2)
        self.assertNotIn("vector", reopened.list_people()[0])

    def test_matching_versions_are_separate(self):
        person = self.store.register("An", self.vector)
        self.store.register("An", [0.2] * 60, person_id=person["id"], feature_version="future-v2")
        self.assertEqual(len(self.store.matching_faces()), 1)
        self.assertEqual(len(self.store.matching_faces("future-v2")), 1)
        self.assertEqual(len(self.store.matching_faces("unknown")), 0)

    def test_cache_refreshes_after_writes_by_another_instance(self):
        other = FaceStore(self.path)
        self.assertEqual(self.store.matching_faces(), [])
        person = other.register("An", self.vector)
        self.assertEqual(len(self.store.matching_faces()), 1)
        self.assertTrue(other.delete_person(person["id"]))
        self.assertEqual(self.store.matching_faces(), [])
        self.assertFalse(other.delete_person(person["id"]))

    def test_deletion_cascades_to_samples(self):
        person = self.store.register("An", self.vector)
        self.store.register("An", [0.2] * 60, person_id=person["id"])
        self.assertTrue(self.store.delete_person(person["id"]))
        self.assertEqual(self.store.counts(), {"people": 0, "samples": 0})

    def test_validation_never_leaves_partial_people(self):
        for vector in ([1], [float("nan")] * 60, [float("inf")] * 60, [True] * 60, ["1"] * 60):
            with self.subTest(vector_type=type(vector[0])):
                with self.assertRaises(ValueError):
                    self.store.register("An", vector)
        for name in (None, "", " ", "x" * 121):
            with self.assertRaises(ValueError):
                self.store.register(name, self.vector)
        with self.assertRaises(KeyError):
            self.store.register("An", self.vector, person_id="missing")
        self.assertEqual(self.store.counts(), {"people": 0, "samples": 0})

    def test_failed_insert_rolls_back_person_creation(self):
        with closing(sqlite3.connect(self.path)) as connection:
            connection.execute("""CREATE TRIGGER reject_sample BEFORE INSERT ON face_samples
                                  BEGIN SELECT RAISE(ABORT, 'simulated failure'); END""")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store.register("An", self.vector)
        self.assertEqual(self.store.counts(), {"people": 0, "samples": 0})

    def test_sql_text_in_names_is_stored_as_data(self):
        name = "An'); DROP TABLE people; --"
        self.store.register(name, self.vector)
        self.assertEqual(self.store.list_people()[0]["name"], name)

    def test_newer_schema_is_rejected(self):
        with closing(sqlite3.connect(self.path)) as connection:
            connection.execute("PRAGMA user_version = 999")
        with self.assertRaises(RuntimeError):
            FaceStore(self.path).initialize()


if __name__ == "__main__":
    unittest.main()
