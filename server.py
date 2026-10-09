"""
Server: server.py
Mô tả: HTTP REST API Server & Web Host phục vụ thuật toán nhận diện và Liveness của VisionFace.
HTTP server dùng thư viện chuẩn Python; phân tích ảnh cần NumPy và Pillow (requirements.txt).
Chạy: py server.py
Truy cập: http://localhost:8000
"""

import json
import math
import os
import sqlite3
import socket
import sys
import threading
import time
import traceback
import secrets

# Đảm bảo mã hóa UTF-8 cho stdout/stderr trên Windows
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

from functools import partial
from pathlib import Path

from http import HTTPStatus
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from http.cookies import SimpleCookie, CookieError
from urllib.parse import urlsplit, unquote
from typing import Dict, Any
from face_store import FEATURE_VERSION, StorageError
from database_config import CONFIG_NAME, create_store
from auth_store import AuthStore, AuthError, LoginLimiter, SESSION_SECONDS

from face_liveness_algorithms import (
    LandmarkPoint,
    extract_face_feature_vector,
    LivenessChallengeEngine,
    analyze_frame_landmarks
)
from face_aesthetic_analyzer import (
    run_comprehensive_face_analysis,
    run_multi_view_face_analysis
)

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", 8000))
BASE_DIR = Path(__file__).resolve().parent
DATABASE_FILE = Path(os.environ.get("FACE_DATABASE_PATH", str(BASE_DIR / "face_database.sqlite3"))).resolve()
LEGACY_DATABASE_FILE = BASE_DIR / "face_database.json"

# Biến toàn cục quản lý Database và Liveness Engine
face_database = create_store(BASE_DIR)
global_challenge_lock = threading.RLock()
challenge_engines = {}
login_limiter = LoginLimiter()
COOKIE_NAME = "visionface_session"


class VisionFaceHTTPServer(ThreadingHTTPServer):
    """Serve concurrent browser connections; allow only one listener on Windows."""

    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def load_database():
    """Initialize the configured database; legacy JSON import applies only to SQLite."""
    face_database.initialize()
    imported = face_database.migrate_json(LEGACY_DATABASE_FILE) if face_database.backend == "sqlite" else 0
    AuthStore(face_database).initialize()
    counts = face_database.counts()
    print(f"[Database] {face_database.backend}: {counts['people']} people, {counts['samples']} samples; imported {imported}")


def validate_landmarks(data):
    if not isinstance(data, list) or not 468 <= len(data) <= 478:
        raise ValueError("Expected 468 to 478 face landmarks")
    for point in data:
        if not isinstance(point, dict):
            raise ValueError("Each landmark must be an object")
        for axis in ("x", "y", "z"):
            value = point.get(axis, 0 if axis == "z" else None)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
                raise ValueError("Landmark coordinates must be finite numbers")
    points = [LandmarkPoint(p["x"], p["y"], p.get("z", 0)) for p in data]
    if sum((getattr(points[234], axis) - getattr(points[454], axis)) ** 2
           for axis in ("x", "y", "z")) < 1e-12:
        raise ValueError("Invalid face geometry")
    return points


class VisionFaceRequestHandler(SimpleHTTPRequestHandler):
    """Bộ xử lý yêu cầu HTTP hỗ trợ REST API và CORS."""

    def end_headers(self):
        """Authenticated web/API use the same origin."""
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        """Xử lý pre-flight request của CORS."""
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def _send_json(self, data: Any, status_code: int = 200, cookie=None):
        """Gửi dữ liệu JSON về client."""
        response_bytes = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        if cookie is not None:
            self.send_header("Set-Cookie", cookie)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

    def _read_json_body(self) -> Dict[str, Any]:
        """Đọc và parse payload JSON từ client."""
        content_length = int(self.headers.get("Content-Length", 0))
        if not 0 <= content_length <= 12 * 1024 * 1024:
            raise ValueError("Invalid Content-Length")
        if content_length == 0:
            return {}
        body = self.rfile.read(content_length).decode("utf-8")
        payload = json.loads(body)
        if not isinstance(payload, dict):
            raise ValueError("JSON payload must be an object")
        return payload

    def _dispatch(self, handler):
        try:
            handler()
        except AuthError as error:
            self._send_json({"success": False, "message": str(error)}, error.status)
        except PermissionError as error:
            self._send_json({"success": False, "message": str(error)}, 403)
        except (sqlite3.Error, StorageError) as error:
            print(f"[Database] {type(error).__name__}: {error}")
            self._send_json({"success": False, "message": "Không thể truy cập database. Thao tác chưa được xác nhận."}, 500)
        except (ValueError, TypeError) as error:
            self._send_json({"success": False, "message": str(error)}, 400)

    def send_head(self):
        relative = unquote(urlsplit(self.path).path)
        pages = {"/", "/index.html", "/real_time_face_landmark_liveness_tracker.html", "/login.html",
                 "/admin-login.html", "/admin.html", "/account.html"}
        if relative not in pages and not relative.startswith("/assets/"):
            self.send_error(HTTPStatus.NOT_FOUND)
            return None
        # Static hosting must never expose face data or SQLite sidecar files.
        requested = Path(self.translate_path(self.path)).resolve()
        asset_root = (Path(self.directory) / "assets").resolve()
        if relative.startswith("/assets/") and (
                not requested.is_relative_to(asset_root)
                or requested.suffix.lower() not in {".js", ".css", ".png", ".jpg", ".svg", ".ico", ".woff", ".woff2"}):
            self.send_error(HTTPStatus.NOT_FOUND)
            return None
        sqlite_path = getattr(face_database, "path", DATABASE_FILE).resolve()
        protected = {sqlite_path, DATABASE_FILE.resolve(), LEGACY_DATABASE_FILE.resolve(), BASE_DIR / CONFIG_NAME}
        protected.update(Path(str(sqlite_path) + suffix) for suffix in ("-wal", "-shm", "-journal"))
        private_suffixes = (".sqlite3", ".sqlite3-wal", ".sqlite3-shm", ".sqlite3-journal", ".bak")
        if (requested in protected or requested.name.lower() in (CONFIG_NAME, "database.local.tmp")
                or requested.name.lower().endswith(private_suffixes)
                or any(part.lower() == "backups" for part in requested.parts)):
            self.send_error(HTTPStatus.NOT_FOUND)
            return None
        return super().send_head()

    @property
    def auth(self):
        return AuthStore(face_database)

    @property
    def session(self):
        if not hasattr(self, "_current_session"):
            cookie = SimpleCookie()
            try:
                cookie.load(self.headers.get("Cookie", ""))
            except CookieError:
                pass
            token = cookie[COOKIE_NAME].value if COOKIE_NAME in cookie else None
            self._current_session = self.auth.session(token)
        return self._current_session

    def require_session(self, role=None, allow_password_change=False):
        session = self.session
        if not session:
            raise AuthError("Vui lòng đăng nhập.", 401)
        if role and session["role"] != role:
            raise AuthError("Bạn không có quyền thực hiện thao tác này.", 403)
        if session["must_change_password"] and not allow_password_change:
            raise AuthError("Bạn cần đổi mật khẩu trước khi sử dụng.", 403)
        return session

    def require_csrf(self):
        token = self.headers.get("X-CSRF-Token", "")
        if not self.session or not secrets.compare_digest(token, self.session["csrf_token"]):
            raise AuthError("Phiên thao tác không hợp lệ. Vui lòng tải lại trang.", 403)

    def check_origin(self):
        origin = self.headers.get("Origin")
        if origin and (urlsplit(origin).scheme not in ("http", "https") or urlsplit(origin).netloc != self.headers.get("Host")):
            raise AuthError("Nguồn yêu cầu không hợp lệ.", 403)

    @staticmethod
    def session_cookie(token="", clear=False):
        secure = "; Secure" if os.environ.get("FACE_COOKIE_SECURE", "").lower() in ("true", "1") else ""
        return f"{COOKIE_NAME}={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={0 if clear else SESSION_SECONDS}{secure}"

    @staticmethod
    def public_session(session):
        return {key: session[key] for key in ("id", "username", "display_name", "role", "must_change_password")}

    def challenge_engine(self):
        session = self.require_session()
        with global_challenge_lock:
            for key in [k for k, entry in challenge_engines.items() if entry[0] <= time.time()]:
                del challenge_engines[key]
            if session["token_hash"] not in challenge_engines:
                challenge_engines[session["token_hash"]] = (session["expires_at"], LivenessChallengeEngine())
            return challenge_engines[session["token_hash"]][1]

    def redirect(self, target):
        self.send_response(303)
        self.send_header("Location", target)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def do_GET(self):
        self._dispatch(self._handle_get)

    def _handle_get(self):
        """Điều hướng yêu cầu GET (API hoặc file HTML tĩnh)."""
        path = unquote(urlsplit(self.path).path)

        if path == "/api/status":
            counts = face_database.counts()
            self._send_json({
                "status": "online",
                "backend": "Python 3 Native Architecture",
                "registered_faces_count": counts["people"],
                "registered_samples_count": counts["samples"],
                "database": face_database.backend,
                "feature_version": FEATURE_VERSION,
                "liveness_challenge_active": False
            })
            return

        elif path == "/api/faces":
            faces_summary = self.auth.people(self.require_session())
            self._send_json({"faces": faces_summary, "total": len(faces_summary)})
            return

        elif path == "/api/auth/me":
            self._send_json({"authenticated": bool(self.session),
                             "account": self.public_session(self.session) if self.session else None,
                             "csrf_token": self.session["csrf_token"] if self.session else None})
            return

        elif path.startswith("/api/admin/"):
            self.require_session("admin")
            if path == "/api/admin/accounts":
                self._send_json({"accounts": self.auth.admin_accounts()})
            elif path.startswith("/api/admin/accounts/"):
                self._send_json(self.auth.account_detail(unquote(path.removeprefix("/api/admin/accounts/"))))
            elif path == "/api/admin/people":
                self._send_json({"people": self.auth.admin_people()})
            elif path == "/api/admin/audit":
                self._send_json({"events": self.auth.logs(), "storage": {
                    "backend": face_database.backend,
                    "table": "dbo.audit_logs" if face_database.backend == "sqlserver" else "audit_logs"
                }})
            elif path.startswith("/api/admin/people/"):
                self._send_json(self.auth.person_detail(unquote(path.removeprefix("/api/admin/people/"))))
            else:
                raise AuthError("Không tìm thấy API.", 404)
            return

        if path in ("/", "/index.html", "/real_time_face_landmark_liveness_tracker.html", "/admin.html", "/account.html"):
            if not self.session:
                self.redirect("/admin-login.html" if path == "/admin.html" else "/login.html")
                return
            if path == "/admin.html" and self.session["role"] != "admin":
                raise AuthError("Trang này dành cho admin.", 403)
            if self.session["must_change_password"] and path != "/account.html":
                self.redirect("/account.html")
                return

        if path == "/" or path == "/index.html":
            # Điều hướng trang chủ mặc định sang giao diện web
            self.path = "/real_time_face_landmark_liveness_tracker.html"

        return super().do_GET()

    def do_POST(self):
        self._dispatch(self._handle_post)

    def _handle_post(self):
        """Điều hướng yêu cầu POST API."""
        path = self.path.split("?")[0]
        self.check_origin()
        if self.headers.get("Content-Type", "").split(";")[0].strip() != "application/json":
            raise AuthError("Yêu cầu phải dùng JSON.", 415)

        try:
            payload = self._read_json_body()
        except Exception as e:
            self._send_json({"error": f"Invalid JSON payload: {str(e)}"}, 400)
            return

        if path in ("/api/auth/admin/login", "/api/auth/user/login", "/api/auth/register"):
            login_limiter.check(self.client_address[0])
            if path == "/api/auth/register":
                if "role" in payload:
                    raise AuthError("Không được tự chọn quyền tài khoản.")
                account = self.auth.create_account(payload.get("username"), payload.get("display_name"), payload.get("password"))
                self._send_json({"success": True, "account": account}, 201)
            else:
                role = "admin" if path == "/api/auth/admin/login" else "user"
                token, session = self.auth.login(payload.get("username"), payload.get("password"), role)
                self._send_json({"success": True, "account": self.public_session(session), "csrf_token": session["csrf_token"]},
                                cookie=self.session_cookie(token))
            return

        session = self.require_session(allow_password_change=path in ("/api/auth/logout", "/api/auth/password"))
        self.require_csrf()
        if path == "/api/auth/logout":
            self.auth.logout(session)
            with global_challenge_lock:
                challenge_engines.pop(session["token_hash"], None)
            self._send_json({"success": True}, cookie=self.session_cookie(clear=True))
            return
        if path == "/api/auth/password":
            self.auth.change_password(session, payload.get("current_password"), payload.get("new_password"))
            self._send_json({"success": True}, cookie=self.session_cookie(clear=True))
            return
        if path.startswith("/api/admin/"):
            self.require_session("admin")
            if "role" in payload:
                raise AuthError("Không được thay đổi quyền tài khoản qua thao tác này.")
            if path == "/api/admin/accounts":
                password = payload.get("temporary_password")
                password = secrets.token_urlsafe(18) if password in (None, "") else self.auth.password(password)
                account = self.auth.create_account(payload.get("username"), payload.get("display_name"), password,
                                                   force_change=True, actor_id=session["id"])
                self._send_json({"success": True, "account": account, "temporary_password": password}, 201)
                return
            if path.startswith("/api/admin/accounts/") and path.endswith("/reset-password"):
                identifier = unquote(path[len("/api/admin/accounts/"):-len("/reset-password")])
                password = self.auth.reset_user_password(session["id"], identifier, payload.get("temporary_password"))
                self._send_json({"success": True, "temporary_password": password})
                return
            elif path.startswith("/api/admin/accounts/") and path.endswith("/profile"):
                identifier = unquote(path[len("/api/admin/accounts/"):-len("/profile")])
                self.auth.update_account(session["id"], identifier, payload.get("username"), payload.get("display_name"))
            elif path.startswith("/api/admin/accounts/") and path.endswith("/sessions/revoke"):
                identifier = unquote(path[len("/api/admin/accounts/"):-len("/sessions/revoke")])
                self.auth.revoke_user_sessions(session["id"], identifier)
            elif path.startswith("/api/admin/accounts/") and path.endswith("/status"):
                identifier = unquote(path[len("/api/admin/accounts/"):-len("/status")])
                self.auth.set_active(session["id"], identifier, payload.get("is_active"))
            elif path.startswith("/api/admin/people/"):
                identifier = unquote(path.removeprefix("/api/admin/people/"))
                self.auth.update_person(session["id"], identifier, payload.get("name"), payload.get("account_id"))
            else:
                raise AuthError("Không tìm thấy API.", 404)
            self._send_json({"success": True})
            return

        # 1. API Xử lý Landmark từ Camera Client
        if path == "/api/process":
            landmarks_raw = payload.get("landmarks", [])
            use_challenge = payload.get("check_challenge", True)
            
            points = validate_landmarks(landmarks_raw)
            engine = self.challenge_engine() if use_challenge else None
            registered = face_database.matching_faces()
            if session["role"] != "admin":
                allowed = self.auth.owned_ids(session["id"])
                registered = [person for person in registered if person["id"] in allowed]
            with global_challenge_lock:
                result = analyze_frame_landmarks(
                    landmarks_data=landmarks_raw,
                    registered_db=registered,
                    challenge_engine=engine,
                    validated_points=points
                )
            self._send_json(result)

        # 2. API Đăng ký khuôn mặt mới
        elif path == "/api/register":
            name = payload.get("name", "")
            landmarks_raw = payload.get("landmarks", [])
            points = validate_landmarks(landmarks_raw)
            vector = extract_face_feature_vector(points)
            if payload.get("user_id"):
                self.auth.require_person(session, payload["user_id"])
            try:
                user = face_database.register(
                    name, vector, person_id=payload.get("user_id"),
                    landmark_count=len(landmarks_raw),
                    owner_account_id=session["id"] if not payload.get("user_id") else None,
                    actor_id=session["id"],
                    access_account_id=session["id"] if session["role"] != "admin" else None
                )
            except KeyError:
                self._send_json({"success": False, "message": "Không tìm thấy người dùng để thêm mẫu."}, 404)
                return
            self._send_json({
                "success": True,
                "message": f"Đã lưu khuôn mặt cho {user['name']}",
                "user": user
            })

        # 3. API Bắt đầu chuỗi Thách Thức Liveness
        elif path == "/api/challenge/start":
            with global_challenge_lock:
                engine = self.challenge_engine()
                engine.start()
                state = engine.get_state()
            self._send_json({"success": True, "state": state})

        # 4. API Reset Thách Thức Liveness
        elif path == "/api/challenge/reset":
            with global_challenge_lock:
                engine = self.challenge_engine()
                engine.reset()
                state = engine.get_state()
            self._send_json({"success": True, "state": state})

        # 5. API Phân Tích Toàn Diện Khuôn Mặt (Hỗ trợ cả 1 ảnh hoặc Hệ 2 lần chụp: Chính diện + Góc nghiêng)
        elif path == "/api/analyze_face":
            w = int(payload.get("width", 640))
            h = int(payload.get("height", 480))

            # Trường hợp 1: Chụp 2 lần (Multi-View: Frontal + Profile)
            if "frontal" in payload and "profile" in payload:
                frontal_data = payload.get("frontal", {})
                profile_data = payload.get("profile", {})
                
                f_img = frontal_data.get("image", "")
                f_lm = frontal_data.get("landmarks", [])
                p_img = profile_data.get("image", "")
                p_lm = profile_data.get("landmarks", [])

                if not f_img or not f_lm or len(f_lm) < 468:
                    self._send_json({"success": False, "error": "Thiếu dữ liệu ảnh chính diện hoặc không đủ điểm mốc"}, 400)
                    return

                try:
                    result = run_multi_view_face_analysis(
                        frontal_b64=f_img,
                        frontal_landmarks=f_lm,
                        profile_b64=p_img,
                        profile_landmarks=p_lm,
                        img_width=w,
                        img_height=h
                    )
                    self._send_json(result)
                except Exception as e:
                    traceback.print_exc()
                    self._send_json({"success": False, "error": f"Lỗi phân tích đa chiều: {str(e)}"}, 500)
                return

            # Trường hợp 2: Single-View (Tương thích ngược)
            image_b64 = payload.get("image", "")
            landmarks_raw = payload.get("landmarks", [])

            if not image_b64:
                self._send_json({"success": False, "error": "Thiếu dữ liệu hình ảnh (Base64)"}, 400)
                return

            if not landmarks_raw or len(landmarks_raw) < 468:
                self._send_json({"success": False, "error": "Thiếu dữ liệu điểm mốc (landmarks)"}, 400)
                return

            try:
                result = run_comprehensive_face_analysis(
                    image_base64=image_b64,
                    landmarks_data=landmarks_raw,
                    img_width=w,
                    img_height=h
                )
                self._send_json(result)
            except Exception as e:
                traceback.print_exc()
                self._send_json({"success": False, "error": f"Lỗi nội bộ server: {str(e)}"}, 500)

        else:
            self._send_json({"error": "Endpoint not found"}, 404)

    def do_DELETE(self):
        self._dispatch(self._handle_delete)

    def _handle_delete(self):
        self.check_origin()
        session = self.require_session()
        self.require_csrf()
        path = self.path.split("?")[0]
        if path != "/api/faces":
            self._send_json({"error": "Endpoint not found"}, 404)
            return
        payload = self._read_json_body()
        if "id" in payload:
            self.auth.require_person(session, payload["id"])
            if not face_database.delete_person(payload["id"], actor_id=session["id"],
                                               access_account_id=session["id"] if session["role"] != "admin" else None):
                self._send_json({"success": False, "message": "Không tìm thấy người dùng."}, 404)
                return
            message = "Đã xóa người dùng và các mẫu khuôn mặt."
        elif payload == {}:
            self.require_session("admin")
            face_database.clear(actor_id=session["id"])
            message = "Đã xóa toàn bộ dữ liệu khuôn mặt."
        else:
            raise ValueError("Expected a person ID or an empty object to clear the database")
        self._send_json({"success": True, "message": message})


def run_server():
    load_database()
    server_address = (HOST, PORT)
    handler = partial(VisionFaceRequestHandler, directory=str(BASE_DIR))
    httpd = VisionFaceHTTPServer(server_address, handler)
    print("=" * 65)
    print(f"🚀 VisionFace AI Server đang chạy tại: http://localhost:{PORT}")
    print(f"📡 API Endpoint phân tích: http://localhost:{PORT}/api/process")
    print(f"💻 Giao diện trực quan: http://localhost:{PORT}/real_time_face_landmark_liveness_tracker.html")
    print("=" * 65)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[Server] Đang tắt máy chủ...")
    finally:
        httpd.server_close()
        print("[Server] Đã dừng hoàn toàn.")


if __name__ == "__main__":
    run_server()
