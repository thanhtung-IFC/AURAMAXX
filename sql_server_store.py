"""SQL Server adapter using the same face-store interface as SQLite."""

import hashlib
import json
import sqlite3
import threading
import uuid
from contextlib import closing, contextmanager, suppress
from pathlib import Path

from face_store import FaceStore, FEATURE_VERSION, SCHEMA_VERSION, VECTOR_DIMENSION, StorageError


def odbc_value(value):
    """Quote a connection-string value, including semicolons and closing braces."""
    return "{" + str(value).replace("}", "}}") + "}"


def connection_string(server, database, driver="ODBC Driver 18 for SQL Server", trust_certificate=False,
                      *, username=None, password=None):
    if (username is None) != (password is None):
        raise ValueError("SQLSERVER_USERNAME and SQLSERVER_PASSWORD must be set together")
    if username is not None and (not isinstance(username, str) or not username.strip()
                                 or not isinstance(password, str) or not password):
        raise ValueError("SQL Server credentials must not be empty")
    authentication = (f"UID={odbc_value(username)};PWD={odbc_value(password)};"
                      if username is not None else "Trusted_Connection=yes;")
    return (
        f"DRIVER={odbc_value(driver)};SERVER={odbc_value(server)};"
        f"DATABASE={odbc_value(database)};{authentication}Encrypt=yes;"
        f"TrustServerCertificate={'yes' if trust_certificate else 'no'};"
    )


class SqlServerFaceStore:
    backend = "sqlserver"
    _name = staticmethod(FaceStore._name)
    _vector = staticmethod(FaceStore._vector)
    _timestamps = staticmethod(FaceStore._timestamps)
    _audit_action = staticmethod(FaceStore._audit_action)
    _check_owner = staticmethod(FaceStore._check_owner)

    def __init__(self, connection):
        self.connection_string = connection
        self._lock = threading.RLock()
        self._cache_revision = None
        self._cache = {}

    @contextmanager
    def _connect(self):
        try:
            import pyodbc
        except ImportError as error:
            raise StorageError("Install requirements-sqlserver.txt to use SQL Server") from error
        connection = None
        try:
            connection = pyodbc.connect(self.connection_string, timeout=60)
            connection.timeout = 15
            connection.execute("SET XACT_ABORT ON")
            yield connection
            connection.commit()
        except pyodbc.Error as error:
            if connection is not None:
                with suppress(pyodbc.Error):
                    connection.rollback()
            raise StorageError(f"SQL Server operation failed ({error.args[0] if error.args else 'unknown'})") from error
        except BaseException:
            if connection is not None:
                with suppress(pyodbc.Error):
                    connection.rollback()
            raise
        finally:
            if connection is not None:
                connection.close()

    @staticmethod
    def _rows(cursor):
        columns = [column[0] for column in cursor.description]
        return [dict(zip(columns, row)) for row in cursor.fetchall()]

    @staticmethod
    def _write_lock(connection):
        row = connection.execute("""
            DECLARE @result INT;
            EXEC @result = sys.sp_getapplock
                @Resource = N'VisionFace.write', @LockMode = 'Exclusive',
                @LockOwner = 'Transaction', @LockTimeout = 10000;
            SELECT @result;
        """).fetchone()
        if row[0] < 0:
            raise StorageError("Could not obtain the database write lock")

    def initialize(self):
        with self._lock, self._connect() as connection:
            self._write_lock(connection)
            if connection.execute("SELECT OBJECT_ID(N'dbo.metadata', N'U')").fetchone()[0] is not None:
                row = connection.execute("SELECT [value] FROM dbo.metadata WHERE [key] = N'schema_version'").fetchone()
                if row is None or int(row[0]) != SCHEMA_VERSION:
                    raise StorageError("Unsupported SQL Server schema version")
            schema = Path(__file__).with_name("sql") / "schema.sql"
            connection.execute(schema.read_text(encoding="utf-8"))
            # Changes made in SSMS also invalidate the vector cache.
            for table in ("people", "face_samples"):
                connection.execute(f"""
                    CREATE OR ALTER TRIGGER dbo.{table}_revision ON dbo.{table}
                    AFTER INSERT, UPDATE, DELETE AS
                    BEGIN
                        SET NOCOUNT ON;
                        UPDATE dbo.metadata
                        SET [value] = CONVERT(NVARCHAR(256), CONVERT(BIGINT, [value]) + 1)
                        WHERE [key] = N'revision';
                    END;
                """)

    def counts(self):
        with self._connect() as connection:
            return self._rows(connection.execute("""
                SELECT (SELECT COUNT(*) FROM dbo.people) AS people,
                       (SELECT COUNT(*) FROM dbo.face_samples) AS samples
            """))[0]

    @staticmethod
    def _person_summary(connection, person_id):
        rows = SqlServerFaceStore._rows(connection.execute("""
            SELECT p.id, p.name, p.created_at, p.display_date AS date, COUNT(s.id) AS sample_count
            FROM dbo.people p LEFT JOIN dbo.face_samples s ON s.person_id = p.id
            WHERE p.id = ? GROUP BY p.id, p.name, p.created_at, p.display_date
        """, person_id))
        return rows[0] if rows else None

    def list_people(self):
        with self._connect() as connection:
            return self._rows(connection.execute("""
                SELECT p.id, p.name, p.created_at, p.display_date AS date, COUNT(s.id) AS sample_count
                FROM dbo.people p LEFT JOIN dbo.face_samples s ON s.person_id = p.id
                GROUP BY p.id, p.name, p.created_at, p.display_date ORDER BY p.created_at, p.id
            """))

    def register(self, name, vector, person_id=None, landmark_count=None, feature_version=FEATURE_VERSION,
                 owner_account_id=None, actor_id=None, access_account_id=None):
        name, vector_json = self._name(name), self._vector(vector)
        if not isinstance(feature_version, str) or not 1 <= len(feature_version) <= 64:
            raise ValueError("Invalid feature version")
        if landmark_count is not None and (type(landmark_count) is not int or landmark_count < 468):
            raise ValueError("Invalid landmark count")
        if person_id is not None:
            self._validate_id(person_id)
        created_at, display_date = self._timestamps()
        vector_hash = hashlib.sha256(vector_json.encode("utf-8")).digest()
        with self._lock, self._connect() as connection:
            self._write_lock(connection)
            if person_id is None:
                person_id = "usr_" + uuid.uuid4().hex
                connection.execute("INSERT INTO dbo.people (id, name, created_at, display_date) VALUES (?, ?, ?, ?)",
                                   person_id, name, created_at, display_date)
                if owner_account_id:
                    connection.execute("INSERT INTO dbo.account_people (person_id, account_id) VALUES (?, ?)",
                                       person_id, owner_account_id)
            else:
                self._check_owner(connection, person_id, access_account_id)
                row = connection.execute("SELECT name FROM dbo.people WHERE id = ?", person_id).fetchone()
                if row is None:
                    raise KeyError(person_id)
                if row[0] != name:
                    raise ValueError("Name does not match the selected person")
            existing = connection.execute("""
                SELECT id FROM dbo.face_samples
                WHERE person_id = ? AND feature_version = ? AND vector_hash = ?
            """, person_id, feature_version, vector_hash).fetchone()
            if existing is None:
                connection.execute("""
                    INSERT INTO dbo.face_samples
                        (id, person_id, vector_json, vector_hash, feature_version, dimension, landmark_count, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, "smp_" + uuid.uuid4().hex, person_id, vector_json, vector_hash,
                                   feature_version, VECTOR_DIMENSION, landmark_count, created_at)
            self._audit_action(connection, actor_id, "person.sample_saved", person_id)
            return self._person_summary(connection, person_id)

    def matching_faces(self, feature_version=FEATURE_VERSION):
        with self._lock, self._connect() as connection:
            revision = connection.execute("SELECT [value] FROM dbo.metadata WHERE [key] = N'revision'").fetchone()[0]
            if revision != self._cache_revision:
                self._cache.clear()
                self._cache_revision = revision
            if feature_version not in self._cache:
                rows = self._rows(connection.execute("""
                    SELECT p.id, p.name, s.id AS sample_id, s.vector_json
                    FROM dbo.face_samples s JOIN dbo.people p ON p.id = s.person_id
                    WHERE s.feature_version = ? AND s.dimension = ? ORDER BY s.created_at, s.id
                """, feature_version, VECTOR_DIMENSION))
                self._cache[feature_version] = [
                    {"id": row["id"], "name": row["name"], "sample_id": row["sample_id"],
                     "vector": json.loads(row["vector_json"])} for row in rows
                ]
            return self._cache[feature_version]

    @staticmethod
    def _validate_id(person_id):
        if not isinstance(person_id, str) or not person_id.strip() or len(person_id) > 128:
            raise ValueError("Invalid person ID")

    def delete_person(self, person_id, actor_id=None, access_account_id=None):
        self._validate_id(person_id)
        with self._lock, self._connect() as connection:
            self._write_lock(connection)
            self._check_owner(connection, person_id, access_account_id)
            exists = connection.execute("SELECT id FROM dbo.people WHERE id = ?", person_id).fetchone()
            if exists is None:
                return False
            connection.execute("DELETE FROM dbo.people WHERE id = ?", person_id)
            self._audit_action(connection, actor_id, "person.deleted", person_id)
            return True

    def clear(self, actor_id=None):
        with self._lock, self._connect() as connection:
            self._write_lock(connection)
            connection.execute("DELETE FROM dbo.people")
            self._audit_action(connection, actor_id, "people.cleared")

    def import_sqlite(self, source):
        """Import one consistent SQLite snapshot once; preserve IDs, dates and all samples."""
        source = Path(source).resolve()
        with closing(sqlite3.connect(source.as_uri() + "?mode=ro", uri=True)) as origin:
            origin.row_factory = sqlite3.Row
            if origin.execute("PRAGMA user_version").fetchone()[0] != SCHEMA_VERSION:
                raise ValueError("Unsupported source SQLite schema version")
            origin.execute("BEGIN")
            people = [dict(row) for row in origin.execute("SELECT * FROM people")]
            samples = [dict(row) for row in origin.execute("SELECT * FROM face_samples")]
        # Validate everything before the first destination write.
        person_ids = set()
        for person in people:
            self._validate_id(person["id"])
            self._name(person["name"])
            person_ids.add(person["id"])
        for sample in samples:
            self._validate_id(sample["id"])
            if sample["person_id"] not in person_ids or sample["dimension"] != VECTOR_DIMENSION:
                raise ValueError("Invalid source sample")
            if not isinstance(sample["feature_version"], str) or not 1 <= len(sample["feature_version"]) <= 64:
                raise ValueError("Invalid feature version")
            sample["vector_json"] = self._vector(json.loads(sample["vector_json"]))
            sample["vector_hash"] = hashlib.sha256(sample["vector_json"].encode("utf-8")).digest()
        with self._lock, self._connect() as connection:
            self._write_lock(connection)
            marker = connection.execute("SELECT [value] FROM dbo.metadata WHERE [key] = N'sqlite_imported'").fetchone()
            if marker is not None:
                return {"people": 0, "samples": 0}
            if connection.execute("SELECT COUNT(*) FROM dbo.people").fetchone()[0]:
                raise ValueError("Destination must be empty before the first SQLite import")
            for person in people:
                connection.execute("INSERT INTO dbo.people (id, name, created_at, display_date) VALUES (?, ?, ?, ?)",
                                   person["id"], person["name"], person["created_at"], person["display_date"])
            for sample in samples:
                connection.execute("""
                    INSERT INTO dbo.face_samples
                        (id, person_id, vector_json, vector_hash, feature_version, dimension, landmark_count, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, sample["id"], sample["person_id"], sample["vector_json"], sample["vector_hash"],
                                   sample["feature_version"], sample["dimension"], sample["landmark_count"], sample["created_at"])
            connection.execute("INSERT INTO dbo.metadata ([key], [value]) VALUES (N'sqlite_imported', ?)",
                               self._timestamps()[0])
            return {"people": len(people), "samples": len(samples)}
