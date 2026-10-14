import unittest

from backend.sqlserver_database import translate_sql


class OwnerSqlServerTests(unittest.TestCase):
    def test_pagination_preserves_bind_values(self):
        sql, values = translate_sql("SELECT * FROM arena_profiles ORDER BY elo DESC LIMIT ? OFFSET ?", (20, 40))
        self.assertIn("[auramaxx].[arena_profiles]", sql)
        self.assertIn("OFFSET ? ROWS FETCH NEXT ? ROWS ONLY", sql)
        self.assertEqual(values, (40, 20))

    def test_latest_consent_and_derived_table_use_tsql(self):
        sql, values = translate_sql("SELECT * FROM user_consents WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", ("user",))
        self.assertTrue(sql.startswith("SELECT TOP (1)"))
        self.assertEqual(values, ("user",))
        sql, _ = translate_sql("SELECT * FROM (SELECT * FROM user_consents) WHERE rank = 1")
        self.assertIn(") AS latest_consents WHERE rank =", sql)

    def test_idempotent_insert_uses_primary_key_and_lock(self):
        sql, values = translate_sql("INSERT OR IGNORE INTO arena_profiles (user_id, display_name) VALUES (?, ?)", ("user", "Tên"))
        self.assertIn("WITH (UPDLOCK, HOLDLOCK)", sql)
        self.assertEqual(values, ("user", "user", "Tên"))

    def test_atomic_operations_use_transaction_owned_lock(self):
        sql, _ = translate_sql("BEGIN IMMEDIATE")
        self.assertIn("BEGIN TRANSACTION", sql)
        self.assertIn("sp_getapplock", sql)


if __name__ == "__main__":
    unittest.main()
