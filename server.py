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
import traceback

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
from typing import Dict, Any
from face_store import FEATURE_VERSION, StorageError
from database_config import CONFIG_NAME, create_store

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
global_challenge_engine = LivenessChallengeEngine()
global_challenge_lock = threading.RLock()


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
        """Thêm headers CORS cho mọi phản hồi để trình duyệt kết nối dễ dàng."""
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        super().end_headers()

    def do_OPTIONS(self):
        """Xử lý pre-flight request của CORS."""
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def _send_json(self, data: Any, status_code: int = 200):
        """Gửi dữ liệu JSON về client."""
        response_bytes = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(response_bytes)))
        self.end_headers()
        self.wfile.write(response_bytes)

    def _read_json_body(self) -> Dict[str, Any]:
        """Đọc và parse payload JSON từ client."""
        content_length = int(self.headers.get("Content-Length", 0))
        if content_length < 0:
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
        except (sqlite3.Error, StorageError) as error:
            print(f"[Database] {type(error).__name__}: {error}")
            self._send_json({"success": False, "message": "Không thể truy cập database. Thao tác chưa được xác nhận."}, 500)
        except (ValueError, TypeError) as error:
            self._send_json({"success": False, "message": str(error)}, 400)

    def send_head(self):
        # Static hosting must never expose face data or SQLite sidecar files.
        requested = Path(self.translate_path(self.path)).resolve()
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

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def do_GET(self):
        self._dispatch(self._handle_get)

    def _handle_get(self):
        """Điều hướng yêu cầu GET (API hoặc file HTML tĩnh)."""
        path = self.path.split("?")[0]

        if path == "/api/status":
            counts = face_database.counts()
            self._send_json({
                "status": "online",
                "backend": "Python 3 Native Architecture",
                "registered_faces_count": counts["people"],
                "registered_samples_count": counts["samples"],
                "database": face_database.backend,
                "feature_version": FEATURE_VERSION,
                "liveness_challenge_active": global_challenge_engine.is_active
            })
            return

        elif path == "/api/faces":
            faces_summary = face_database.list_people()
            self._send_json({"faces": faces_summary, "total": len(faces_summary)})
            return

        elif path == "/" or path == "/index.html":
            # Điều hướng trang chủ mặc định sang giao diện web
            self.path = "/real_time_face_landmark_liveness_tracker.html"

        return super().do_GET()

    def do_POST(self):
        self._dispatch(self._handle_post)

    def _handle_post(self):
        """Điều hướng yêu cầu POST API."""
        path = self.path.split("?")[0]

        try:
            payload = self._read_json_body()
        except Exception as e:
            self._send_json({"error": f"Invalid JSON payload: {str(e)}"}, 400)
            return

        # 1. API Xử lý Landmark từ Camera Client
        if path == "/api/process":
            landmarks_raw = payload.get("landmarks", [])
            use_challenge = payload.get("check_challenge", True)
            
            points = validate_landmarks(landmarks_raw)
            engine = global_challenge_engine if use_challenge else None
            registered = face_database.matching_faces()
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
            try:
                user = face_database.register(
                    name, vector, person_id=payload.get("user_id"),
                    landmark_count=len(landmarks_raw)
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
                global_challenge_engine.start()
                state = global_challenge_engine.get_state()
            self._send_json({"success": True, "state": state})

        # 4. API Reset Thách Thức Liveness
        elif path == "/api/challenge/reset":
            with global_challenge_lock:
                global_challenge_engine.reset()
                state = global_challenge_engine.get_state()
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
        path = self.path.split("?")[0]
        if path != "/api/faces":
            self._send_json({"error": "Endpoint not found"}, 404)
            return
        payload = self._read_json_body()
        if "id" in payload:
            if not face_database.delete_person(payload["id"]):
                self._send_json({"success": False, "message": "Không tìm thấy người dùng."}, 404)
                return
            message = "Đã xóa người dùng và các mẫu khuôn mặt."
        elif payload == {}:
            face_database.clear()
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
