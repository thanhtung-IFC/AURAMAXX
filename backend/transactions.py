"""One transaction for application rows and their linked identity/face rows."""

import re
from collections.abc import Mapping
from contextlib import contextmanager
from pathlib import Path

from fastapi import HTTPException


_FACE_TABLES = "accounts|account_people|auth_sessions|audit_logs|people|face_samples|metadata|user_data"


class IdentityCursor:
    """Keep the tuple-row contract expected by the existing face/auth stores."""

    def __init__(self, cursor):
        self.cursor = cursor

    def __getattr__(self, name):
        return getattr(self.cursor, name)

    @staticmethod
    def _row(row):
        return tuple(row.values()) if isinstance(row, Mapping) else row

    def fetchone(self):
        return self._row(self.cursor.fetchone())

    def fetchall(self):
        return [self._row(row) for row in self.cursor.fetchall()]


class IdentityConnection:
    def __init__(self, connection, schema, backend):
        self.connection, self.schema, self.backend = connection, schema, backend

    def execute(self, query, parameters=()):
        # Rewrite only SQL identifiers, never literal text or parameter values.
        parts = re.split(r"('(?:[^']|'')*')", query)
        for index in range(0, len(parts), 2):
            part = parts[index]
            if self.backend == "postgres":
                part = part.replace("[key]", '"key"').replace("[value]", '"value"')
            parts[index] = re.sub(
                rf"\b(FROM|JOIN|INTO|UPDATE)\s+({_FACE_TABLES})\b",
                lambda match: f'{match[1]} "{self.schema}"."{match[2]}"',
                part, flags=re.IGNORECASE,
            )
        return IdentityCursor(self.connection.execute("".join(parts), parameters))


def _postgres_schema(connection, auth):
    from psycopg.conninfo import conninfo_to_dict
    source = conninfo_to_dict(auth.faces._pool.conninfo)
    target = connection._connection.info
    # A shared pooler host can serve many projects, so include its login user.
    expected = (source.get("host", ""), str(source.get("port", "5432")), source.get("dbname"), source.get("user"))
    actual = (target.host, str(target.port), target.dbname, target.user)
    if expected != actual:
        raise HTTPException(503, "Cần cấu hình dữ liệu ứng dụng và khuôn mặt cùng database để thực hiện giao dịch an toàn.")
    if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", auth.faces.schema):
        raise ValueError("Invalid face schema")
    return auth.faces.schema


@contextmanager
def identity_transaction(connection, auth=None):
    """Commit once; roll back identity, application and audit writes together.

    PostgreSQL/SQL Server use qualified tables on the application connection.
    Local SQLite attaches the face file before starting the write transaction.
    Different servers/backends fail before any write rather than partially commit.
    """
    if auth is None:
        from backend.identity import legacy_auth
        auth = legacy_auth()
    backend = getattr(connection, "backend", "sqlite")
    if backend != auth.faces.backend:
        raise HTTPException(503, "Cần chuyển dữ liệu ứng dụng và khuôn mặt về cùng hệ quản trị database để thực hiện giao dịch an toàn.")
    attached = False
    try:
        if backend == "sqlite":
            main_file = next(row[2] for row in connection.execute("PRAGMA database_list").fetchall() if row[1] == "main")
            if main_file and Path(main_file).resolve() == auth.faces.path.resolve():
                schema = "main"
            else:
                schema = "identity_faces"
                connection.execute('ATTACH DATABASE ? AS "identity_faces"', (str(auth.faces.path),))
                attached = True
            connection.execute("BEGIN IMMEDIATE")
        elif backend == "postgres":
            schema = _postgres_schema(connection, auth)
            # Same lock as AuthStore/FaceStore, on this transaction's connection.
            connection.execute("SELECT pg_advisory_xact_lock(hashtext(?))", (schema + ".write",))
        elif backend == "sqlserver":
            location_query = "SELECT DB_NAME() AS database_name, @@SERVERNAME AS server_name"
            with auth.faces._connect() as source:
                source_location = tuple(source.execute(location_query).fetchone())
            target_location = tuple(connection.execute(location_query).fetchone().values())
            if source_location != target_location:
                raise HTTPException(503, "Cần cấu hình hai schema trong cùng SQL Server database.")
            schema = "dbo"
            connection.execute("IF @@TRANCOUNT = 0 BEGIN TRANSACTION")
            auth.faces._write_lock(connection)
        else:
            raise ValueError("Unsupported transaction backend")
        yield IdentityConnection(connection, schema, backend)
        connection.commit()
    except BaseException:
        connection.rollback()
        raise
    finally:
        if attached:
            connection.execute('DETACH DATABASE "identity_faces"')
