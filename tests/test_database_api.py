import http.client
import json
import sqlite3
import sys
import tempfile
import threading
import unittest
from contextlib import closing
from functools import partial
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from face_store import FaceStore
from auth_store import AuthStore, LoginLimiter


class QuietHandler(server.VisionFaceRequestHandler):
    def log_message(self, *args):
        pass


class DatabaseAPITests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.store = FaceStore(self.root / "faces.sqlite3")
        self.store.initialize()
        self.auth = AuthStore(self.store)
        self.auth.initialize()
        self.admin = self.auth.create_account("admin", "Admin", "Test admin password 123", role="admin")
        self.cookie = ""
        self.csrf = ""
        self.legacy = self.root / "face_database.json"
        self.legacy.write_text("[]", encoding="utf-8")
        self.store.migrate_json(self.legacy)
        (self.root / "real_time_face_landmark_liveness_tracker.html").write_text("test page", encoding="utf-8")
        for target, value in (("face_database", self.store), ("LEGACY_DATABASE_FILE", self.legacy)):
            patcher = patch.object(server, target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        limiter = patch.object(server, "login_limiter", LoginLimiter())
        limiter.start()
        self.addCleanup(limiter.stop)
        self.httpd = server.VisionFaceHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(self.root)))
        self.thread = threading.Thread(target=self.httpd.serve_forever, kwargs={"poll_interval": 0.01}, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        self.points = [{"x": i / 500, "y": 0.4, "z": 0.0} for i in range(478)]
        self.login_as("admin", role="admin", password="Test admin password 123")

    def login_as(self, username, role="user", password="Test user password 123"):
        self.cookie, self.csrf = "", ""
        status, data = self.request("POST", f"/api/auth/{role}/login", {"username": username, "password": password})
        self.assertEqual(status, 200, data)
        self.csrf = data["csrf_token"]
        return data

    def stop_server(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=5)

    def request(self, method, path, payload=None, headers=None, authenticated=True):
        connection = http.client.HTTPConnection("127.0.0.1", self.httpd.server_port, timeout=5)
        try:
            body = json.dumps(payload) if payload is not None else None
            request_headers = {"Content-Type": "application/json"}
            if authenticated:
                request_headers.update({"Cookie": self.cookie, "X-CSRF-Token": self.csrf})
            request_headers.update(headers or {})
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            if response.getheader("Set-Cookie"):
                self.cookie = response.getheader("Set-Cookie").split(";")[0]
            data = response.read()
            if response.getheader("Content-Type", "").startswith("application/json"):
                data = json.loads(data)
            return response.status, data
        finally:
            connection.close()

    def register(self):
        status, data = self.request("POST", "/api/register", {"name": "Nguy\u1ec5n An", "landmarks": self.points})
        self.assertEqual(status, 200, data)
        return data["user"]

    def test_register_match_list_and_delete(self):
        user = self.register()
        self.assertEqual(user["sample_count"], 1)
        status, data = self.request("GET", "/api/faces")
        self.assertEqual(status, 200)
        self.assertEqual(data["total"], 1)
        self.assertNotIn("vector", data["faces"][0])
        status, data = self.request("POST", "/api/process", {"landmarks": self.points, "check_challenge": False})
        self.assertEqual(status, 200)
        self.assertTrue(data["match"]["matched"])
        self.assertEqual(data["match"]["user_id"], user["id"])
        self.assertEqual(self.request("DELETE", "/api/faces", {"id": user["id"]})[0], 200)
        self.assertEqual(self.store.counts(), {"people": 0, "samples": 0})
        status, data = self.request("POST", "/api/process", {"landmarks": self.points})
        self.assertEqual(status, 200)
        self.assertIsNone(data["match"])

    def test_add_sample_to_existing_person(self):
        user = self.register()
        points = [dict(p) for p in self.points]
        points[10]["y"] += 0.02
        status, data = self.request("POST", "/api/register", {
            "name": user["name"], "user_id": user["id"], "landmarks": points
        })
        self.assertEqual(status, 200, data)
        self.assertEqual(data["user"]["id"], user["id"])
        self.assertEqual(data["user"]["sample_count"], 2)
        status, data = self.request("GET", "/api/status")
        self.assertEqual(status, 200)
        self.assertEqual(data["database"], self.store.backend)
        self.assertEqual(data["registered_faces_count"], 1)
        self.assertEqual(data["registered_samples_count"], 2)
        status, data = self.request("POST", "/api/process", {"landmarks": points})
        self.assertEqual(status, 200)
        self.assertEqual(data["match"]["distance"], 0)

    def test_invalid_registration_never_writes(self):
        for payload in ([], {"name": None, "landmarks": self.points},
                        {"name": "", "landmarks": self.points},
                        {"name": "An", "landmarks": [None] * 478},
                        {"name": "An", "landmarks": [{"x": float("nan"), "y": 0}] * 478},
                        {"name": "An", "landmarks": [{"x": 0, "y": 0}] * 478}):
            with self.subTest(payload_type=type(payload)):
                self.assertEqual(self.request("POST", "/api/register", payload)[0], 400)
                self.assertEqual(self.store.counts()["people"], 0)

    def test_unknown_sample_target_returns_404(self):
        status, _ = self.request("POST", "/api/register", {
            "name": "An", "user_id": "missing", "landmarks": self.points
        })
        self.assertEqual(status, 404)
        self.assertEqual(self.store.counts()["people"], 0)

    def test_invalid_delete_cannot_clear_database(self):
        self.register()
        for payload in ([], {"id": None}, {"id": ""}, {"other": "value"}):
            self.assertEqual(self.request("DELETE", "/api/faces", payload)[0], 400)
            self.assertEqual(self.store.counts()["people"], 1)
        self.assertEqual(self.request("DELETE", "/api/faces", {"id": "missing"})[0], 404)
        self.assertEqual(self.request("DELETE", "/api/faces", {})[0], 200)
        self.assertEqual(self.store.counts(), {"people": 0, "samples": 0})

    def test_failed_storage_write_returns_500_and_rolls_back(self):
        with closing(sqlite3.connect(self.store.path)) as connection:
            connection.execute("""CREATE TRIGGER reject_sample BEFORE INSERT ON face_samples
                                  BEGIN SELECT RAISE(ABORT, 'test write failure'); END""")
        with patch("builtins.print"):
            status, data = self.request("POST", "/api/register", {"name": "An", "landmarks": self.points})
        self.assertEqual(status, 500)
        self.assertFalse(data["success"])
        self.assertEqual(self.store.counts(), {"people": 0, "samples": 0})

    def test_private_files_are_not_served_by_get_or_head(self):
        paths = ("/faces.sqlite3", "/face_database.json", "/face%5Fdatabase.json",
                 "/faces.sqlite3-journal", "/faces.sqlite3-wal", "/faces.sqlite3-shm",
                 "/database.local.json", "/database.local.tmp", "/backups/faces.sqlite3")
        for path in paths:
            with self.subTest(path=path):
                self.assertEqual(self.request("GET", path)[0], 404)
                self.assertEqual(self.request("HEAD", path)[0], 404)
        self.assertEqual(self.request("GET", "/")[0], 200)

    def test_pages_and_shared_assets_are_served(self):
        project = Path(server.__file__).resolve().parent
        for filename in ("index.html", "real_time_face_landmark_liveness_tracker.html",
                         "assets/app.js", "assets/app.css", "assets/session.js"):
            with self.subTest(filename=filename):
                source = project / filename
                target = self.root / filename
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(source.read_bytes())
        for url, filename in (("/", "index.html"), ("/index.html", "index.html"),
                              ("/real_time_face_landmark_liveness_tracker.html", "index.html"),
                              ("/assets/app.js", "assets/app.js"), ("/assets/app.css", "assets/app.css")):
            with self.subTest(url=url):
                status, body = self.request("GET", url)
                self.assertEqual(status, 200)
                self.assertEqual(body, (project / filename).read_bytes())


if __name__ == "__main__":
    unittest.main()
