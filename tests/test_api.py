"""Kiểm thử REST API cục bộ, dùng SQLite tạm và không cần cài pytest/httpx."""

import http.cookiejar
import gzip
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
import json
import os
import socket
import sqlite3
import subprocess
import sys
import time
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from uuid import uuid4


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def find_free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


class ApiIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.database_path = PROJECT_ROOT / "backend" / "data" / f"test-{uuid4().hex}.sqlite3"
        cls.port = find_free_port()
        cls.base_url = f"http://127.0.0.1:{cls.port}"
        env = os.environ.copy()
        env["AURAMAXX_DB_PATH"] = str(cls.database_path)
        env["AURAMAXX_DB_BACKEND"] = "sqlite"
        cls.sqlserver_test = os.environ.get("AURAMAXX_TEST_SQLSERVER") == "1"
        cls.pg_url = os.environ.get("AURAMAXX_TEST_POSTGRES", "")
        cls.pg_test = bool(cls.pg_url)
        if cls.pg_test and cls.sqlserver_test:
            raise ValueError("Choose one integration test backend")
        if cls.sqlserver_test:
            import pyodbc
            from sql_server_store import connection_string
            cls.sql_test_name = "AuraOwnerTest_" + uuid4().hex
            cls.sql_master_dsn = connection_string(r"localhost\SQLEXPRESS", "master", trust_certificate=True)
            cls.sql_app_dsn = connection_string(r"localhost\SQLEXPRESS", cls.sql_test_name, trust_certificate=True)
            with closing(pyodbc.connect(cls.sql_master_dsn, autocommit=True)) as master:
                master.execute(f"CREATE DATABASE [{cls.sql_test_name}]")
            cls.addClassCleanup(cls.drop_sqlserver_database)
            env["AURAMAXX_DB_BACKEND"] = "sqlserver"
            env["SQLSERVER_DATABASE"] = cls.sql_test_name
            env["SQLSERVER_SERVER"] = r"localhost\SQLEXPRESS"
            env["SQLSERVER_TRUST_CERTIFICATE"] = "true"
        cls.face_database_path = cls.database_path.with_name(cls.database_path.stem + "-faces.sqlite3")
        env["FACE_DB_BACKEND"] = "sqlite"
        env["FACE_DATABASE_PATH"] = str(cls.face_database_path)
        env["SUPABASE_DATABASE_URL"] = ""
        if cls.pg_test:
            import psycopg
            from psycopg import sql
            from postgres_store import PostgresFaceStore
            cls.pg_app_schema = "aura_api_test_" + uuid4().hex
            cls.pg_face_schema = "face_api_test_" + uuid4().hex
            with psycopg.connect(cls.pg_url, autocommit=True) as postgres:
                postgres.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(cls.pg_app_schema)))
            cls.addClassCleanup(cls.drop_postgres_schemas)
            env.update(AURAMAXX_DB_BACKEND="postgres", FACE_DB_BACKEND="postgres",
                       DATABASE_URL=cls.pg_url, SUPABASE_DATABASE_URL=cls.pg_url,
                       AURAMAXX_POSTGRES_SCHEMA=cls.pg_app_schema, FACE_POSTGRES_SCHEMA=cls.pg_face_schema)
            cls.pg_face_store = PostgresFaceStore(cls.pg_url, schema=cls.pg_face_schema)
        env["AUTH_COOKIE_SECURE"] = "false"
        env["AURAMAXX_ALLOWED_ORIGINS"] = "http://localhost:8000"
        env["AI_PROVIDER"] = "none"
        env["AI_API_KEY"] = ""
        from face_store import FaceStore
        from auth_store import AuthStore
        fixture_store = cls.face_store()
        fixture_store.initialize()
        fixture_auth = AuthStore(fixture_store)
        fixture_auth.initialize()
        fixture_auth.create_account("integration_admin", "Admin tích hợp", "Integration admin password 123", role="admin")
        cls.log_path = PROJECT_ROOT / ".test-output" / ("api-" + uuid4().hex + ".log")
        cls.log_path.parent.mkdir(exist_ok=True)
        cls.log_file = cls.log_path.open("w", encoding="utf-8")
        cls.server = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "backend.main:app", "--host", "127.0.0.1", "--port", str(cls.port), "--no-access-log"],
            cwd=PROJECT_ROOT,
            env=env,
            stdout=cls.log_file,
            stderr=subprocess.STDOUT,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            text=True,
            encoding="utf-8",
            errors="replace",
        )

        deadline = time.monotonic() + (90 if cls.pg_test else 25)
        while time.monotonic() < deadline:
            if cls.server.poll() is not None:
                break
            try:
                with urllib.request.urlopen(f"{cls.base_url}/api/health", timeout=8 if cls.pg_test else 1) as response:
                    if response.status == 200:
                        return
            except (urllib.error.URLError, TimeoutError):
                time.sleep(0.2)
        log = cls.stop_server()[-3000:]
        cls.database_path.unlink(missing_ok=True)
        raise RuntimeError(f"Backend kiểm thử không khởi động. Nhật ký:\n{log}")

    @classmethod
    def face_store(cls):
        from face_store import FaceStore
        return cls.pg_face_store if cls.pg_test else FaceStore(cls.face_database_path)

    @classmethod
    def drop_postgres_schemas(cls):
        import psycopg
        import re
        from psycopg import sql
        if hasattr(cls, "pg_face_store"):
            cls.pg_face_store.close()
        for schema in (cls.pg_app_schema, cls.pg_face_schema):
            if not re.fullmatch(r"(?:aura|face)_api_test_[0-9a-f]{32}", schema):
                raise ValueError("Refusing to drop an unverified test schema")
            with psycopg.connect(cls.pg_url, autocommit=True) as postgres:
                postgres.execute(sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(sql.Identifier(schema)))

    @classmethod
    def drop_sqlserver_database(cls):
        import pyodbc
        import re
        if not re.fullmatch(r"AuraOwnerTest_[0-9a-f]{32}", cls.sql_test_name):
            raise ValueError("Refusing to drop an unverified test database")
        with closing(pyodbc.connect(cls.sql_master_dsn, autocommit=True)) as master:
            master.execute(f"ALTER DATABASE [{cls.sql_test_name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE")
            master.execute(f"DROP DATABASE [{cls.sql_test_name}]")

    def app_connection(self):
        if self.pg_test:
            from backend.database import connect_postgres
            return connect_postgres(self.pg_url, schema=self.pg_app_schema)
        if self.sqlserver_test:
            import pyodbc
            from backend.sqlserver_database import SqlServerConnection
            return SqlServerConnection(pyodbc.connect(self.sql_app_dsn))
        return sqlite3.connect(self.database_path)

    @classmethod
    def stop_server(cls) -> str:
        if hasattr(cls, "server") and cls.server.poll() is None:
            cls.server.terminate()
            try:
                cls.server.wait(timeout=5)
            except subprocess.TimeoutExpired:
                cls.server.kill()
                cls.server.wait(timeout=5)
        if hasattr(cls, "log_file"):
            cls.log_file.close()
            return cls.log_path.read_text(encoding="utf-8", errors="replace")
        if hasattr(cls, "server") and cls.server.stdout and not cls.server.stdout.closed:
            try:
                return cls.server.communicate(timeout=5)[0] or ""
            except subprocess.TimeoutExpired:
                cls.server.kill()
                return cls.server.communicate(timeout=5)[0] or ""
        return ""

    @classmethod
    def tearDownClass(cls) -> None:
        cls.stop_server()
        if hasattr(cls, "database_path"):
            cls.database_path.unlink(missing_ok=True)
            cls.face_database_path.unlink(missing_ok=True)

    def setUp(self) -> None:
        self.cookies = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))

    def request(self, method: str, path: str, payload: dict | None = None, *, origin: str | None = None):
        body = json.dumps(payload).encode("utf-8") if payload is not None else None
        headers = {}
        headers["Connection"] = "close"
        if body is not None:
            headers["Content-Type"] = "application/json"
        csrf = next((cookie.value for cookie in self.cookies if cookie.name == "auramaxx_csrf"), None)
        if method.upper() not in {"GET", "HEAD", "OPTIONS"} and csrf:
            headers["X-CSRF-Token"] = csrf
        if origin:
            headers["Origin"] = origin
        if method.upper() == "OPTIONS":
            headers["Access-Control-Request-Method"] = "PATCH" if path == "/api/arena/profile" else "GET"
            headers["Access-Control-Request-Headers"] = "content-type,x-csrf-token"

        request = urllib.request.Request(
            self.base_url + path,
            data=body,
            headers=headers,
            method=method.upper(),
        )
        try:
            response = self.client.open(request, timeout=30 if self.pg_test else 8)
        except urllib.error.HTTPError as error:
            response = error
        try:
            raw = response.read()
        finally:
            response.close()
        data = json.loads(raw.decode("utf-8")) if raw and "application/json" in response.headers.get("Content-Type", "") else None
        return response.code, data, response.headers

    def register(self, *, email: str | None = None) -> tuple[str, str]:
        address = email or f"{uuid4().hex}@example.test"
        password = "auramaxx-test-passphrase-2026"
        code, data, headers = self.request("POST", "/api/auth/register", {"email": address, "password": password})
        self.assertEqual(code, 201)
        self.assertEqual(data["email"], address)
        set_cookie = headers.get_all("Set-Cookie") or []
        session_cookie = next(value for value in set_cookie if value.startswith("auramaxx_session="))
        self.assertIn("HttpOnly", session_cookie)
        self.assertIn("SameSite=strict", session_cookie)
        return address, password

    def grant_health_consent(self) -> None:
        code, data, _ = self.request(
            "POST", "/api/consents", {"purpose": "health_tracking", "granted": True, "policy_version": "v1"}
        )
        self.assertEqual(code, 201)
        self.assertTrue(data["granted"])

    def grant_ai_consent(self, granted: bool = True) -> None:
        code, data, _ = self.request(
            "POST", "/api/consents", {"purpose": "ai_chat", "granted": granted, "policy_version": "v1"}
        )
        self.assertEqual(code, 201)
        self.assertEqual(data["granted"], granted)

    def grant_face_consent(self, granted: bool = True) -> None:
        code, data, _ = self.request(
            "POST", "/api/consents", {"purpose": "face_analysis", "granted": granted, "policy_version": "v1"}
        )
        self.assertEqual(code, 201)
        self.assertEqual(data["granted"], granted)

    def test_unified_legacy_login_keeps_profiles_and_new_features_on_one_session(self):
        username, password = "old_" + uuid4().hex[:12], "Old account password 123"
        code, registered, _ = self.request("POST", "/api/vision/auth/register", {
            "username": username, "display_name": "Tài khoản cũ", "password": password,
        })
        self.assertEqual(code, 201, registered)
        # Existing data stays attached to the original account ID.
        from face_store import FaceStore
        person = self.face_store().register("Hồ sơ có sẵn", [.1] * 60, owner_account_id=registered["account"]["id"])
        code, user, _ = self.request("POST", "/api/auth/login", {"email": username, "password": password})
        self.assertEqual(code, 200, user)
        self.assertEqual(user["display_name"], "Tài khoản cũ")
        self.assertNotIn("password_hash", user)
        code, me, _ = self.request("GET", "/api/vision/auth/me")
        self.assertEqual(code, 200, me)
        self.assertEqual(me["account"]["id"], registered["account"]["id"])
        self.assertEqual(self.request("GET", "/api/vision/faces")[1]["faces"][0]["id"], person["id"])
        self.assertEqual(self.request("GET", "/api/arena/profile")[0], 200)
        self.assertEqual(self.request("GET", "/api/vision/admin/accounts")[0], 410)
        self.assertEqual(self.request("GET", "/api/manage/accounts")[0], 403)
        self.grant_health_consent()
        self.assertEqual(self.request("POST", "/api/habits", {"category": "water", "value": "2", "unit": "ly"})[0], 201)
        self.assertEqual(self.request("GET", "/api/progress/summary")[1]["total_entries"], 1)
        self.assertEqual(self.request("POST", "/api/auth/logout")[0], 204)
        self.assertEqual(self.request("GET", "/api/vision/faces")[0], 401)

    def test_unified_email_account_vision_ownership_csrf_and_deletion(self):
        email, password = self.register()
        self.assertEqual(self.request("POST", "/api/vision/challenge/start", {})[0], 403)
        self.grant_face_consent()
        points = [{"x": i / 500, "y": .4, "z": 0} for i in range(478)]
        code, result, _ = self.request("POST", "/api/vision/register", {"name": "Hồ sơ của tôi", "landmarks": points})
        self.assertEqual(code, 200, result)
        own_id = result["user"]["id"]
        code, result, _ = self.request("POST", "/api/vision/process", {"landmarks": points, "check_challenge": False})
        self.assertEqual(code, 200, result)
        self.assertEqual(result["match"]["user_id"], own_id)
        self.assertEqual(self.request("POST", "/api/vision/challenge/start", {})[0], 200)
        self.assertEqual(self.request("GET", "/api/vision/process")[0], 405)
        # Raw client has the session cookie but deliberately omits CSRF.
        cookie = "; ".join(f"{item.name}={item.value}" for item in self.cookies)
        raw = urllib.request.Request(self.base_url + "/api/vision/challenge/reset", data=b"{}", method="POST", headers={"Cookie": cookie, "Content-Type": "application/json"})
        with self.assertRaises(urllib.error.HTTPError) as error:
            urllib.request.urlopen(raw)
        self.assertEqual(error.exception.code, 403)
        first_cookies = self.cookies
        self.cookies = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.register()
        self.assertEqual(self.request("GET", "/api/vision/faces")[1]["total"], 0)
        self.assertEqual(self.request("DELETE", "/api/vision/faces", {"id": own_id})[0], 403)
        self.cookies = first_cookies
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.assertEqual(self.request("DELETE", "/api/auth/me", {"password": password, "confirmation": "DELETE"})[0], 204)
        from face_store import FaceStore
        self.assertNotIn(own_id, [p["id"] for p in self.face_store().list_people()])

    def test_personal_settings_profile_export_and_owner_isolation(self):
        self.assertEqual(self.request("GET", "/api/account/settings")[0], 401)
        self.assertEqual(self.request("GET", "/api/account/export")[0], 401)
        email, password = self.register()
        code, settings, _ = self.request("GET", "/api/account/settings")
        self.assertEqual(code, 200)
        owner_id = settings["profile"]["id"]
        self.assertEqual(settings["profile"]["email"], email)
        self.assertEqual(len(settings["sessions"]), 1)
        self.assertTrue(settings["sessions"][0]["current"])
        owner_session = settings["sessions"][0]["id"]
        self.assertNotIn("token_hash", json.dumps(settings))
        self.assertNotIn("csrf_token", json.dumps(settings))
        self.assertEqual(self.request("PATCH", "/api/account/profile", {"display_name": "   "})[0], 422)
        self.assertEqual(self.request("PATCH", "/api/account/profile", {"display_name": "Updated", "role": "admin"})[0], 422)
        self.assertEqual(self.request("PATCH", "/api/account/profile", {"display_name": "  My   Aura  "})[1], {"display_name": "My Aura"})
        self.assertEqual(self.request("GET", "/api/auth/me")[1]["display_name"], "My Aura")
        self.grant_health_consent()
        own_habit = self.request("POST", "/api/habits", {"category": "water", "value": "250", "unit": "ml"})[1]
        self.grant_ai_consent()
        conversation = self.request("POST", "/api/aura/conversations", {"title": "Private owner conversation"})[1]
        with closing(self.app_connection()) as connection:
            connection.execute("INSERT INTO ai_messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
                               (str(uuid4()), conversation["id"], "user", "Private message", "2026-01-01"))
            account_id = connection.execute("SELECT account_id FROM legacy_account_links WHERE user_id = ?", (owner_id,)).fetchone()[0]
            connection.commit()
        own_person = self.face_store().register("Private face", [.1] * 60, owner_account_id=account_id)
        code, exported, headers = self.request("GET", "/api/account/export")
        self.assertEqual(code, 200)
        self.assertIn("attachment", headers["Content-Disposition"])
        self.assertEqual(exported["profile"]["display_name"], "My Aura")
        self.assertEqual(exported["data"]["habit_entries"][0]["id"], own_habit["id"])
        self.assertEqual(exported["data"]["ai_messages"][0]["content"], "Private message")
        self.assertEqual(exported["data"]["face_profiles"][0]["id"], own_person["id"])
        for secret in ("password_hash", "credential_hash", "csrf_token", "token_hash", "vector_json"):
            self.assertNotIn(secret, json.dumps(exported))
        owner_cookies = self.cookies
        self.cookies = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.register()
        self.assertEqual(self.request("DELETE", f"/api/account/sessions/{owner_session}")[0], 404)
        other_export = self.request("GET", "/api/account/export")[1]
        for table in ("habit_entries", "ai_messages", "ai_conversations", "face_profiles"):
            self.assertEqual(other_export["data"][table], [])
        self.cookies = owner_cookies
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.assertEqual(self.request("GET", "/api/auth/me")[0], 200)

    def test_personal_session_revocation_keeps_current_and_requires_csrf(self):
        email, password = self.register()
        first_cookies = self.cookies
        first_id = self.request("GET", "/api/account/settings")[1]["sessions"][0]["id"]
        self.cookies = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.assertEqual(self.request("POST", "/api/auth/login", {"email": email, "password": password})[0], 200)
        self.assertEqual(len(self.request("GET", "/api/account/settings")[1]["sessions"]), 2)
        # Omitting the CSRF header must prevent session and profile changes.
        for path, method, payload in (("/api/account/sessions/revoke-others", "POST", None),
                                      ("/api/account/profile", "PATCH", {"display_name": "Blocked"})):
            request = urllib.request.Request(self.base_url + path, method=method,
                                             data=json.dumps(payload).encode() if payload else None,
                                             headers={"Content-Type": "application/json"})
            with self.assertRaises(urllib.error.HTTPError) as error:
                self.client.open(request)
            self.assertEqual(error.exception.code, 403)
            error.exception.close()
        code, remaining, _ = self.request("POST", "/api/account/sessions/revoke-others")
        self.assertEqual(code, 200)
        self.assertEqual(len(remaining["sessions"]), 1)
        self.assertTrue(remaining["sessions"][0]["current"])
        self.assertNotEqual(remaining["sessions"][0]["id"], first_id)
        current_cookies = self.cookies
        self.cookies = first_cookies
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.assertEqual(self.request("GET", "/api/auth/me")[0], 401)
        self.cookies = current_cookies
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        current_id = remaining["sessions"][0]["id"]
        self.assertTrue(self.request("DELETE", f"/api/account/sessions/{current_id}")[1]["signed_out"])
        self.assertEqual(self.request("GET", "/api/auth/me")[0], 401)

    def test_unified_password_change_updates_both_authentication_paths(self):
        email, password = self.register()
        new = "Unified changed password 123"
        code, result, _ = self.request("POST", "/api/vision/auth/password", {"current_password": password, "new_password": new})
        self.assertEqual(code, 200, result)
        self.assertEqual(self.request("GET", "/api/auth/me")[0], 401)
        self.assertEqual(self.request("POST", "/api/auth/login", {"email": email, "password": password})[0], 401)
        self.assertEqual(self.request("POST", "/api/auth/login", {"email": email, "password": new})[0], 200)
        self.assertEqual(self.request("GET", "/api/vision/auth/me")[0], 200)

    def test_unified_admin_reset_revokes_sessions_and_accepts_new_password(self):
        username, password = "reset_" + uuid4().hex[:10], "Reset old password 123"
        self.request("POST", "/api/vision/auth/register", {"username": username, "display_name": "Reset user", "password": password})
        self.request("POST", "/api/auth/login", {"email": username, "password": password})
        account_id = self.request("GET", "/api/vision/auth/me")[1]["account"]["id"]
        old_cookies = self.cookies
        self.cookies = http.cookiejar.CookieJar()
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.assertEqual(self.request("POST", "/api/vision/auth/admin/login", {"username": "integration_admin", "password": "Integration admin password 123"})[0], 200)
        self.assertEqual(self.request("GET", "/api/auth/me")[1]["role"], "admin")
        new = "Reset new password 123"
        self.assertEqual(self.request("POST", f"/api/manage/accounts/{account_id}/reset-password", {"temporary_password": new})[0], 200)
        self.cookies = old_cookies
        self.client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookies))
        self.assertEqual(self.request("GET", "/api/auth/me")[0], 401)
        self.assertEqual(self.request("POST", "/api/auth/login", {"email": username, "password": password})[0], 401)
        code, user, _ = self.request("POST", "/api/auth/login", {"email": username, "password": new})
        self.assertEqual(code, 200, user)
        self.assertTrue(user["must_change_password"])
        self.assertEqual(self.request("GET", "/api/arena/profile")[0], 403)
        self.assertEqual(self.request("POST", "/api/vision/auth/password", {"current_password": new, "new_password": "My permanent password 123"})[0], 200)

    def test_unified_static_pages_and_private_files(self):
        for path in ("/", "/index.html", "/visionface.html", "/admin.html", "/account.html", "/login.html", "/login.js", "/app.js", "/js/pages/face-lab-native.js", "/assets/wellness-hero.svg"):
            self.assertEqual(self.request("GET", path)[0], 200, path)
        for path in ("/.env", "/server.py", "/backend/settings.py", "/face_database.sqlite3", "/api/not-a-route"):
            self.assertEqual(self.request("GET", path)[0], 404, path)
        self.assertEqual(self.request("GET", "/api/status")[0], 200)

    def test_web_assets_are_compressed_and_revalidated(self):
        for path in ("/app.js", "/styles.css", "/legacy-assets/app.js"):
            with self.subTest(path=path):
                with self.client.open(self.base_url + path) as response:
                    raw = response.read()
                    etag = response.headers["ETag"]
                    self.assertEqual(response.headers["Cache-Control"], "public, max-age=0, must-revalidate")
                request = urllib.request.Request(self.base_url + path, headers={"Accept-Encoding": "gzip"})
                with self.client.open(request) as response:
                    compressed = response.read()
                    self.assertEqual(response.headers["Content-Encoding"], "gzip")
                    self.assertIn("Accept-Encoding", response.headers["Vary"])
                    self.assertEqual(gzip.decompress(compressed), raw)
                    self.assertLess(len(compressed), len(raw) * .6)
                request = urllib.request.Request(self.base_url + path, headers={"If-None-Match": etag, "Accept-Encoding": "gzip"})
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    self.client.open(request)
                self.assertEqual(caught.exception.code, 304)
                self.assertEqual(caught.exception.read(), b"")
                self.assertEqual(caught.exception.headers["Cache-Control"], "public, max-age=0, must-revalidate")
                caught.exception.close()
        request = urllib.request.Request(self.base_url + "/", headers={"Accept-Encoding": "gzip"})
        with self.client.open(request) as response:
            self.assertEqual(response.headers["Cache-Control"], "no-store")
            self.assertIn(b"<!doctype html>", gzip.decompress(response.read()))

    def test_owner_management_has_one_admin_area_and_protected_data(self):
        self.assertEqual(self.request("GET", "/api/manage/status")[0], 401)
        self.request("POST", "/api/auth/login", {"email": "integration_admin", "password": "Integration admin password 123"})
        code, status, _ = self.request("GET", "/api/manage/status")
        self.assertEqual(code, 200, status)
        self.assertFalse(status["old_management_enabled"])
        self.assertEqual(status["application_database"], "postgres" if self.pg_test else "sqlserver" if self.sqlserver_test else "sqlite")
        code, result, _ = self.request("POST", "/api/manage/accounts", {"username": "managed_" + uuid4().hex[:10], "display_name": "Người dùng được quản lý"})
        self.assertEqual(code, 201, result)
        account_id = result["account"]["id"]
        self.assertGreaterEqual(len(result["temporary_password"]), 12)
        code, result, _ = self.request("GET", "/api/manage/accounts")
        self.assertEqual(code, 200)
        self.assertTrue(any(account["id"] == account_id for account in result["accounts"]))
        self.assertTrue(all("password_hash" not in account for account in result["accounts"]))
        self.assertEqual(self.request("POST", f"/api/manage/accounts/{account_id}/status", {"is_active": False})[0], 200)
        self.assertEqual(self.request("POST", f"/api/manage/accounts/{account_id}/status", {"is_active": True})[0], 200)
        self.assertEqual(self.request("GET", "/api/manage/data/habit_entries")[0], 200)
        self.assertEqual(self.request("GET", "/api/manage/data/sessions")[0], 404)
        self.assertEqual(self.request("GET", "/api/manage/data/users")[0], 404)
        self.assertEqual(self.request("GET", "/api/vision/admin/accounts")[0], 410)
        self.assertEqual(self.request("DELETE", f"/api/manage/accounts/{account_id}")[0], 200)
        code, backup, _ = self.request("POST", "/api/manage/backups", {})
        self.assertEqual(code, 201, backup)
        self.assertTrue(backup["verified"])
        code, _, headers = self.request("GET", backup["download"])
        self.assertEqual(code, 200)
        self.assertIn("application/zip", headers["Content-Type"])

    def test_admin_login_has_a_separate_page_and_rejects_user_accounts(self):
        with self.client.open(self.base_url + "/manage") as page:
            self.assertIn("/admin-login.html", page.url)
            self.assertIn('id="admin-login-form"', page.read().decode("utf-8"))
            self.assertEqual(page.headers.get("Cache-Control"), "no-store")
        email, password = self.register()
        old_token = next(cookie.value for cookie in self.cookies if cookie.name == "auramaxx_session")
        code, _data, headers = self.request("POST", "/api/auth/admin/login", {"email": email, "password": password})
        self.assertEqual(code, 401)
        self.assertEqual(headers.get_all("Set-Cookie"), None)
        self.assertEqual(next(cookie.value for cookie in self.cookies if cookie.name == "auramaxx_session"), old_token)
        self.assertEqual(self.request("GET", "/api/auth/me")[1]["role"], "user")
        for identity in ("missing_admin", "integration_admin"):
            code, _data, headers = self.request("POST", "/api/auth/admin/login", {"email": identity, "password": "Incorrect password 123"})
            self.assertEqual(code, 401)
            self.assertIsNone(headers.get_all("Set-Cookie"))
        code, admin, headers = self.request("POST", "/api/auth/admin/login", {"email": "integration_admin", "password": "Integration admin password 123"})
        self.assertEqual(code, 200, admin)
        self.assertEqual(admin["role"], "admin")
        self.assertTrue(any("HttpOnly" in value for value in headers.get_all("Set-Cookie")))
        self.assertTrue(self.request("GET", "/api/manage/status")[1]["is_central"])
        self.assertEqual(self.request("POST", "/api/auth/logout", {})[0], 204)
        self.assertEqual(self.request("GET", "/api/manage/status")[0], 401)

    def test_ai_quota_admin_permissions_csrf_and_saved_settings(self):
        self.assertEqual(self.request("GET", "/api/manage/ai/usage")[0], 401)
        self.request("POST", "/api/auth/admin/login", {"email": "integration_admin", "password": "Integration admin password 123"})
        code, dashboard, _ = self.request("GET", "/api/manage/ai/usage")
        self.assertEqual(code, 200, dashboard)
        self.assertTrue(dashboard["can_edit_defaults"])
        self.assertNotIn("api_key", json.dumps(dashboard))
        saved = dashboard["settings"]
        settings = {"daily_limit": 15, "monthly_limit": 200, "per_minute": 6, "global_daily_limit": 1000, "global_monthly_limit": 10000}
        no_csrf = urllib.request.Request(self.base_url + "/api/manage/ai/settings", data=json.dumps(settings).encode(), headers={"Content-Type": "application/json"}, method="PATCH")
        with self.assertRaises(urllib.error.HTTPError) as error:
            self.client.open(no_csrf)
        self.assertEqual(error.exception.code, 403)
        error.exception.close()
        self.assertEqual(self.request("PATCH", "/api/manage/ai/settings", settings)[0], 200)
        try:
            self.assertEqual(self.request("GET", "/api/manage/ai/usage")[1]["settings"], settings)
            self.assertEqual(self.request("GET", "/api/aura/quota")[1]["policy"]["daily_limit"], 15)
            self.assertEqual(self.request("PATCH", "/api/manage/ai/settings", {"daily_limit": -1})[0], 422)
            self.grant_ai_consent()
            self.assertEqual(self.request("PATCH", "/api/manage/ai/settings", {"daily_limit": 0})[0], 200)
            self.assertEqual(self.request("POST", "/api/vision/chat", {"message": "Do not contact a provider"})[0], 429)
            self.assertEqual(self.request("GET", "/api/aura/quota")[1]["usage"]["today"], 0)
        finally:
            self.request("PATCH", "/api/manage/ai/settings", saved)
        self.request("POST", "/api/auth/logout", {})
        self.request("POST", "/api/auth/register", {"email": "quota_" + uuid4().hex + "@example.test", "password": "Quota member password 123"})
        self.assertEqual(self.request("GET", "/api/manage/ai/usage")[0], 403)
        self.assertEqual(self.request("PATCH", "/api/manage/ai/settings", settings)[0], 403)

    def test_admin_delegation_temporary_password_and_three_admin_limit(self):
        self.assertEqual(self.request("POST", "/api/auth/admin/login", {"email": "integration_admin", "password": "Integration admin password 123"})[0], 200)
        central_cookies, central_client = self.cookies, self.client
        created = []
        try:
            for _ in range(2):
                username = "delegate_" + uuid4().hex[:12]
                code, account, _headers = self.request("POST", "/api/manage/accounts", {"username": username, "display_name": "Delegate admin", "role": "admin"})
                self.assertEqual(code, 201, account)
                created.append((username, account))
            self.assertEqual(self.request("POST", "/api/manage/accounts", {"username": "fourth_" + uuid4().hex[:12], "display_name": "Fourth admin", "role": "admin"})[0], 409)
            self.setUp()
            username, account = created[0]
            temporary = account["temporary_password"]
            code, logged_in, _ = self.request("POST", "/api/auth/admin/login", {"email": username, "password": temporary})
            self.assertEqual(code, 200, logged_in)
            self.assertTrue(logged_in["must_change_password"])
            self.assertEqual(self.request("GET", "/api/manage/status")[0], 403)
            with self.client.open(self.base_url + "/manage") as page:
                self.assertIn("/account.html?next=", page.url)
            permanent = "Delegate permanent password 123"
            self.assertEqual(self.request("POST", "/api/vision/auth/password", {"current_password": temporary, "new_password": permanent})[0], 200)
            self.assertEqual(self.request("GET", "/api/auth/me")[0], 401)
            code, logged_in, _ = self.request("POST", "/api/auth/admin/login", {"email": username, "password": permanent})
            self.assertEqual(code, 200, logged_in)
            self.assertFalse(logged_in["must_change_password"])
            self.assertFalse(self.request("GET", "/api/manage/status")[1]["is_central"])
            self.assertEqual(self.request("GET", "/api/manage/accounts")[0], 200)
            self.assertEqual(self.request("PATCH", "/api/manage/features/aura_ai", {"enabled": False})[0], 403)
            self.assertEqual(self.request("PATCH", "/api/manage/ai/settings", {"daily_limit": 1000})[0], 403)
            self.assertFalse(self.request("GET", "/api/manage/ai/usage")[1]["can_edit_defaults"])
            self.assertEqual(self.request("POST", "/api/manage/accounts", {"username": "forbidden_admin", "display_name": "Forbidden", "role": "admin"})[0], 403)
        finally:
            self.cookies, self.client = central_cookies, central_client
            for _username, account in created:
                self.request("PATCH", "/api/manage/accounts/" + account["account"]["id"] + "/role", {"role": "user"})

    def test_health_and_ai_status_and_cors(self) -> None:
        code, data, _ = self.request("GET", "/api/health")
        self.assertEqual(code, 200)
        self.assertEqual(data["database"], "ok")

        code, data, _ = self.request("GET", "/api/assistant/status")
        self.assertEqual(code, 200)
        self.assertFalse(data["available"])

        code, data, _ = self.request("GET", "/api/aura/status")
        self.assertEqual(code, 200)
        self.assertFalse(data["available"])
        self.assertEqual(data["status"], "not_configured")

        code, data, _ = self.request("GET", "/api/face-analyses/status")
        self.assertEqual(code, 200)
        self.assertTrue(data["available"])
        self.assertEqual(data["status"], "ready")
        self.assertTrue(data["advanced_available"])
        self.assertEqual(data["advanced_endpoint"], "/api/vision/analyze_face")

        code, _, headers = self.request("OPTIONS", "/api/health", origin="http://localhost:8000")
        self.assertEqual(code, 200)
        self.assertEqual(headers.get("Access-Control-Allow-Credentials"), "true")
        self.assertIn("x-csrf-token", headers.get("Access-Control-Allow-Headers", "").lower())

    def test_auth_consent_habits_progress_and_account_deletion(self) -> None:
        code, _, _ = self.request("GET", "/api/auth/me")
        self.assertEqual(code, 401)

        email, password = self.register()
        with closing(self.app_connection()) as connection:
            stored_user = connection.execute("SELECT id, password_hash FROM users WHERE email = ?", (email,)).fetchone()
        user_id, stored_hash = stored_user[0], stored_user[1]
        self.assertNotEqual(stored_hash, password)
        self.assertTrue(stored_hash.startswith("scrypt$"))
        code, user, _ = self.request("GET", "/api/auth/me")
        self.assertEqual(code, 200)
        self.assertEqual(user["email"], email)

        code, _, _ = self.request("POST", "/api/habits", {"category": "water", "value": "250", "unit": "ml"})
        self.assertEqual(code, 403, "Chưa đồng ý thì không được ghi dữ liệu sức khỏe.")

        self.grant_health_consent()
        code, record, _ = self.request(
            "POST", "/api/habits",
            {"category": "water", "value": "250", "unit": "ml", "note": "Sau khi đi bộ"},
        )
        self.assertEqual(code, 201)
        self.assertEqual(record["value"], "250")

        code, records, _ = self.request("GET", "/api/habits")
        self.assertEqual(code, 200)
        self.assertEqual(len(records), 1)

        code, progress, _ = self.request("GET", "/api/progress/summary")
        self.assertEqual(code, 200)
        self.assertEqual(progress["total_entries"], 1)

        code, _, _ = self.request("POST", "/api/consents", {"purpose": "health_tracking", "granted": False})
        self.assertEqual(code, 201)
        code, _, _ = self.request("GET", "/api/habits")
        self.assertEqual(code, 403, "Thu hồi đồng ý phải khóa dữ liệu sức khỏe ngay.")

        code, _, _ = self.request("DELETE", "/api/auth/me", {"password": password, "confirmation": "DELETE"})
        self.assertEqual(code, 204)
        code, _, _ = self.request("GET", "/api/auth/me")
        self.assertEqual(code, 401)
        with closing(self.app_connection()) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM users WHERE id = ?", (user_id,)).fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM habit_entries WHERE user_id = ?", (user_id,)).fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM user_consents WHERE user_id = ?", (user_id,)).fetchone()[0], 0)

    def test_health_hub_routine_journal_and_persistence(self):
        self.assertEqual(self.request("GET", "/api/health-hub/routine")[0], 401)
        email, password = self.register()
        user_id = self.request("GET", "/api/auth/me")[1]["id"]
        self.assertEqual(self.request("GET", "/api/health-hub/routine")[0], 403)
        self.grant_health_consent()
        code, state, _ = self.request("GET", "/api/health-hub/routine")
        self.assertEqual(code, 200)
        self.assertEqual(state["tasks"], [])
        code, state, _ = self.request("POST", "/api/health-hub/routine", {"revision": state["revision"]})
        self.assertEqual(code, 200, state)
        self.assertEqual(len(state["tasks"]), 4)
        old_revision = state["revision"]
        code, state, _ = self.request("PATCH", "/api/health-hub/routine", {"revision": old_revision, "action": "complete", "task_id": "drink_water", "completed": True})
        self.assertEqual(code, 200, state)
        self.assertEqual(state["completed"], 1)
        self.assertEqual(self.request("PATCH", "/api/health-hub/routine", {"revision": old_revision, "action": "preferences", "intensity": "gentle"})[0], 409)
        code, records, _ = self.request("GET", "/api/habits")
        self.assertEqual(code, 200)
        self.assertEqual(len(records), 1)
        self.assertIn("Routine", records[0]["note"])
        self.assertEqual(self.request("POST", "/api/auth/logout", {})[0], 204)
        self.assertEqual(self.request("POST", "/api/auth/login", {"email": email, "password": password})[0], 200)
        self.assertEqual(self.request("GET", "/api/health-hub/routine")[1]["completed"], 1)
        self.assertEqual(self.request("DELETE", "/api/habits/" + records[0]["id"])[0], 204)
        self.assertEqual(self.request("GET", "/api/health-hub/routine")[1]["completed"], 0)
        self.assertEqual(self.request("DELETE", "/api/auth/me", {"password": password, "confirmation": "DELETE"})[0], 204)
        with closing(self.app_connection()) as connection:
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM health_routines r JOIN users u ON u.id = r.user_id WHERE u.email = ?", (email,)).fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM health_routines WHERE user_id = ?", (user_id,)).fetchone()[0], 0)
            if self.pg_test:
                self.assertTrue(connection.execute("SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('health_routines')").fetchone()[0])

    def test_health_hub_report_consent_privacy_and_user_isolation(self):
        self.register()
        self.grant_health_consent()
        state = self.request("GET", "/api/health-hub/routine")[1]
        payload = {"revision": state["revision"], "report": {"skin": {"smoothness_score": 72}, "image": "private-image", "landmarks": [1, 2], "account_id": "private-id"}}
        self.assertEqual(self.request("POST", "/api/health-hub/routine", payload)[0], 403)
        self.assertEqual(self.request("POST", "/api/consents", {"purpose": "face_analysis", "granted": True})[0], 201)
        code, state, _ = self.request("POST", "/api/health-hub/routine", payload)
        self.assertEqual(code, 200, state)
        self.assertEqual(state["report"], {"skin": {"smoothness_score": 72}})
        self.assertNotIn("private-", json.dumps(state))
        original_cookies, original_client = self.cookies, self.client
        self.setUp()
        try:
            self.register()
            self.grant_health_consent()
            other = self.request("GET", "/api/health-hub/routine")[1]
            self.assertEqual(other["tasks"], [])
            self.assertIsNone(other["report"])
            self.assertEqual(self.request("PATCH", "/api/health-hub/routine", {"revision": other["revision"], "action": "complete", "task_id": "drink_water", "completed": True})[0], 404)
        finally:
            self.cookies, self.client = original_cookies, original_client
        self.assertEqual(self.request("POST", "/api/consents", {"purpose": "face_analysis", "granted": False})[0], 201)
        self.assertIsNone(self.request("GET", "/api/health-hub/routine")[1]["report"])
        self.assertEqual(self.request("POST", "/api/consents", {"purpose": "health_tracking", "granted": False})[0], 201)
        self.assertEqual(self.request("GET", "/api/health-hub/routine")[0], 403)
        self.assertEqual(self.request("POST", "/api/consents", {"purpose": "health_tracking", "granted": True})[0], 201)
        self.assertEqual(self.request("GET", "/api/health-hub/routine")[1]["tasks"], [])

    def test_health_hub_mutations_require_csrf_and_feature_enabled(self):
        self.register()
        self.grant_health_consent()
        state = self.request("GET", "/api/health-hub/routine")[1]
        cookies = "; ".join(f"{cookie.name}={cookie.value}" for cookie in self.cookies)
        request = urllib.request.Request(self.base_url + "/api/health-hub/routine",
            data=json.dumps({"revision": state["revision"]}).encode(),
            headers={"Content-Type": "application/json", "Cookie": cookies}, method="POST")
        with self.assertRaises(urllib.error.HTTPError) as failure:
            urllib.request.urlopen(request, timeout=30 if self.pg_test else 8)
        self.assertEqual(failure.exception.code, 403)
        failure.exception.close()
        with closing(self.app_connection()) as connection:
            connection.execute("UPDATE admin_feature_flags SET enabled = 0 WHERE feature_key = 'health_tracking'")
            connection.commit()
        try:
            self.assertEqual(self.request("GET", "/api/health-hub/routine")[0], 503)
            self.assertEqual(self.request("POST", "/api/health-hub/routine", {"revision": state["revision"]})[0], 503)
        finally:
            with closing(self.app_connection()) as connection:
                connection.execute("UPDATE admin_feature_flags SET enabled = 1 WHERE feature_key = 'health_tracking'")
                connection.commit()

    def test_validation_csrf_and_unavailable_ai(self) -> None:
        code, _, _ = self.request("POST", "/api/auth/register", {"email": "bad", "password": "short"})
        self.assertEqual(code, 422)

        self.register()
        code, _, _ = self.request("POST", "/api/assistant/messages", {"message": "Xin chào"})
        self.assertEqual(code, 403, "Cần đồng ý trước khi gửi nội dung hội thoại.")

        code, _, _ = self.request("POST", "/api/consents", {"purpose": "ai_chat", "granted": True})
        self.assertEqual(code, 201)
        code, data, _ = self.request("POST", "/api/assistant/messages", {"message": "Xin chào"})
        self.assertEqual(code, 503)
        self.assertIn("chưa được cấu hình", data["detail"])

    def test_aura_conversation_ownership_and_consent_revocation(self) -> None:
        email, password = self.register()
        code, empty_history, _ = self.request("GET", "/api/aura/conversations")
        self.assertEqual(code, 200)
        self.assertEqual(empty_history, [])
        code, _, _ = self.request("POST", "/api/aura/conversations", {"title": "Should need consent"})
        self.assertEqual(code, 403)
        self.grant_ai_consent()

        code, conversation, _ = self.request("POST", "/api/aura/conversations", {"title": "Face Lab result"})
        self.assertEqual(code, 201)
        own_id = conversation["id"]
        code, conversations, _ = self.request("GET", "/api/aura/conversations")
        self.assertEqual(code, 200)
        self.assertEqual([row["id"] for row in conversations], [own_id])
        code, messages, _ = self.request("GET", f"/api/aura/conversations/{own_id}/messages")
        self.assertEqual(code, 200)
        self.assertEqual(messages, [])

        self.register(email=f"{uuid4().hex}@example.test")
        code, other_list, _ = self.request("GET", "/api/aura/conversations")
        self.assertEqual(code, 200)
        self.assertEqual(other_list, [])
        code, _, _ = self.request("GET", f"/api/aura/conversations/{own_id}/messages")
        self.assertEqual(code, 404)
        code, _, _ = self.request("DELETE", f"/api/aura/conversations/{own_id}")
        self.assertEqual(code, 404)

        self.request("POST", "/api/auth/login", {"email": email, "password": password})
        self.grant_ai_consent(False)
        code, history_after_revoke, _ = self.request("GET", "/api/aura/conversations")
        self.assertEqual(code, 200)
        self.assertEqual(history_after_revoke, [])

    def test_aura_unconfigured_chat_and_secret_filter_do_not_store_message(self) -> None:
        self.register()
        self.grant_ai_consent()
        code, data, _ = self.request("POST", "/api/aura/conversations", {"title": "password=supersecret"})
        self.assertEqual(code, 422)
        self.assertNotIn("supersecret", data["detail"])
        code, conversation, _ = self.request("POST", "/api/aura/conversations", {})
        self.assertEqual(code, 201)
        conversation_id = conversation["id"]
        code, data, _ = self.request(
            "POST", "/api/aura/chat", {"conversation_id": conversation_id, "message": "Hello Aura"}
        )
        self.assertEqual(code, 503)
        self.assertIn("chưa được cấu hình", data["detail"])
        self.assertNotIn("AI_PROVIDER", data["detail"])
        code, data, _ = self.request(
            "POST", "/api/aura/chat", {"conversation_id": conversation_id, "message": "password=supersecret"}
        )
        self.assertEqual(code, 422)
        self.assertNotIn("supersecret", data["detail"])
        code, messages, _ = self.request("GET", f"/api/aura/conversations/{conversation_id}/messages")
        self.assertEqual(code, 200)
        self.assertEqual(messages, [])

    def test_arena_profile_privacy_leaderboard_and_ranked_match_gate(self) -> None:
        code, _, cors_headers = self.request(
            "OPTIONS", "/api/arena/profile", origin="http://localhost:8000"
        )
        self.assertEqual(code, 200)
        self.assertIn("PATCH", cors_headers.get("Access-Control-Allow-Methods", ""))

        self.register()

        code, profile, _ = self.request("GET", "/api/arena/profile")
        self.assertEqual(code, 200)
        self.assertEqual(profile["elo"], 1000)
        self.assertEqual(profile["rank"]["name"], "Silver")
        self.assertFalse(profile["leaderboard_public"])
        self.assertEqual(profile["matches_played"], 0)

        code, leaderboard, _ = self.request("GET", "/api/arena/leaderboard")
        self.assertEqual(code, 200)
        self.assertEqual(leaderboard["entries"], [])

        code, profile, _ = self.request(
            "PATCH", "/api/arena/profile",
            {"display_name": "Arena Tester", "leaderboard_public": True},
        )
        self.assertEqual(code, 200)
        self.assertTrue(profile["leaderboard_public"])
        self.assertEqual(profile["display_name"], "Arena Tester")

        code, leaderboard, _ = self.request("GET", "/api/arena/leaderboard?tab=top")
        self.assertEqual(code, 200)
        self.assertEqual(len(leaderboard["entries"]), 1)
        self.assertEqual(leaderboard["entries"][0]["display_name"], "Arena Tester")
        self.assertNotIn("email", leaderboard["entries"][0])
        code, position, _ = self.request("GET", "/api/arena/leaderboard/me")
        self.assertEqual(code, 200)
        self.assertEqual(position["position"], 1)

        code, data, _ = self.request("POST", "/api/arena/matches", {})
        self.assertEqual(code, 503)
        self.assertIn("No opponent or result was generated", data["detail"])

        self.request("PATCH", "/api/arena/profile", {"leaderboard_public": False})
        code, leaderboard, _ = self.request("GET", "/api/arena/leaderboard")
        self.assertEqual(code, 200)
        self.assertEqual(leaderboard["entries"], [])

    def test_bot_match_is_idempotent_and_separate_from_pvp(self) -> None:
        self.register()
        code, _, _ = self.request(
            "PATCH", "/api/arena/profile",
            {"display_name": "BOT Tester", "leaderboard_public": True},
        )
        self.assertEqual(code, 200)
        code, bot_list, _ = self.request("GET", "/api/arena/bots")
        self.assertEqual(code, 200)
        self.assertTrue(bot_list["simulated"])
        self.assertEqual([bot["elo"] for bot in bot_list["bots"]], [700, 900, 1100, 1300, 1500])
        rookie = bot_list["bots"][0]
        payload = {
            "request_id": str(uuid4()),
            "bot_id": "rookie",
            "groups": [
                {"id": category, "score": value, "status": "complete"}
                for category, value in rookie["scores"].items()
            ],
        }
        code, _, _ = self.request("POST", "/api/arena/bot-matches", payload)
        self.assertEqual(code, 403, "BOT battle needs Face Lab consent.")
        self.grant_face_consent()

        code, first, _ = self.request("POST", "/api/arena/bot-matches", payload)
        self.assertEqual(code, 200)
        self.assertEqual(first["result"], "draw")
        self.assertEqual(first["player_score"], first["bot_score"])
        self.assertEqual(first["elo_before"], 1000)
        self.assertEqual(first["elo_after"], 986, "A draw against a lower-rated bot changes Elo using the shared Elo formula.")
        self.assertTrue(first["simulated"])

        code, replay, _ = self.request("POST", "/api/arena/bot-matches", payload)
        self.assertEqual(code, 200)
        self.assertTrue(replay["replayed"])
        self.assertEqual(replay["id"], first["id"])

        win_payload = {
            "request_id": str(uuid4()),
            "bot_id": "rookie",
            "groups": [
                {"id": category, "score": 100, "status": "complete"}
                for category in rookie["scores"]
            ],
        }
        code, win, _ = self.request("POST", "/api/arena/bot-matches", win_payload)
        self.assertEqual(code, 200)
        self.assertEqual(win["result"], "win")
        self.assertGreater(win["elo_after"], win["elo_before"])

        loss_payload = {
            "request_id": str(uuid4()),
            "bot_id": "champion",
            "groups": [
                {"id": category, "score": 0, "status": "complete"}
                for category in rookie["scores"]
            ],
        }
        code, loss, _ = self.request("POST", "/api/arena/bot-matches", loss_payload)
        self.assertEqual(code, 200)
        self.assertEqual(loss["result"], "loss")
        self.assertLess(loss["elo_after"], loss["elo_before"])

        code, history, _ = self.request("GET", "/api/arena/bot-matches/history")
        self.assertEqual(code, 200)
        self.assertEqual(len(history), 3)
        code, summary, _ = self.request("GET", "/api/arena/bot-matches/summary")
        self.assertEqual(code, 200)
        self.assertEqual((summary["matches_played"], summary["wins"], summary["losses"], summary["draws"]), (3, 1, 1, 1))

        code, profile, _ = self.request("GET", "/api/arena/profile")
        self.assertEqual(code, 200)
        self.assertEqual((profile["elo"], profile["matches_played"], profile["draws"]), (1000, 0, 0))
        code, leaderboard, _ = self.request("GET", "/api/arena/leaderboard")
        self.assertEqual(code, 200)
        self.assertEqual(len(leaderboard["entries"]), 1)
        self.assertEqual(leaderboard["entries"][0]["elo"], 1000)
        self.assertEqual(leaderboard["entries"][0]["matches_played"], 0)

        code, rejected, _ = self.request("POST", "/api/arena/bot-matches", {**payload, "elo": 9999})
        self.assertEqual(code, 422, "Frontend must not set Elo.")
        code, _, _ = self.request("POST", "/api/consents", {"purpose": "face_analysis", "granted": False})
        self.assertEqual(code, 201)
        code, history, _ = self.request("GET", "/api/arena/bot-matches/history")
        self.assertEqual(code, 200)
        self.assertEqual(history, [])
        code, summary, _ = self.request("GET", "/api/arena/bot-matches/summary")
        self.assertEqual(code, 200)
        self.assertEqual(summary["matches_played"], 0)

    def test_bot_match_v2_details_replay_and_coverage(self) -> None:
        self.register()
        self.grant_face_consent()
        _, catalog, _ = self.request("GET", "/api/arena/bots")
        rookie = catalog["bots"][0]
        measured = {"proportions", "nose", "jawChin", "skin"}
        groups = [{"id": key, "score": value if key in measured else None,
                   "status": "complete" if key in measured else "missing"}
                  for key, value in rookie["scores"].items()]
        payload = {"request_id": str(uuid4()), "bot_id": "rookie", "groups": groups}
        with ThreadPoolExecutor(max_workers=2) as executor:
            responses = list(executor.map(lambda _: self.request("POST", "/api/arena/bot-matches", payload), range(2)))
        self.assertEqual([response[0] for response in responses], [200, 200])
        self.assertEqual(responses[0][1]["id"], responses[1][1]["id"])
        self.assertEqual(sorted(response[1]["replayed"] for response in responses), [False, True])
        code, match, _ = responses[0]
        self.assertEqual(code, 200)
        self.assertEqual(match["result"], "draw")
        self.assertEqual(match["player_score"], match["bot_score"])
        self.assertEqual(match["coverage"], 64)
        self.assertEqual(match["scoring"]["effective_k"], 25.6)
        self.assertEqual(match["scoring"]["version"], "arena-practice-v2")
        code, replay, _ = self.request("POST", "/api/arena/bot-matches", {**payload, "groups": list(reversed(groups))})
        self.assertEqual(code, 200)
        self.assertEqual(replay["id"], match["id"])
        self.assertEqual(replay["scoring"], match["scoring"])
        changed = [dict(group) for group in groups]
        changed[0]["score"] += 2
        code, _, _ = self.request("POST", "/api/arena/bot-matches", {**payload, "groups": changed})
        self.assertEqual(code, 409)
        code, _, _ = self.request("POST", "/api/arena/bot-matches", {**payload, "bot_id": "casual"})
        self.assertEqual(code, 409)
        code, rounds, _ = self.request("POST", "/api/arena/bot-matches", {**payload, "request_id": str(uuid4()), "round_scores": [10, 10, 10]})
        self.assertEqual(code, 200)
        self.assertEqual(rounds["result"], "loss")
        self.assertEqual(rounds["player_score"], 10)
        self.assertEqual(rounds["bot_score"], 60.17)
        _, stored, _ = self.request("GET", "/api/arena/bot-matches/history")
        self.assertEqual(len(stored), 2)
        self.assertEqual(stored[0]["scoring"], rounds["scoring"])
        _, summary, _ = self.request("GET", "/api/arena/bot-matches/summary")
        self.assertEqual(summary["matches_played"], 2)
        self.assertEqual(len(summary["elo_trend"]), 3)
        self.assertEqual(summary["elo_trend"][-1], summary["elo"])
        self.assertIn(summary["recommended_bot_id"], [bot["id"] for bot in catalog["bots"]])
        self.request("POST", "/api/consents", {"purpose": "face_analysis", "granted": False})
        self.assertEqual(self.request("GET", "/api/arena/bot-matches/history")[1], [])

if __name__ == "__main__":
    unittest.main()
