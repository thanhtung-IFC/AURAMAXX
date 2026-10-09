"""PostgreSQL storage using the shared face operations and a bounded session pool.

The adapter exposes the application's existing qmark/Row interface. Only SQL
written by this application is translated; values always remain parameters.
"""

import re
import threading
from contextlib import contextmanager
from pathlib import Path

from face_store import FaceStore, StorageError


class Row:
    def __init__(self, columns, values):
        self.columns, self.values = columns, values

    def keys(self):
        return self.columns

    def __getitem__(self, key):
        return self.values[key if isinstance(key, int) else self.columns.index(key)]

    def __iter__(self):
        return iter(self.values)


class Cursor:
    def __init__(self, cursor):
        self.cursor = cursor

    @property
    def description(self):
        return self.cursor.description

    @property
    def rowcount(self):
        return self.cursor.rowcount

    def _row(self, values):
        return None if values is None else Row([c[0] for c in self.description], values)

    def fetchone(self):
        return self._row(self.cursor.fetchone())

    def fetchall(self):
        return [self._row(row) for row in self.cursor.fetchall()]

    def __iter__(self):
        return (self._row(row) for row in self.cursor)


class Connection:
    def __init__(self, raw, store):
        self.raw, self.store = raw, store

    def execute(self, sql, params=None):
        if sql.strip().upper() == "BEGIN IMMEDIATE":
            return self.store._write_lock(self)
        if sql.strip().upper() == "BEGIN":
            sql = "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ"
        # Split literals before replacing placeholders: '?' inside SQL strings
        # is a literal, and parameter contents are never inspected or interpolated.
        parts = re.split(r"('(?:[^']|'')*')", sql)
        for index in range(0, len(parts), 2):
            parts[index] = parts[index].replace("[key]", '"key"').replace("[value]", '"value"')
            if params is not None:
                parts[index] = parts[index].replace("?", "%s")
        return Cursor(self.raw.execute("".join(parts), params))


class PostgresFaceStore(FaceStore):
    backend = "postgres"

    def __init__(self, url, *, schema="visionface", require_tls=True):
        if not isinstance(url, str) or not url.strip():
            raise ValueError("Set DATABASE_URL to the Supabase Session pooler connection string")
        if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", schema):
            raise ValueError("Invalid PostgreSQL schema")
        try:
            import psycopg
            from psycopg.conninfo import conninfo_to_dict, make_conninfo
            from psycopg_pool import ConnectionPool
        except ImportError:
            raise StorageError("Install requirements-postgres.txt") from None
        try:
            options = conninfo_to_dict(url)
            if require_tls and options.get("sslmode", "require") not in ("require", "verify-ca", "verify-full"):
                raise ValueError("PostgreSQL requires TLS (sslmode=require or verify-full)")
            if options.get("port") == "6543":
                raise ValueError("Use Supabase Session pooler port 5432, not Transaction pooler")
            url = make_conninfo(url, sslmode=options.get("sslmode", "require"), connect_timeout=15)
        except psycopg.Error:
            raise ValueError("Invalid DATABASE_URL; copy the PostgreSQL Session pooler string") from None
        self.schema = schema
        self._lock = threading.RLock()
        self._cache_revision, self._cache = None, {}
        self._pool = ConnectionPool(url, min_size=0, max_size=5, timeout=20,
                                    open=False, kwargs={"prepare_threshold": None},
                                    configure=self._configure)
        self._opened = False

    def _configure(self, connection):
        # Schema is validated above; never search the public schema.
        connection.execute(f'SET search_path TO "{self.schema}"')
        connection.execute("SET statement_timeout = '20s'")
        connection.execute("SET lock_timeout = '10s'")
        connection.commit()

    @contextmanager
    def _connect(self):
        import psycopg
        from psycopg_pool import PoolTimeout
        with self._lock:
            if not self._opened:
                self._pool.open()
                self._opened = True
        try:
            with self._pool.connection() as raw:
                yield Connection(raw, self)
        except (psycopg.Error, PoolTimeout):
            # Driver messages can contain hosts, credentials or failing row data.
            raise StorageError("PostgreSQL operation failed; check connection, schema and constraints") from None

    def _write_lock(self, connection):
        return connection.execute("SELECT pg_advisory_xact_lock(hashtext(?))", (self.schema + ".write",))

    @staticmethod
    def _bump_revision(connection):
        connection.execute("UPDATE metadata SET value = (value::bigint + 1)::text WHERE key = 'revision'")

    def initialize(self):
        with self._connect() as connection:
            self._write_lock(connection)
            connection.execute(f'CREATE SCHEMA IF NOT EXISTS "{self.schema}"')
            connection.execute(f'REVOKE ALL ON SCHEMA "{self.schema}" FROM PUBLIC')
            connection.execute((Path(__file__).with_name("sql") / "schema_postgres.sql").read_text(encoding="utf-8"))
            version = connection.execute("SELECT value FROM metadata WHERE key = 'schema_version'").fetchone()
            if version and version[0] != "1":
                raise StorageError("Unsupported PostgreSQL schema version")
            connection.execute("INSERT INTO metadata VALUES ('schema_version', '1') ON CONFLICT DO NOTHING")
            for table in ("metadata", "people", "face_samples"):
                connection.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")

    def close(self):
        self._pool.close()
