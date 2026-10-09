import hashlib
import time
import json

import test_database_api as api_tests
from auth_store import AuthError, LoginLimiter


class AuthenticationTests(api_tests.DatabaseAPITests):
    def make_user(self, username):
        return self.auth.create_account(username, username, "Test user password 123")

    def test_anonymous_cannot_read_faces_or_admin_or_register_a_face(self):
        for path in ("/api/faces", "/api/admin/people", "/api/admin/accounts", "/api/admin/audit"):
            self.assertEqual(self.request("GET", path, authenticated=False)[0], 401)
        self.assertEqual(self.request("POST", "/api/register", {"name": "An", "landmarks": self.points}, authenticated=False)[0], 401)
        self.assertEqual(self.request("GET", "/", authenticated=False)[0], 303)
        self.assertEqual(self.request("GET", "/%61dmin.html", authenticated=False)[0], 303)
        self.assertEqual(self.request("GET", "/api/auth/me", authenticated=False)[1]["authenticated"], False)

    def test_registration_is_user_only_unique_and_password_is_hashed(self):
        payload = {"username": "alice", "display_name": "Alice", "password": "Test user password 123"}
        status, data = self.request("POST", "/api/auth/register", payload, authenticated=False)
        self.assertEqual(status, 201)
        self.assertEqual(data["account"]["role"], "user")
        self.assertNotIn("password_hash", data["account"])
        self.assertEqual(self.request("POST", "/api/auth/register", {**payload, "username": "ALICE"}, authenticated=False)[0], 409)
        self.assertEqual(self.request("POST", "/api/auth/register", {**payload, "username": "attacker", "role": "admin"}, authenticated=False)[0], 400)
        with self.store._connect() as connection:
            hashed = connection.execute("SELECT password_hash FROM accounts WHERE username='alice'").fetchone()[0]
        self.assertTrue(hashed.startswith("$argon2id$"))
        self.assertNotIn(payload["password"], hashed)

    def test_login_forms_enforce_roles_and_wrong_password_fails(self):
        self.make_user("alice")
        for role, username, password in (("admin", "alice", "Test user password 123"),
                                         ("user", "admin", "Test admin password 123"),
                                         ("user", "alice", "wrong"), ("user", "unknown", "wrong")):
            self.assertEqual(self.request("POST", f"/api/auth/{role}/login", {"username": username, "password": password}, authenticated=False)[0], 401)

    def test_user_only_sees_and_matches_own_faces(self):
        alice = self.make_user("alice")
        self.make_user("bob")
        self.login_as("alice")
        own = self.register()
        self.login_as("bob")
        other = self.register()
        self.assertNotEqual(own["id"], other["id"])
        self.assertEqual([p["id"] for p in self.request("GET", "/api/faces")[1]["faces"]], [other["id"]])
        self.assertEqual(self.request("POST", "/api/process", {"landmarks": self.points})[1]["match"]["user_id"], other["id"])
        self.assertEqual(self.request("POST", "/api/register", {"name": own["name"], "user_id": own["id"], "landmarks": self.points})[0], 403)
        self.assertEqual(self.request("DELETE", "/api/faces", {"id": own["id"]})[0], 403)
        self.assertEqual(self.request("DELETE", "/api/faces", {})[0], 403)
        self.assertEqual(self.request("GET", "/api/admin/people")[0], 403)
        self.assertEqual(self.request("GET", "/admin.html")[0], 403)
        self.assertEqual(self.auth.owned_ids(alice["id"]), {own["id"]})

    def test_legacy_faces_are_unassigned_until_admin_assigns_them(self):
        legacy = self.store.register("Legacy", [.1] * 60)
        alice = self.make_user("alice")
        self.login_as("alice")
        self.assertEqual(self.request("GET", "/api/faces")[1]["faces"], [])
        self.login_as("admin", "admin", "Test admin password 123")
        status, detail = self.request("GET", "/api/admin/people/" + legacy["id"])
        self.assertEqual(status, 200)
        self.assertEqual(len(detail["samples"]), 1)
        self.assertNotIn("vector_json", detail["samples"][0])
        status, _ = self.request("POST", "/api/admin/people/" + legacy["id"], {"name": "Assigned", "account_id": alice["id"]})
        self.assertEqual(status, 200)
        self.login_as("alice")
        self.assertEqual(self.request("GET", "/api/faces")[1]["faces"][0]["name"], "Assigned")

    def test_csrf_and_cross_origin_requests_are_rejected(self):
        self.assertEqual(self.request("POST", "/api/challenge/start", {}, headers={"X-CSRF-Token": ""})[0], 403)
        self.assertEqual(self.request("DELETE", "/api/faces", {}, headers={"X-CSRF-Token": "wrong"})[0], 403)
        self.assertEqual(self.request("POST", "/api/auth/user/login", {}, headers={"Origin": "https://other.example"}, authenticated=False)[0], 403)
        self.assertEqual(self.request("POST", "/api/auth/user/login", {}, headers={"Content-Type": "text/plain"}, authenticated=False)[0], 415)

    def test_store_rechecks_ownership_inside_write_transaction(self):
        alice = self.make_user("alice")
        bob = self.make_user("bob")
        person = self.store.register("Alice", [.1] * 60, owner_account_id=alice["id"])
        self.auth.update_person(self.admin["id"], person["id"], "Alice", bob["id"])
        with self.assertRaises(PermissionError):
            self.store.register("Alice", [.2] * 60, person_id=person["id"], access_account_id=alice["id"])
        with self.assertRaises(PermissionError):
            self.store.delete_person(person["id"], access_account_id=alice["id"])
        self.assertEqual(self.store.counts(), {"people": 1, "samples": 1})

    def test_logout_expiry_and_disabling_revoke_sessions(self):
        alice = self.make_user("alice")
        self.login_as("alice")
        token = self.cookie.split("=", 1)[1]
        self.assertEqual(self.request("POST", "/api/auth/logout", {})[0], 200)
        self.assertIsNone(self.auth.session(token))
        self.login_as("alice")
        token = self.cookie.split("=", 1)[1]
        with self.store._connect() as connection:
            connection.execute("UPDATE auth_sessions SET expires_at=? WHERE account_id=?", (int(time.time())-1, alice["id"]))
        self.assertIsNone(self.auth.session(token))
        self.login_as("alice")
        token = self.cookie.split("=", 1)[1]
        self.login_as("admin", "admin", "Test admin password 123")
        self.assertEqual(self.request("POST", f"/api/admin/accounts/{alice['id']}/status", {"is_active": False})[0], 200)
        self.assertIsNone(self.auth.session(token))
        self.assertEqual(self.request("POST", "/api/auth/user/login", {"username": "alice", "password": "Test user password 123"}, authenticated=False)[0], 401)
        self.assertEqual(self.request("POST", f"/api/admin/accounts/{self.admin['id']}/status", {"is_active": False})[0], 400)

    def test_temporary_password_requires_change_and_revokes_old_sessions(self):
        self.auth.create_account("temp", "Temp", "Temporary password 123", force_change=True)
        self.login_as("temp", password="Temporary password 123")
        token = self.cookie.split("=", 1)[1]
        self.assertEqual(self.request("GET", "/api/faces")[0], 403)
        self.assertEqual(self.request("GET", "/")[0], 303)
        self.assertEqual(self.request("POST", "/api/auth/password", {"current_password": "Temporary password 123", "new_password": "Replacement password 123"})[0], 200)
        self.assertIsNone(self.auth.session(token))
        self.login_as("temp", password="Replacement password 123")
        self.assertEqual(self.request("GET", "/api/faces")[0], 200)

    def test_sessions_store_hashes_and_admin_lists_never_return_credentials(self):
        token = self.cookie.split("=", 1)[1]
        with self.store._connect() as connection:
            row = connection.execute("SELECT token_hash FROM auth_sessions WHERE account_id=?", (self.admin["id"],)).fetchone()
        self.assertEqual(row[0], hashlib.sha256(token.encode()).hexdigest())
        accounts = self.request("GET", "/api/admin/accounts")[1]["accounts"]
        self.assertNotIn("password_hash", accounts[0])
        self.assertNotIn("token_hash", self.request("GET", "/api/auth/me")[1]["account"])

    def test_liveness_challenge_is_separate_for_each_session(self):
        self.make_user("alice")
        self.make_user("bob")
        self.login_as("alice")
        self.request("POST", "/api/challenge/start", {})
        self.login_as("bob")
        result = self.request("POST", "/api/process", {"landmarks": self.points})[1]
        self.assertIsNone(result["challenge"])

    def test_rate_limit_is_bounded(self):
        limiter = LoginLimiter(limit=2)
        limiter.check("ip")
        limiter.check("ip")
        with self.assertRaises(AuthError) as error:
            limiter.check("ip")
        self.assertEqual(error.exception.status, 429)

    def test_admin_creates_user_with_one_time_password_and_audit_actor(self):
        status, data = self.request("POST", "/api/admin/accounts", {"username": "newuser", "display_name": "Người dùng mới"})
        self.assertEqual(status, 201, data)
        account, password = data["account"], data["temporary_password"]
        self.assertEqual(account["role"], "user")
        self.assertEqual(account["must_change_password"], 1)
        self.assertGreaterEqual(len(password), 12)
        detail = self.request("GET", "/api/admin/accounts/" + account["id"])[1]
        self.assertEqual(detail["people"], [])
        self.assertNotIn(password, json.dumps(detail))
        self.assertNotIn("password_hash", detail)
        events = self.auth.logs()
        event = next(e for e in events if e["target_id"] == account["id"] and e["action"] == "account.created")
        self.assertEqual(event["actor"], "admin")
        self.assertEqual(self.request("POST", "/api/admin/accounts", {"username": "attacker", "display_name": "Test", "role": "admin"})[0], 400)
        self.login_as("newuser", password=password)
        self.assertEqual(self.request("GET", "/api/faces")[0], 403)

    def test_admin_edits_login_keeps_linked_faces_and_revokes_old_sessions(self):
        alice = self.make_user("alice")
        self.make_user("bob")
        self.login_as("alice")
        person = self.register()
        old_token = self.cookie.split("=", 1)[1]
        self.login_as("admin", "admin", "Test admin password 123")
        endpoint = "/api/admin/accounts/" + alice["id"]
        self.assertEqual(self.request("POST", endpoint + "/profile", {"username": "bob", "display_name": "Conflict"})[0], 409)
        self.assertEqual(self.request("POST", endpoint + "/profile", {"username": "alice_new", "display_name": "Tùng mới", "role": "admin"})[0], 400)
        self.assertEqual(self.request("POST", endpoint + "/profile", {"username": "alice_new", "display_name": "Tùng mới"})[0], 200)
        self.assertIsNone(self.auth.session(old_token))
        detail = self.request("GET", endpoint)[1]
        self.assertEqual(detail["username"], "alice_new")
        self.assertEqual(detail["display_name"], "Tùng mới")
        self.assertEqual([p["id"] for p in detail["people"]], [person["id"]])
        self.assertEqual(detail["people"][0]["name"], person["name"])
        self.assertEqual(detail["active_sessions"], 0)
        self.assertEqual(self.request("POST", "/api/auth/user/login", {"username": "alice", "password": "Test user password 123"}, authenticated=False)[0], 401)
        self.login_as("alice_new")
        self.assertEqual(self.request("GET", "/api/faces")[1]["faces"][0]["id"], person["id"])

    def test_admin_password_reset_hashes_secret_forces_change_and_revokes_sessions(self):
        alice = self.make_user("alice")
        self.login_as("alice")
        old_token = self.cookie.split("=", 1)[1]
        self.login_as("admin", "admin", "Test admin password 123")
        endpoint = "/api/admin/accounts/" + alice["id"] + "/reset-password"
        self.assertEqual(self.request("POST", endpoint, {"temporary_password": "short"})[0], 400)
        temporary = "Admin temporary password 123"
        status, data = self.request("POST", endpoint, {"temporary_password": temporary})
        self.assertEqual(status, 200, data)
        self.assertEqual(data["temporary_password"], temporary)
        self.assertIsNone(self.auth.session(old_token))
        self.assertNotIn(temporary, json.dumps(self.auth.logs()))
        with self.store._connect() as connection:
            hashed = connection.execute("SELECT password_hash FROM accounts WHERE id=?", (alice["id"],)).fetchone()[0]
        self.assertTrue(hashed.startswith("$argon2id$"))
        self.assertNotIn(temporary, hashed)
        self.assertEqual(self.request("POST", "/api/auth/user/login", {"username": "alice", "password": "Test user password 123"}, authenticated=False)[0], 401)
        self.login_as("alice", password=temporary)
        self.assertEqual(self.request("GET", "/api/faces")[0], 403)
        self.assertEqual(self.request("POST", "/api/auth/password", {"current_password": temporary, "new_password": "Alice new private password 123"})[0], 200)
        self.login_as("alice", password="Alice new private password 123")
        self.assertEqual(self.request("GET", "/api/faces")[0], 200)

    def test_user_cannot_manage_credentials_and_admin_account_is_protected(self):
        alice = self.make_user("alice")
        endpoint = "/api/admin/accounts/" + alice["id"]
        self.login_as("alice")
        self.assertEqual(self.request("GET", endpoint)[0], 403)
        for url, payload in (("/api/admin/accounts", {"username": "evil", "display_name": "Evil"}),
                             (endpoint + "/profile", {"username": "evil", "display_name": "Evil"}),
                             (endpoint + "/reset-password", {}), (endpoint + "/sessions/revoke", {})):
            self.assertEqual(self.request("POST", url, payload)[0], 403)
        self.login_as("admin", "admin", "Test admin password 123")
        admin_endpoint = "/api/admin/accounts/" + self.admin["id"]
        self.assertEqual(self.request("POST", admin_endpoint + "/reset-password", {})[0], 403)
        self.assertEqual(self.request("POST", admin_endpoint + "/profile", {"username": "changedadmin", "display_name": "Changed"})[0], 403)
        self.assertEqual(self.request("POST", admin_endpoint + "/sessions/revoke", {})[0], 403)
        self.assertEqual(self.request("POST", "/api/admin/accounts/missing/reset-password", {})[0], 404)

    def test_admin_revokes_user_sessions_without_changing_password(self):
        alice = self.make_user("alice")
        self.login_as("alice")
        old_token = self.cookie.split("=", 1)[1]
        self.login_as("admin", "admin", "Test admin password 123")
        self.assertEqual(self.request("POST", "/api/admin/accounts/" + alice["id"] + "/sessions/revoke", {})[0], 200)
        self.assertIsNone(self.auth.session(old_token))
        self.login_as("alice")

    def test_admin_audit_reads_database_events_and_keeps_deleted_person_history(self):
        person = self.register()
        self.assertEqual(self.request("DELETE", "/api/faces", {"id": person["id"]})[0], 200)
        status, data = self.request("GET", "/api/admin/audit")
        self.assertEqual(status, 200, data)
        self.assertEqual(data["storage"]["backend"], self.store.backend)
        saved = [event for event in data["events"] if event["action"] == "person.sample_saved" and event["target_id"] == person["id"]]
        deleted = [event for event in data["events"] if event["action"] == "person.deleted" and event["target_id"] == person["id"]]
        self.assertEqual(len(saved), 1)
        self.assertEqual(len(deleted), 1)
        self.assertEqual(saved[0]["actor"], "admin")
        self.assertEqual(deleted[0]["actor"], "admin")

    def test_static_paths_do_not_expose_source_or_traverse_assets(self):
        for path in ("/server.py", "/auth_store.py", "/logs/server.out.log", "/assets/../server.py", "/assets/%2e%2e/server.py"):
            self.assertEqual(self.request("GET", path)[0], 404)
