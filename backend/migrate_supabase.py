"""Copy the current SQLite database into an empty Supabase PostgreSQL database."""

import sqlite3
from contextlib import closing

from backend.database import connect_database, initialize_database
from backend.settings import DATABASE_PATH, SUPABASE_DATABASE_URL


TABLES = (
    "users",
    "legacy_account_links",
    "sessions",
    "user_consents",
    "habit_entries",
    "health_routines",
    "ai_conversations",
    "ai_messages",
    "ai_request_limits",
    "ai_quota_settings",
    "ai_user_quotas",
    "ai_usage_events",
    "arena_profiles",
    "arena_matches",
    "arena_match_participants",
    "arena_elo_history",
    "arena_achievements",
    "arena_bot_profiles",
    "arena_bot_matches",
)


def migrate() -> dict[str, int]:
    if not SUPABASE_DATABASE_URL:
        raise RuntimeError("Set SUPABASE_DATABASE_URL in the project .env before migrating.")
    if not DATABASE_PATH.is_file():
        raise FileNotFoundError(f"SQLite source database not found: {DATABASE_PATH}")

    initialize_database()
    copied: dict[str, int] = {}
    with closing(sqlite3.connect(DATABASE_PATH)) as source, closing(connect_database()) as target:
        source.row_factory = sqlite3.Row
        source_tables = {row[0] for row in source.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        for table in TABLES:
            existing = target.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            if existing:
                raise RuntimeError(
                    f"Supabase table {table!r} is not empty; migration stopped to avoid overwriting data."
                )

        try:
            for table in TABLES:
                if table in {"legacy_account_links", "health_routines", "ai_quota_settings", "ai_user_quotas", "ai_usage_events"} and table not in source_tables:
                    copied[table] = 0
                    continue
                rows = source.execute(f"SELECT * FROM {table}").fetchall()
                if not rows:
                    copied[table] = 0
                    continue

                columns = rows[0].keys()
                column_list = ", ".join(columns)
                placeholders = ", ".join("%s" for _ in columns)
                target.executemany(
                    f"INSERT INTO {table} ({column_list}) VALUES ({placeholders})",
                    (tuple(row[column] for column in columns) for row in rows),
                )
                copied[table] = len(rows)
            target.commit()
        except Exception:
            target.rollback()
            raise

    return copied


def main() -> None:
    for table, count in migrate().items():
        print(f"{table}: {count} rows copied")
    print("Migration completed. The SQLite source file was left unchanged.")


if __name__ == "__main__":
    main()
