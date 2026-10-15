"""Shared SQLite and Supabase PostgreSQL connection helpers."""

import re
import sqlite3
import threading
from contextlib import closing
from pathlib import Path
from typing import Any, Generator, Iterable

from backend.settings import AURAMAXX_DB_BACKEND, DATABASE_PATH, SUPABASE_DATABASE_URL, POSTGRES_SCHEMA


class DatabaseRow(dict[str, Any]):
    """Mapping row that keeps SQLite's integer-column indexing behavior."""

    def __getitem__(self, key: str | int) -> Any:
        if isinstance(key, int):
            return tuple(self.values())[key]
        return super().__getitem__(key)


class PostgresConnection:
    """Small SQLite-compatible adapter for the SQL used by this application."""
    backend = "postgres"

    def __init__(self, connection: Any, release=None) -> None:
        self._connection = connection
        self._release = release
        self._closed = False

    def execute(self, query: str, parameters: Iterable[Any] = ()) -> Any:
        import psycopg

        try:
            return self._connection.execute(_postgres_sql(query), tuple(parameters))
        except psycopg.IntegrityError as error:
            raise sqlite3.IntegrityError(str(error)) from error

    def executemany(self, query: str, parameters: Iterable[Iterable[Any]]) -> Any:
        import psycopg

        try:
            return self._connection.cursor().executemany(
                _postgres_sql(query), parameters
            )
        except psycopg.IntegrityError as error:
            raise sqlite3.IntegrityError(str(error)) from error

    def executescript(self, script: str) -> None:
        statements = [_postgres_sql(statement) for statement in script.split(";") if statement.strip()]
        if statements:
            self._connection.execute(";\n".join(statements), prepare=False)

    def commit(self) -> None:
        self._connection.commit()

    def rollback(self) -> None:
        self._connection.rollback()

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._release:
            release, self._release = self._release, None
            release()
        else:
            self._connection.close()


def _postgres_sql(query: str) -> str:
    """Translate the small set of SQLite syntax used by the backend."""
    sql = query.replace("?", "%s")
    sql = re.sub(
        r"\bBEGIN\s+IMMEDIATE\b",
        "SELECT pg_advisory_xact_lock(1)",
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"\b((?:[A-Za-z_]\w*\.)?email)\s*=\s*%s",
        r"LOWER(\1) = LOWER(%s)",
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"\bdisplay_name\s+COLLATE\s+NOCASE\b",
        "LOWER(display_name)",
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"(\bdisplay_name\s+TEXT\s+NOT NULL)\s+COLLATE\s+NOCASE",
        r"\1",
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"(\bemail\s+TEXT\s+NOT NULL\s+UNIQUE)\s+COLLATE\s+NOCASE",
        r"\1",
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"(ON\s+arena_profiles\s*\()\s*display_name\s+COLLATE\s+NOCASE\s*(\))",
        r"\1LOWER(display_name)\2",
        sql,
        flags=re.IGNORECASE,
    )
    sql = re.sub(
        r"\bDEFAULT\s+CURRENT_TIMESTAMP\b",
        "DEFAULT CURRENT_TIMESTAMP::TEXT",
        sql,
        flags=re.IGNORECASE,
    )
    if re.match(r"\s*INSERT\s+OR\s+IGNORE\s+INTO\b", sql, flags=re.IGNORECASE):
        sql = re.sub(
            r"\bINSERT\s+OR\s+IGNORE\s+INTO\b",
            "INSERT INTO",
            sql,
            count=1,
            flags=re.IGNORECASE,
        ).rstrip().rstrip(";")
        sql += " ON CONFLICT DO NOTHING"
    return sql


def _postgres_row_factory(cursor: Any) -> Any:
    from psycopg.rows import tuple_row
    if cursor.description is None:
        return tuple_row(cursor)
    column_names = [column.name for column in cursor.description]

    def make_row(values: tuple[Any, ...]) -> DatabaseRow:
        return DatabaseRow(zip(column_names, values))

    return make_row


def connect_postgres(url: str, *, schema: str = POSTGRES_SCHEMA) -> PostgresConnection:
    """Connect over TLS with a validated, explicit application schema."""
    import psycopg
    from psycopg import sql
    from psycopg.conninfo import conninfo_to_dict

    if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", schema):
        raise ValueError("Invalid AURAMAXX_POSTGRES_SCHEMA")
    sslmode = conninfo_to_dict(url).get("sslmode", "require")
    if sslmode not in {"require", "verify-ca", "verify-full"}:
        raise ValueError("PostgreSQL requires TLS")


    raw_connection = psycopg.connect(
        url,
        sslmode=sslmode,
        connect_timeout=10,
        prepare_threshold=None,
        row_factory=_postgres_row_factory,
    )
    raw_connection.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
    raw_connection.commit()
    return PostgresConnection(raw_connection)


def connect_database() -> sqlite3.Connection | PostgresConnection:
    """Open the configured Supabase PostgreSQL database or local SQLite file."""
    if AURAMAXX_DB_BACKEND == "sqlserver":
        from backend.sqlserver_database import connect_sqlserver
        return connect_sqlserver()
    if AURAMAXX_DB_BACKEND == "postgres":
        if not SUPABASE_DATABASE_URL:
            raise ValueError("SUPABASE_DATABASE_URL is required for PostgreSQL")
        return _pooled_postgres_connection()

    # Create the local data directory only when using SQLite.
    database_file = Path(DATABASE_PATH)
    database_file.parent.mkdir(parents=True, exist_ok=True)

    # FastAPI chạy hàm sync dependency trong thread pool; endpoint async có thể
    # tiếp tục dùng cùng kết nối sau khi dependency đã chuẩn bị xong.
    connection = sqlite3.connect(database_file, timeout=10, check_same_thread=False)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


_postgres_pool = None
_postgres_pool_lock = threading.Lock()


def _pooled_postgres_connection():
    global _postgres_pool
    from psycopg import sql
    from psycopg.conninfo import conninfo_to_dict
    from psycopg_pool import ConnectionPool
    with _postgres_pool_lock:
        if _postgres_pool is None:
            if not re.fullmatch(r"[a-z][a-z0-9_]{0,62}", POSTGRES_SCHEMA):
                raise ValueError("Invalid AURAMAXX_POSTGRES_SCHEMA")
            sslmode = conninfo_to_dict(SUPABASE_DATABASE_URL).get("sslmode", "require")
            if sslmode not in {"require", "verify-ca", "verify-full"}:
                raise ValueError("PostgreSQL requires TLS")

            def configure(raw):
                raw.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(POSTGRES_SCHEMA)))
                raw.execute("SET statement_timeout = '20s'")
                raw.execute("SET lock_timeout = '8s'")
                raw.commit()

            _postgres_pool = ConnectionPool(SUPABASE_DATABASE_URL, min_size=0, max_size=5,
                timeout=15, open=False, configure=configure,
                kwargs={"connect_timeout": 10, "prepare_threshold": None,
                        "row_factory": _postgres_row_factory, "sslmode": sslmode})
            _postgres_pool.open()
        pool = _postgres_pool
    raw = pool.getconn()
    def release():
        try:
            if not raw.closed:
                raw.rollback()
        finally:
            pool.putconn(raw)
    return PostgresConnection(raw, release=release)


def close_database_pool():
    global _postgres_pool
    with _postgres_pool_lock:
        pool, _postgres_pool = _postgres_pool, None
    if pool is not None:
        pool.close()


def check_database_connection() -> bool:
    """Run a lightweight query to verify the configured database is ready."""
    with closing(connect_database()) as connection:
        connection.execute("SELECT 1").fetchone()
    return True


def initialize_database(connection_factory=None) -> None:
    """Create application tables if needed without deleting existing data."""
    with closing((connection_factory or connect_database)()) as connection:
        if getattr(connection, "backend", None) == "sqlserver":
            from backend.sqlserver_database import initialize_sqlserver
            initialize_sqlserver(connection)
            return
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_version (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        connection.execute(
            "INSERT OR IGNORE INTO schema_version (version) VALUES (1)"
        )
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS admin_feature_flags (
                feature_key TEXT PRIMARY KEY,
                enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            INSERT OR IGNORE INTO admin_feature_flags (feature_key, enabled) VALUES
                ('user_registration', 1), ('aura_ai', 1), ('health_tracking', 1), ('face_analysis', 1), ('arena', 1);

            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                csrf_token TEXT NOT NULL,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

            CREATE TABLE IF NOT EXISTS user_consents (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                purpose TEXT NOT NULL CHECK (purpose IN ('face_analysis', 'health_tracking', 'ai_chat')),
                granted INTEGER NOT NULL CHECK (granted IN (0, 1)),
                policy_version TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_consents_user_purpose_time
                ON user_consents(user_id, purpose, created_at DESC);

            CREATE TABLE IF NOT EXISTS habit_entries (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                category TEXT NOT NULL CHECK (category IN ('water', 'sleep', 'movement', 'self_care')),
                value TEXT NOT NULL,
                unit TEXT NOT NULL DEFAULT '',
                note TEXT NOT NULL DEFAULT '',
                recorded_at TEXT NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_habits_user_recorded
                ON habit_entries(user_id, recorded_at DESC);

            CREATE TABLE IF NOT EXISTS health_routines (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                state_json TEXT NOT NULL,
                revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
                updated_at TEXT NOT NULL
            );

            INSERT OR IGNORE INTO schema_version (version) VALUES (2);

            CREATE TABLE IF NOT EXISTS ai_conversations (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                title TEXT NOT NULL DEFAULT 'Cuộc trò chuyện mới' CHECK (length(title) <= 120),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_updated
                ON ai_conversations(user_id, updated_at DESC);

            CREATE TABLE IF NOT EXISTS ai_messages (
                id TEXT PRIMARY KEY,
                conversation_id TEXT NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
                role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
                content TEXT NOT NULL CHECK (length(content) <= 16000),
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation_time
                ON ai_messages(conversation_id, created_at ASC, id ASC);

            INSERT OR IGNORE INTO schema_version (version) VALUES (3);

            CREATE TABLE IF NOT EXISTS ai_request_limits (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ai_request_limits_user_time
                ON ai_request_limits(user_id, created_at DESC);

            CREATE TABLE IF NOT EXISTS ai_quota_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                daily_limit INTEGER CHECK (daily_limit >= 0),
                monthly_limit INTEGER CHECK (monthly_limit >= 0),
                per_minute INTEGER NOT NULL CHECK (per_minute BETWEEN 1 AND 60),
                global_daily_limit INTEGER CHECK (global_daily_limit >= 0),
                global_monthly_limit INTEGER CHECK (global_monthly_limit >= 0),
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ai_user_quotas (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                daily_limit INTEGER CHECK (daily_limit >= 0),
                monthly_limit INTEGER CHECK (monthly_limit >= 0),
                per_minute INTEGER NOT NULL CHECK (per_minute BETWEEN 1 AND 60),
                enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ai_usage_events (
                id TEXT PRIMARY KEY,
                user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
                created_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_ai_usage_user_time ON ai_usage_events(user_id, created_at);
            CREATE INDEX IF NOT EXISTS idx_ai_usage_time ON ai_usage_events(created_at);

            INSERT OR IGNORE INTO schema_version (version) VALUES (4);

            CREATE TABLE IF NOT EXISTS arena_profiles (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                display_name TEXT NOT NULL COLLATE NOCASE,
                leaderboard_public INTEGER NOT NULL DEFAULT 0 CHECK (leaderboard_public IN (0, 1)),
                elo INTEGER NOT NULL DEFAULT 1000 CHECK (elo >= 0),
                highest_elo INTEGER NOT NULL DEFAULT 1000 CHECK (highest_elo >= 0),
                matches_played INTEGER NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
                wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
                losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
                draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_arena_display_name
                ON arena_profiles(display_name COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_arena_leaderboard
                ON arena_profiles(leaderboard_public, elo DESC, matches_played DESC);

            CREATE TABLE IF NOT EXISTS arena_matches (
                id TEXT PRIMARY KEY,
                status TEXT NOT NULL CHECK (status IN ('queued', 'matched', 'completed', 'cancelled')),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS arena_match_participants (
                match_id TEXT NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                result TEXT CHECK (result IN ('win', 'loss', 'draw')),
                elo_before INTEGER,
                elo_after INTEGER,
                PRIMARY KEY (match_id, user_id)
            );
            CREATE TABLE IF NOT EXISTS arena_elo_history (
                id TEXT PRIMARY KEY,
                match_id TEXT NOT NULL REFERENCES arena_matches(id) ON DELETE CASCADE,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                elo_before INTEGER NOT NULL,
                elo_after INTEGER NOT NULL,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (match_id, user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_arena_elo_history_user
                ON arena_elo_history(user_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS arena_achievements (
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                achievement_key TEXT NOT NULL,
                awarded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, achievement_key)
            );

            INSERT OR IGNORE INTO arena_profiles (user_id, display_name)
            SELECT id, 'Aura-' || upper(substr(replace(id, '-', ''), 1, 10)) FROM users;
            INSERT OR IGNORE INTO schema_version (version) VALUES (5);
            """
        )
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS arena_bot_profiles (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                elo INTEGER NOT NULL DEFAULT 1000 CHECK (elo >= 0),
                highest_elo INTEGER NOT NULL DEFAULT 1000 CHECK (highest_elo >= 0),
                matches_played INTEGER NOT NULL DEFAULT 0 CHECK (matches_played >= 0),
                wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
                losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
                draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS arena_bot_matches (
                id TEXT PRIMARY KEY,
                request_id TEXT NOT NULL,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                bot_id TEXT NOT NULL CHECK (bot_id IN ('rookie', 'casual', 'skilled', 'elite', 'champion')),
                result TEXT NOT NULL CHECK (result IN ('win', 'loss', 'draw')),
                player_score REAL NOT NULL CHECK (player_score BETWEEN 0 AND 100),
                bot_score REAL NOT NULL CHECK (bot_score BETWEEN 0 AND 100),
                bot_elo INTEGER NOT NULL CHECK (bot_elo >= 0),
                elo_before INTEGER NOT NULL CHECK (elo_before >= 0),
                elo_after INTEGER NOT NULL CHECK (elo_after >= 0),
                coverage INTEGER NOT NULL CHECK (coverage BETWEEN 50 AND 100),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE (user_id, request_id)
            );
            CREATE INDEX IF NOT EXISTS idx_arena_bot_matches_user_time
                ON arena_bot_matches(user_id, created_at DESC);
            CREATE TABLE IF NOT EXISTS arena_bot_match_details (
                match_id TEXT PRIMARY KEY REFERENCES arena_bot_matches(id) ON DELETE CASCADE,
                request_fingerprint TEXT NOT NULL,
                details_json TEXT NOT NULL
            );
            INSERT OR IGNORE INTO schema_version (version) VALUES (6);
            """
        )
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (lower(email))"
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS legacy_account_links (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                account_id TEXT NOT NULL UNIQUE,
                credential_hash TEXT NOT NULL
            )"""
        )
        connection.execute(
            """CREATE TABLE IF NOT EXISTS data_handoffs (
                id TEXT PRIMARY KEY,
                manifest_hash TEXT NOT NULL,
                imported_at TEXT NOT NULL,
                details TEXT NOT NULL
            )"""
        )
        if getattr(connection, "backend", None) == "postgres":
            # Browser clients use authenticated FastAPI routes, never direct table access.
            from backend.migrate_supabase import TABLES
            api_roles = [row[0] for row in connection.execute("SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')").fetchall()]
            permissions = []
            for table in ("schema_version", *TABLES, "data_handoffs"):
                permissions.append(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
                permissions.append(f"REVOKE ALL ON TABLE {table} FROM PUBLIC")
                for role in api_roles:
                    permissions.append(f'REVOKE ALL ON TABLE {table} FROM "{role}"')
            connection.executescript(";".join(permissions))
        connection.commit()


def get_database() -> Generator[sqlite3.Connection | PostgresConnection, None, None]:
    """FastAPI dependency: mở kết nối cho một request và luôn đóng lại."""
    connection = connect_database()
    try:
        yield connection
    finally:
        connection.close()
