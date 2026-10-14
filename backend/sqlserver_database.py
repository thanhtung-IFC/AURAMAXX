"""SQL Server storage for AURAMAXX in the owner's existing VisionFace database."""

import re
import sqlite3

from backend.settings import PROJECT_ROOT
from database_config import load_settings
from sql_server_store import connection_string


TABLE_KEYS = {
    "schema_version": "version", "users": "id", "sessions": "token_hash",
    "user_consents": "id", "habit_entries": "id", "ai_conversations": "id",
    "ai_messages": "id", "ai_request_limits": "id", "arena_profiles": "user_id",
    "arena_matches": "id", "arena_match_participants": "match_id", "arena_elo_history": "id",
    "arena_achievements": "user_id", "arena_bot_profiles": "user_id", "arena_bot_matches": "id",
    "legacy_account_links": "user_id", "data_handoffs": "id", "admin_feature_flags": "feature_key",
    "health_routines": "user_id",
}


def translate_sql(query, parameters=()):
    sql = query.strip().rstrip(";")
    values = tuple(parameters)
    if re.fullmatch(r"BEGIN\s+IMMEDIATE", sql, re.I):
        return """SET NOCOUNT ON;
            IF @@TRANCOUNT = 0 BEGIN TRANSACTION;
            DECLARE @result INT;
            EXEC @result = sys.sp_getapplock @Resource=N'AURAMAXX.write',
              @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000;
            IF @result < 0 THROW 51000, 'Could not obtain application write lock', 1;
            SELECT @result AS lock_result;""", values
    ignored = re.match(r"INSERT\s+OR\s+IGNORE\s+INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\((.*?)\)\s*$", sql, re.I | re.S)
    if ignored:
        table, columns, placeholders = ignored.groups()
        key = TABLE_KEYS[table]
        column_list = [item.strip() for item in columns.split(",")]
        key_value = values[column_list.index(key)]
        sql = f"""IF NOT EXISTS (SELECT 1 FROM {table} WITH (UPDLOCK, HOLDLOCK) WHERE [{key}] = ?)
          INSERT INTO {table} ({columns}) VALUES ({placeholders})"""
        values = (key_value, *values)
    page = re.search(r"\s+LIMIT\s+\?\s+OFFSET\s+\?\s*$", sql, re.I)
    if page:
        sql = sql[:page.start()] + " OFFSET ? ROWS FETCH NEXT ? ROWS ONLY"
        values = (*values[:-2], values[-1], values[-2])
    else:
        limit = re.search(r"\s+LIMIT\s+(\d+)\s*$", sql, re.I)
        if limit:
            sql = sql[:limit.start()]
            sql = re.sub(r"^SELECT\s+", f"SELECT TOP ({limit.group(1)}) ", sql, count=1, flags=re.I)
    sql = re.sub(r"COLLATE\s+NOCASE", "COLLATE Latin1_General_100_CI_AS_SC", sql, flags=re.I)
    sql = re.sub(r"\)\s+WHERE\s+rank\s*=", ") AS latest_consents WHERE rank =", sql, flags=re.I)
    names = "|".join(sorted(TABLE_KEYS, key=len, reverse=True))
    sql = re.sub(rf"\b(FROM|JOIN|INTO|UPDATE|REFERENCES)\s+({names})\b",
                 lambda match: f"{match[1]} [auramaxx].[{match[2]}]", sql, flags=re.I)
    return sql, values


class SqlServerCursor:
    def __init__(self, cursor):
        self._cursor = cursor

    @property
    def description(self):
        return self._cursor.description

    @property
    def rowcount(self):
        return self._cursor.rowcount

    def _row(self, row):
        if row is None:
            return None
        from backend.database import DatabaseRow
        return DatabaseRow(zip((column[0] for column in self.description), row))

    def fetchone(self):
        return self._row(self._cursor.fetchone())

    def fetchall(self):
        return [self._row(row) for row in self._cursor.fetchall()]


class SqlServerConnection:
    backend = "sqlserver"

    def __init__(self, connection):
        self._connection = connection

    def execute(self, query, parameters=()):
        import pyodbc
        sql, values = translate_sql(query, parameters)
        try:
            return SqlServerCursor(self._connection.execute(sql, values))
        except pyodbc.IntegrityError as error:
            raise sqlite3.IntegrityError("SQL Server constraint violation") from error

    def executemany(self, query, parameters):
        for values in parameters:
            self.execute(query, values)

    def executescript(self, script):
        for batch in re.split(r"^\s*GO\s*$", script, flags=re.M | re.I):
            if batch.strip():
                self._connection.execute(batch)

    def commit(self):
        self._connection.commit()

    def rollback(self):
        self._connection.rollback()

    def close(self):
        self._connection.close()


def connect_sqlserver():
    import os
    import pyodbc
    settings = load_settings(PROJECT_ROOT)
    dsn = connection_string(settings.get("server", r"localhost\SQLEXPRESS"),
                            settings.get("database", "VisionFaceDB"),
                            settings.get("driver", "ODBC Driver 18 for SQL Server"),
                            settings.get("trust_certificate", False),
                            username=os.getenv("SQLSERVER_USERNAME"), password=os.getenv("SQLSERVER_PASSWORD"))
    connection = pyodbc.connect(dsn, timeout=15)
    connection.timeout = 20
    connection.execute("SET XACT_ABORT ON")
    return SqlServerConnection(connection)


def initialize_sqlserver(connection):
    connection.executescript((PROJECT_ROOT / "sql" / "auramaxx_schema.sql").read_text(encoding="utf-8"))
    connection.commit()
