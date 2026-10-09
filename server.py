"""
Server: server.py
Mô tả: HTTP REST API Server & Web Host phục vụ thuật toán nhận diện và Liveness của VisionFace.
Sử dụng thư viện chuẩn của Python (Zero External Dependencies) - chạy trực tiếp không cần cài đặt thêm.
Chạy: py server.py
Truy cập: http://localhost:8000
"""

import json
import os
import sys

# Đảm bảo mã hóa UTF-8 cho stdout/stderr trên Windows
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

from http import HTTPStatus
from http.server import HTTPServer, SimpleHTTPRequestHandler
from typing import Dict, Any, List

from face_liveness_algorithms import (
    LandmarkPoint,
    calculate_ear,
    calculate_mar,
    calculate_head_pose,
    extract_face_feature_vector,
    compare_face_vectors,
    LivenessChallengeEngine,
    analyze_frame_landmarks
)
from face_aesthetic_analyzer import (
    run_comprehensive_face_analysis,
    run_multi_view_face_analysis
)

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", 8000))
DATABASE_FILE = "face_database.json"

# Biến toàn cục quản lý Database và Liveness Engine
registered_faces: List[Dict[str, Any]] = []
global_challenge_engine = LivenessChallengeEngine()


def load_database():
    """Tải cơ sở dữ liệu khuôn mặt từ tệp JSON."""
    global registered_faces
    if os.path.exists(DATABASE_FILE):
        try:
            with open(DATABASE_FILE, "r", encoding="utf-8") as f:
                registered_faces = json.load(f)
            print(f"[Database] Đã tải {len(registered_faces)} mẫu khuôn mặt từ {DATABASE_FILE}")
        except Exception as e:
            print(f"[Database] Lỗi khi đọc tệp {DATABASE_FILE}: {e}")
            registered_faces = []
    else:
        registered_faces = []
        save_database()


def save_database():
    """Lưu cơ sở dữ liệu khuôn mặt xuống tệp JSON."""
    try:
        with open(DATABASE_FILE, "w", encoding="utf-8") as f:
            json.dump(registered_faces, f, ensure_ascii=False, indent=2)
        print(f"[Database] Đã lưu {len(registered_faces)} mẫu khuôn mặt vào {DATABASE_FILE}")
    except Exception as e:
        print(f"[Database] Lỗi khi ghi tệp {DATABASE_FILE}: {e}")


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
        if content_length <= 0:
            return {}
        body = self.rfile.read(content_length).decode("utf-8")
        return json.loads(body)

    def do_GET(self):
        """Điều hướng yêu cầu GET (API hoặc file HTML tĩnh)."""
        path = self.path.split("?")[0]

        if path == "/api/status":
            self._send_json({
                "status": "online",
                "backend": "Python 3 Native Architecture",
                "registered_faces_count": len(registered_faces),
                "liveness_challenge_active": global_challenge_engine.is_active
            })
            return

        elif path == "/api/faces":
            # Trả về danh sách khuôn mặt (ẩn vector để giảm băng thông nếu cần)
            faces_summary = [
                {"id": f.get("id"), "name": f.get("name"), "date": f.get("date")}
                for f in registered_faces
            ]
            self._send_json({"faces": faces_summary, "total": len(registered_faces)})
            return

        elif path == "/" or path == "/index.html":
            # Điều hướng trang chủ mặc định sang giao diện web
            self.path = "/real_time_face_landmark_liveness_tracker.html"

        return super().do_GET()

    def do_POST(self):
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
            
            engine = global_challenge_engine if use_challenge else None
            result = analyze_frame_landmarks(
                landmarks_data=landmarks_raw,
                registered_db=registered_faces,
                challenge_engine=engine
            )
            self._send_json(result)

        # 2. API Đăng ký khuôn mặt mới
        elif path == "/api/register":
            name = payload.get("name", "").strip()
            landmarks_raw = payload.get("landmarks", [])

            if not name:
                self._send_json({"success": False, "message": "Tên không được để trống"}, 400)
                return

            if not landmarks_raw or len(landmarks_raw) < 468:
                self._send_json({"success": False, "message": "Thiếu dữ liệu landmarks khuôn mặt"}, 400)
                return

            points = [LandmarkPoint(p.get("x", 0), p.get("y", 0), p.get("z", 0)) for p in landmarks_raw]
            vector = extract_face_feature_vector(points)

            import time
            new_user = {
                "id": f"usr_{int(time.time() * 1000)}",
                "name": name,
                "vector": vector,
                "date": time.strftime("%H:%M:%S")
            }
            registered_faces.append(new_user)
            save_database()

            self._send_json({
                "success": True,
                "message": f"Đã đăng ký thành công cho {name}",
                "user": {"id": new_user["id"], "name": name, "date": new_user["date"]}
            })

        # 3. API Bắt đầu chuỗi Thách Thức Liveness
        elif path == "/api/challenge/start":
            global_challenge_engine.start()
            self._send_json({
                "success": True,
                "state": global_challenge_engine.get_state()
            })

        # 4. API Reset Thách Thức Liveness
        elif path == "/api/challenge/reset":
            global_challenge_engine.reset()
            self._send_json({
                "success": True,
                "state": global_challenge_engine.get_state()
            })

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
                    import traceback
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
                import traceback
                traceback.print_exc()
                self._send_json({"success": False, "error": f"Lỗi nội bộ server: {str(e)}"}, 500)

        else:
            self._send_json({"error": "Endpoint not found"}, 404)

    def do_DELETE(self):
        """Xử lý yêu cầu xóa khuôn mặt."""
        path = self.path.split("?")[0]
        if path == "/api/faces":
            payload = self._read_json_body()
            user_id = payload.get("id")

            global registered_faces
            if user_id:
                registered_faces = [f for f in registered_faces if f.get("id") != user_id]
                save_database()
                self._send_json({"success": True, "message": f"Đã xóa người dùng {user_id}"})
            else:
                # Xóa toàn bộ
                registered_faces = []
                save_database()
                self._send_json({"success": True, "message": "Đã xóa toàn bộ dữ liệu khuôn mặt"})
        else:
            self._send_json({"error": "Endpoint not found"}, 404)


def run_server():
    load_database()
    server_address = (HOST, PORT)
    httpd = HTTPServer(server_address, VisionFaceRequestHandler)
    print("=" * 65)
    print(f"🚀 VisionFace AI Server đang chạy tại: http://localhost:{PORT}")
    print(f"📡 API Endpoint phân tích: http://localhost:{PORT}/api/process")
    print(f"💻 Giao diện trực quan: http://localhost:{PORT}/real_time_face_landmark_liveness_tracker.html")
    print("=" * 65)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[Server] Đang tắt máy chủ...")
        httpd.server_close()
        print("[Server] Đã dừng hoàn toàn.")


if __name__ == "__main__":
    run_server()
