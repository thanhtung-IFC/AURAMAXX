"""Routine rules, shared journal state, concurrent updates and atomic failures."""

import copy
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from backend.database import initialize_database
from backend import routines
from backend.routers import health_hub, habits, consents
from backend.schemas import ConsentRequest


class RoutineRuleTests(unittest.TestCase):
    def state(self, day="2026-10-14"):
        state = routines.empty_state(day)
        routines.generate_tasks(state)
        return state

    def test_original_intensity_and_feedback_rules(self):
        for intensity, expected in (("gentle", 3), ("moderate", 4), ("intensive", 6)):
            state = self.state()
            state["intensity"] = intensity
            routines.generate_tasks(state)
            self.assertEqual(len(state["tasks"]), expected)
        state["feedback"] = "too_much"
        routines.generate_tasks(state)
        self.assertEqual(len(state["tasks"]), 4)
        self.assertNotIn("mewing", [task["id"] for task in state["tasks"]])
        state["feedback"] = "can_more"
        routines.generate_tasks(state)
        self.assertIn("sunscreen", [task["id"] for task in state["tasks"]])

    def test_preferences_keep_completed_and_manually_added_tasks(self):
        state = self.state()
        state["tasks"][0]["completed"] = True
        state["tasks"].append({"id": "sleep_schedule", "completed": True, "dismissed": False, "time_shift": 3, "added_from_library": True})
        state["intensity"] = "gentle"
        routines.generate_tasks(state)
        self.assertTrue(state["tasks"][0]["completed"])
        self.assertEqual(state["tasks"][-1]["time_shift"], 3)

    def test_long_absence_breaks_streak_after_two_freezes(self):
        state = self.state("2026-10-01")
        state["completed_dates"] = ["2026-10-01"]
        routines.roll_day(state, "2026-10-06")
        self.assertEqual(routines.streak_info(state)["count"], 0)
        self.assertEqual(state["frozen_dates"], ["2026-10-02", "2026-10-03"])
        before = copy.deepcopy(state)
        routines.roll_day(state, "2026-10-06")
        self.assertEqual(state, before)

    def test_midnight_resets_tasks_and_one_missing_day_is_protected_once(self):
        state = self.state("2026-10-13")
        state["completed_dates"] = ["2026-10-12"]
        state["tasks"][0].update(completed=True, dismissed=True, time_shift=4)
        routines.roll_day(state, "2026-10-14")
        self.assertEqual(routines.streak_info(state)["count"], 1)
        self.assertEqual(routines.streak_info(state)["freezes_left"], 1)
        self.assertTrue(all(not task["completed"] and not task["dismissed"] and not task["time_shift"] for task in state["tasks"]))

    def test_monthly_allowance_uses_the_month_of_the_missed_day(self):
        state = self.state("2026-10-31")
        state["completed_dates"] = ["2026-10-30"]
        state["frozen_dates"] = ["2026-10-02", "2026-10-03"]
        routines.roll_day(state, "2026-11-01")
        self.assertEqual(routines.streak_info(state)["count"], 0)
        self.assertEqual(routines.streak_info(state)["freezes_left"], 2)

    def test_completion_is_reversible_without_double_counting(self):
        state = self.state()
        for task in state["tasks"]:
            task["completed"] = True
        routines.update_completion(state)
        routines.update_completion(state)
        self.assertEqual(routines.streak_info(state)["count"], 1)
        state["tasks"][0]["completed"] = False
        routines.update_completion(state)
        self.assertEqual(routines.streak_info(state)["count"], 0)
        for task in state["tasks"]:
            task["dismissed"] = True
        routines.update_completion(state)
        self.assertFalse(routines.streak_info(state)["completed_today"])

    def test_time_shift_wraps_at_midnight(self):
        state = self.state()
        state["tasks"][0]["time_shift"] = 16
        self.assertIn("0 đến 2h", routines.present_state(state, 1)["tasks"][0]["suggestedTime"])


class FailingCommitConnection(sqlite3.Connection):
    fail_commit = False

    def commit(self):
        if self.fail_commit:
            self.fail_commit = False
            raise sqlite3.OperationalError("injected routine commit failure")
        super().commit()


class RoutineMigrationTests(unittest.TestCase):
    def test_older_sqlite_database_without_routines_can_still_migrate(self):
        from backend import migrate_supabase

        with tempfile.TemporaryDirectory() as folder:
            source, target = Path(folder) / "old.sqlite3", Path(folder) / "new.sqlite3"
            initialize_database(lambda: sqlite3.connect(source))
            initialize_database(lambda: sqlite3.connect(target))
            with closing(sqlite3.connect(source)) as connection:
                connection.execute("DROP TABLE health_routines")
                connection.commit()
            with patch.object(migrate_supabase, "DATABASE_PATH", source), patch.object(
                migrate_supabase, "SUPABASE_DATABASE_URL", "fixture"
            ), patch.object(migrate_supabase, "initialize_database"), patch.object(
                migrate_supabase, "connect_database", side_effect=lambda: sqlite3.connect(target)
            ):
                result = migrate_supabase.migrate()
            self.assertEqual(result["health_routines"], 0)


class RoutineStorageTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = Path(folder.name) / "app.sqlite3"
        initialize_database(self.connect)
        self.connection = self.connect()
        self.addCleanup(self.connection.close)
        self.user = {"id": "routine-user"}
        for identifier in ("routine-user", "other-user"):
            self.connection.execute("INSERT INTO users VALUES (?, ?, ?, ?)", (identifier, identifier + "@example.test", "fixture", "2026-10-14"))
            self.connection.execute("INSERT INTO user_consents VALUES (?, ?, ?, ?, ?, ?)", (identifier, identifier, "health_tracking", 1, "1", "2026-10-14"))
        self.connection.commit()

    def connect(self):
        connection = sqlite3.connect(self.path, factory=FailingCommitConnection, timeout=10)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        return connection

    def get(self):
        return health_hub.get_routine(self.user, self.connection)

    def build(self):
        return health_hub.build_routine(health_hub.RoutineBuild(revision=self.get()["revision"]), self.user, self.connection)

    def act(self, state, action, **values):
        return health_hub.update_routine(health_hub.RoutineAction(revision=state["revision"], action=action, **values), self.user, self.connection)

    def test_completions_share_journal_and_can_be_deleted_from_either_view(self):
        state = self.build()
        for task in state["tasks"]:
            state = self.act(state, "complete", task_id=task["id"], completed=True)
        self.assertEqual(state["streak"]["count"], 1)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM habit_entries").fetchone()[0], 4)
        # An idempotent complete must not create a duplicate journal entry.
        state = self.act(state, "complete", task_id="drink_water", completed=True)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM habit_entries").fetchone()[0], 4)
        identifier = routines.habit_id(self.user["id"], state["date"], "drink_water")
        habits.delete_habit(identifier, _csrf=None, user=self.user, connection=self.connection)
        state = self.get()
        self.assertFalse(state["tasks"][0]["completed"])
        self.assertEqual(state["streak"]["count"], 0)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM habit_entries").fetchone()[0], 3)

    def test_routine_and_journal_roll_back_on_commit_failure(self):
        state = self.build()
        self.connection.fail_commit = True
        with self.assertRaisesRegex(sqlite3.OperationalError, "injected routine"):
            self.act(state, "complete", task_id="drink_water", completed=True)
        self.assertEqual(self.get(), state)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM habit_entries").fetchone()[0], 0)

    def test_journal_failure_rolls_back_completion(self):
        state = self.build()
        self.connection.execute("CREATE TRIGGER fail_routine_habit BEFORE INSERT ON habit_entries BEGIN SELECT RAISE(ABORT, 'injected journal failure'); END")
        self.connection.commit()
        with self.assertRaisesRegex(sqlite3.DatabaseError, "injected journal"):
            self.act(state, "complete", task_id="drink_water", completed=True)
        self.assertEqual(self.get(), state)

    def test_two_devices_cannot_overwrite_same_revision(self):
        state = self.build()
        payload = health_hub.RoutineAction(revision=state["revision"], action="complete", task_id="drink_water", completed=True)

        def complete():
            with closing(self.connect()) as connection:
                try:
                    return health_hub.update_routine(payload, self.user, connection)["revision"]
                except HTTPException as error:
                    return error.status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: complete(), range(2)))
        self.assertEqual(sorted(results), [state["revision"] + 1, 409])
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM habit_entries").fetchone()[0], 1)

    def test_user_isolation_and_account_cascade(self):
        state = self.build()
        self.act(state, "complete", task_id="drink_water", completed=True)
        other = health_hub.get_routine({"id": "other-user"}, self.connection)
        self.assertEqual(other["tasks"], [])
        self.connection.execute("DELETE FROM users WHERE id = ?", (self.user["id"],))
        self.connection.commit()
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM health_routines").fetchone()[0], 1)
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM habit_entries").fetchone()[0], 0)

    def test_report_requires_face_consent_and_strips_images_and_identifiers(self):
        state = self.get()
        payload = health_hub.RoutineBuild(revision=state["revision"], report={"skin": {"smoothness_score": 70}, "image": "data:image/private", "landmarks": [1, 2], "account_id": "private"})
        with self.assertRaises(HTTPException) as failure:
            health_hub.build_routine(payload, self.user, self.connection)
        self.assertEqual(failure.exception.status_code, 403)
        self.connection.execute("INSERT INTO user_consents VALUES (?, ?, ?, ?, ?, ?)", ("face-consent", self.user["id"], "face_analysis", 1, "1", "2026-10-14"))
        self.connection.commit()
        state = health_hub.build_routine(payload, self.user, self.connection)
        self.assertEqual(state["report"], {"skin": {"smoothness_score": 70}})
        saved = self.connection.execute("SELECT state_json FROM health_routines WHERE user_id = ?", (self.user["id"],)).fetchone()[0]
        self.assertNotIn("private", saved)

    def test_revoking_consents_clears_saved_report_then_routine(self):
        self.test_report_requires_face_consent_and_strips_images_and_identifiers()
        consents.record_consent(ConsentRequest(purpose="face_analysis", granted=False), _csrf=None, user=self.user, connection=self.connection)
        self.assertIsNone(self.get()["report"])
        consents.record_consent(ConsentRequest(purpose="health_tracking", granted=False), _csrf=None, user=self.user, connection=self.connection)
        self.assertIsNone(self.connection.execute("SELECT user_id FROM health_routines WHERE user_id = ?", (self.user["id"],)).fetchone())
        with self.assertRaises(HTTPException) as failure:
            self.get()
        self.assertEqual(failure.exception.status_code, 403)

    def test_unknown_task_and_stale_revision_do_not_modify_state(self):
        state = self.build()
        with self.assertRaises(HTTPException) as failure:
            self.act(state, "add", task_id="unknown-task")
        self.assertEqual(failure.exception.status_code, 404)
        self.assertEqual(self.get(), state)
        self.act(state, "shift", task_id="drink_water")
        with self.assertRaises(HTTPException) as failure:
            self.act(state, "preferences", intensity="gentle")
        self.assertEqual(failure.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
