"""Disposable browser fixture; never reads or writes the application's face database."""
import sys
import tempfile
import threading
from functools import partial
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server
from auth_store import AuthStore
from face_store import FaceStore


class FixtureHandler(server.VisionFaceRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/__fixture_stop":
            self._send_json({"success": True})
            threading.Thread(target=self.server.shutdown, daemon=True).start()
        else:
            super().do_GET()


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="visionface-browser-") as directory:
        server.face_database = FaceStore(Path(directory) / "fixture.sqlite3")
        server.face_database.initialize()
        auth = AuthStore(server.face_database)
        auth.initialize()
        auth.create_account("admin", "Admin thử nghiệm", "Browser temp password 123", role="admin", force_change=True)
        auth.create_account("bob", "Bob thử nghiệm", "Browser user password 123")
        server.face_database.register('<img src=x onerror="window.injected=true">', [.1] * 60)
        handler = partial(FixtureHandler, directory=str(server.BASE_DIR))
        with server.VisionFaceHTTPServer(("127.0.0.1", 0), handler) as httpd:
            print(httpd.server_port, flush=True)
            httpd.serve_forever(poll_interval=.05)
