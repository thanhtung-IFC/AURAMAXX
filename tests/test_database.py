"""Tests for translating the backend's SQLite statements to PostgreSQL."""

import unittest

from backend.database import _postgres_sql


class PostgresSqlTranslationTests(unittest.TestCase):
    def test_translates_placeholders_and_case_insensitive_email_lookup(self) -> None:
        self.assertEqual(
            _postgres_sql("SELECT id FROM users WHERE email = ?"),
            "SELECT id FROM users WHERE LOWER(email) = LOWER(%s)",
        )

    def test_translates_ignored_insert_and_case_insensitive_display_name(self) -> None:
        self.assertEqual(
            _postgres_sql(
                "INSERT OR IGNORE INTO arena_profiles (user_id) VALUES (?)"
            ),
            "INSERT INTO arena_profiles (user_id) VALUES (%s) ON CONFLICT DO NOTHING",
        )
        self.assertEqual(
            _postgres_sql(
                "SELECT display_name FROM arena_profiles "
                "ORDER BY display_name COLLATE NOCASE ASC"
            ),
            "SELECT display_name FROM arena_profiles "
            "ORDER BY LOWER(display_name) ASC",
        )

    def test_translates_sqlite_ddl_and_immediate_transaction(self) -> None:
        self.assertEqual(
            _postgres_sql(
                "CREATE TABLE users (email TEXT NOT NULL UNIQUE COLLATE NOCASE)"
            ),
            "CREATE TABLE users (email TEXT NOT NULL UNIQUE)",
        )
        self.assertEqual(
            _postgres_sql("BEGIN IMMEDIATE"),
            "SELECT pg_advisory_xact_lock(1)",
        )
        self.assertEqual(
            _postgres_sql("created_at TEXT DEFAULT CURRENT_TIMESTAMP"),
            "created_at TEXT DEFAULT CURRENT_TIMESTAMP::TEXT",
        )


if __name__ == "__main__":
    unittest.main()
