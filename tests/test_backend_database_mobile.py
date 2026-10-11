"""Unit tests for backend database user_data persistence, 6-char passwords, and API endpoints."""

import json
import os
import tempfile
import unittest
from pathlib import Path

from face_store import FaceStore
from auth_store import AuthStore, AuthError


class BackendDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.temp_dir.name) / "test_faces.sqlite3"
        self.faces = FaceStore(str(self.db_path))
        self.faces.initialize()
        self.auth = AuthStore(self.faces)
        self.auth.initialize()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_password_length_relaxed_to_6(self):
        # 6-character password must pass
        self.assertEqual(self.auth.password("123456"), "123456")
        self.assertEqual(self.auth.password("abcdef"), "abcdef")
        # 5-character password must fail
        with self.assertRaises(AuthError):
            self.auth.password("12345")

    def test_create_and_list_accounts(self):
        acc1 = self.auth.create_account("user_one", "User One", "password123", role="user")
        self.assertIsNotNone(acc1)
        self.assertEqual(acc1["username"], "user_one")
        self.assertEqual(acc1["display_name"], "User One")
        self.assertEqual(acc1["role"], "user")

        acc2 = self.auth.create_account("user_two", "User Two", "secret678", role="user")
        self.assertIsNotNone(acc2)

        accounts = self.auth.list_all_accounts()
        self.assertGreaterEqual(len(accounts), 2)
        usernames = [a["username"] for a in accounts]
        self.assertIn("user_one", usernames)
        self.assertIn("user_two", usernames)

    def test_user_data_persistence_in_database(self):
        acc = self.auth.create_account("datatester", "Data Tester", "mypassword1", role="user")
        account_id = acc["id"]

        # Initial data should be None
        initial = self.auth.get_user_data(account_id)
        self.assertIsNone(initial)

        # Save scan report and routine
        mock_report = {"face_shape": "Oval", "symmetry": 96.5, "skin": {"dark_circles_index": 18}}
        mock_tasks = [{"id": "drink_water", "completed": True}, {"id": "jaw_relax", "completed": False}]

        self.auth.save_user_data(account_id, latest_report=mock_report, daily_routine=mock_tasks, streak_count=3)

        saved = self.auth.get_user_data(account_id)
        self.assertIsNotNone(saved)
        self.assertEqual(saved["streak_count"], 3)
        self.assertEqual(saved["latest_report"]["face_shape"], "Oval")
        self.assertEqual(saved["latest_report"]["symmetry"], 96.5)
        self.assertEqual(len(saved["daily_routine"]), 2)
        self.assertTrue(saved["daily_routine"][0]["completed"])

        # Update only streak count
        self.auth.save_user_data(account_id, streak_count=4)
        updated = self.auth.get_user_data(account_id)
        self.assertEqual(updated["streak_count"], 4)
        # Previous report and routine should still be preserved
        self.assertEqual(updated["latest_report"]["face_shape"], "Oval")
        self.assertEqual(len(updated["daily_routine"]), 2)


if __name__ == "__main__":
    unittest.main()

