"""Transactional face storage and one-time migration of the legacy JSON file."""

import json
import math
import sqlite3
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

FEATURE_VERSION = "geometric-v1"
VECTOR_DIMENSION = 60
SCHEMA_VERSION = 1


class StorageError(Exception):
    """Database driver or storage failure, distinct from invalid user input."""


class FaceStore:
    backend = "sqlite"
    def __init__(self, path):
        self.path = Path(path).resolve()
        self._lock = threading.RLock()
        self._cache_revision = None
        self._cache = {}

    @contextmanager
    def _connect(self):
        connection = sqlite3.connect(str(self.path), timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def initialize(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._lock, self._connect() as connection:
            version = connection.execute("PRAGMA user_version").fetchone()[0]
            if version > SCHEMA_VERSION:
                raise RuntimeError("Database schema is newer than this application")
            connection.executescript("""
                CREATE TABLE IF NOT EXISTS people (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
                    created_at TEXT NOT NULL,
                    display_date TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS face_samples (
                    id TEXT PRIMARY KEY,
                    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
                    vector_json TEXT NOT NULL,
                    feature_version TEXT NOT NULL,
                    dimension INTEGER NOT NULL CHECK(dimension > 0),
                    landmark_count INTEGER,
                    created_at TEXT NOT NULL,
                    UNIQUE(person_id, feature_version, vector_json)
                );
                CREATE INDEX IF NOT EXISTS samples_person ON face_samples(person_id);
                CREATE INDEX IF NOT EXISTS samples_version ON face_samples(feature_version, dimension);
                CREATE TABLE IF NOT EXISTS metadata (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                INSERT OR IGNORE INTO metadata(key, value) VALUES ('revision', '0');
            """)
            connection.execute("PRAGMA user_version = 1")

    @staticmethod
    def _name(name):
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 120:
            raise ValueError("Name must contain 1 to 120 characters")
        return name.strip()

    @staticmethod
    def _vector(vector):
        if not isinstance(vector, (list, tuple)) or len(vector) != VECTOR_DIMENSION:
            raise ValueError("Face vector must contain exactly 60 numbers")
        if any(isinstance(value, bool) or not isinstance(value, (int, float))
               or not math.isfinite(value) for value in vector):
            raise ValueError("Face vector must contain finite numbers")
        return json.dumps([float(value) for value in vector], separators=(",", ":"), allow_nan=False)

    @staticmethod
    def _timestamps():
        now = datetime.now(timezone.utc)
        return now.isoformat(timespec="microseconds"), now.astimezone(
            timezone(timedelta(hours=7))
        ).strftime("%H:%M:%S")

    @staticmethod
    def _bump_revision(connection):
        connection.execute("UPDATE metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'revision'")

    def migrate_json(self, legacy_path):
        """Import all records atomically once. Never modify or remove the source."""
        legacy_path = Path(legacy_path)
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if connection.execute("SELECT 1 FROM metadata WHERE key = 'legacy_json_imported'").fetchone():
                return 0
            if not legacy_path.exists():
                return 0
            records = json.loads(legacy_path.read_text(encoding="utf-8-sig"))
            if not isinstance(records, list):
                raise ValueError("Legacy JSON database must be a list")
            seen, prepared = set(), []
            for record in records:
                if not isinstance(record, dict):
                    raise ValueError("Invalid legacy face record")
                person_id = record.get("id")
                if not isinstance(person_id, str) or not person_id.strip() or person_id in seen:
                    raise ValueError("Legacy face IDs must be nonempty and unique")
                seen.add(person_id)
                name = self._name(record.get("name"))
                vector = self._vector(record.get("vector"))
                display_date = record.get("date", "")
                if not isinstance(display_date, str):
                    raise ValueError("Invalid legacy registration date")
                prepared.append((person_id, name, vector, display_date))
            imported = 0
            for person_id, name, vector, display_date in prepared:
                if connection.execute("SELECT 1 FROM people WHERE id = ?", (person_id,)).fetchone():
                    raise ValueError("Legacy face ID conflicts with an existing person: " + person_id)
                created_at, _ = self._timestamps()
                connection.execute("INSERT INTO people VALUES (?, ?, ?, ?)",
                                   (person_id, name, created_at, display_date))
                connection.execute("INSERT INTO face_samples VALUES (?, ?, ?, ?, ?, ?, ?)",
                                   ("smp_" + uuid.uuid4().hex, person_id, vector,
                                    FEATURE_VERSION, VECTOR_DIMENSION, None, created_at))
                imported += 1
            connection.execute("INSERT INTO metadata VALUES ('legacy_json_imported', ?)",
                               (self._timestamps()[0],))
            self._bump_revision(connection)
            return imported

    def register(self, name, vector, person_id=None, landmark_count=None, feature_version=FEATURE_VERSION):
        name, vector_json = self._name(name), self._vector(vector)
        if not isinstance(feature_version, str) or not 1 <= len(feature_version) <= 64:
            raise ValueError("Invalid feature version")
        if landmark_count is not None and (type(landmark_count) is not int or landmark_count < 468):
            raise ValueError("Invalid landmark count")
        if person_id is not None and (not isinstance(person_id, str) or not person_id.strip()):
            raise ValueError("Invalid person ID")
        created_at, display_date = self._timestamps()
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            if person_id is None:
                person_id = "usr_" + uuid.uuid4().hex
                connection.execute("INSERT INTO people VALUES (?, ?, ?, ?)",
                                   (person_id, name, created_at, display_date))
            else:
                person = connection.execute("SELECT name FROM people WHERE id = ?", (person_id,)).fetchone()
                if person is None:
                    raise KeyError(person_id)
                if person["name"] != name:
                    raise ValueError("Name does not match the selected person")
            connection.execute("""
                INSERT INTO face_samples VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(person_id, feature_version, vector_json) DO NOTHING
            """, ("smp_" + uuid.uuid4().hex, person_id, vector_json, feature_version,
                  VECTOR_DIMENSION, landmark_count, created_at))
            self._bump_revision(connection)
            return self._person_summary(connection, person_id)

    @staticmethod
    def _person_summary(connection, person_id):
        row = connection.execute("""
            SELECT p.id, p.name, p.created_at, p.display_date AS date, COUNT(s.id) AS sample_count
            FROM people p LEFT JOIN face_samples s ON s.person_id = p.id
            WHERE p.id = ? GROUP BY p.id
        """, (person_id,)).fetchone()
        return dict(row) if row else None

    def list_people(self):
        with self._connect() as connection:
            return [dict(row) for row in connection.execute("""
                SELECT p.id, p.name, p.created_at, p.display_date AS date, COUNT(s.id) AS sample_count
                FROM people p LEFT JOIN face_samples s ON s.person_id = p.id
                GROUP BY p.id ORDER BY p.created_at, p.id
            """)]

    def counts(self):
        with self._connect() as connection:
            row = connection.execute("""
                SELECT (SELECT COUNT(*) FROM people) AS people,
                       (SELECT COUNT(*) FROM face_samples) AS samples
            """).fetchone()
            return dict(row)

    def matching_faces(self, feature_version=FEATURE_VERSION):
        """Cache decoded vectors; a revision check also detects writes by another store."""
        with self._lock, self._connect() as connection:
            connection.execute("BEGIN")
            revision = connection.execute("SELECT value FROM metadata WHERE key = 'revision'").fetchone()[0]
            if revision != self._cache_revision:
                self._cache.clear()
                self._cache_revision = revision
            if feature_version not in self._cache:
                self._cache[feature_version] = [
                    {"id": row["id"], "name": row["name"], "sample_id": row["sample_id"],
                     "vector": json.loads(row["vector_json"])}
                    for row in connection.execute("""
                        SELECT p.id, p.name, s.id AS sample_id, s.vector_json
                        FROM face_samples s JOIN people p ON p.id = s.person_id
                        WHERE s.feature_version = ? AND s.dimension = ? ORDER BY s.created_at, s.id
                    """, (feature_version, VECTOR_DIMENSION))
                ]
            return self._cache[feature_version]

    def delete_person(self, person_id):
        if not isinstance(person_id, str) or not person_id.strip():
            raise ValueError("Invalid person ID")
        with self._lock, self._connect() as connection:
            deleted = connection.execute("DELETE FROM people WHERE id = ?", (person_id,)).rowcount
            if deleted:
                self._bump_revision(connection)
            return bool(deleted)

    def clear(self):
        with self._lock, self._connect() as connection:
            connection.execute("DELETE FROM people")
            self._bump_revision(connection)
