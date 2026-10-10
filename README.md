# 🌟 VisionFace Pro - AI Facial Biometrics & Aesthetic Diagnostic System

Hệ thống nhận diện khuôn mặt thời gian thực, kiểm tra thực thể sống (**Liveness Verification Anti-Spoofing**), và chẩn đoán định lượng thẩm mỹ nhân trắc học (**Anthropometric Aesthetic Engine**) đạt chuẩn khoa học khách quan (không nịnh nọt).

Hệ thống hoạt động theo kiến trúc **Hybrid**:
- **Trình duyệt** chạy MediaPipe Face Mesh, lấy điểm mốc từ camera và hiển thị kết quả.
- **Python Backend (REST API)** phục vụ đăng nhập, phân quyền, nhận diện, phân tích nâng cao và kết nối database. Bản online cần backend; xem hướng dẫn Render + Supabase bên dưới về cấu hình và giới hạn gói Free.

---

## 🚀 Các Tính Năng Nổi Bật

1. **Tối Ưu Hóa Truy Cập Phần Cứng Camera Rời (USB Cam)**:
   - Tự động nhận diện webcam USB rời (`[USB Cam Ngoài]`) so với webcam laptop.
   - Cơ chế Fallback 4 cấp độ chống lỗi `OverconstrainedError` trên mọi thiết bị UVC (Logitech, OBS Cam, DroidCam,...).
   - Hỗ trợ rút/cắm nóng USB camera động (`devicechange` debouncing).
   - Giải phóng tài nguyên bất đồng bộ (250ms delay) chống lỗi khóa cổng DirectShow trên Windows.

2. **Chẩn Đoán Thẩm Mỹ & Nhân Trắc Học Khách Quan (Không Nịnh Nọt)**:
   - **Thang điểm Gauss (Gaussian Bell Curve)**: Điểm thực tế của người bình thường từ 60 - 75/100, loại bỏ hoàn toàn việc tâng bốc điểm ảo 90 - 95%.
   - **Độ Cân Đối Khuôn Mặt (Symmetry)**: Đo sai lệch pixel từng ngũ quan, góc nghiêng trục mắt (`Eye Level Tilt`), chỉ rõ bên lệch (thói quen nhai một bên / nằm nghiêng).
   - **Quy Tắc 3 Tầng (Rule of Thirds) & fWHR**: Đánh giá trán cao/dô, trán ngắn, cằm lẹm, cằm dài.
   - **Tỷ Lệ Mũi (Nose Analysis)**: Đo tỷ lệ cánh mũi so với khoảng cách hai hốc mắt trong, cảnh báo độ vẹo vách ngăn / lệch sống mũi.
   - **Đường Viền Hàm & Cằm (Jawline & Chin)**: Đo góc quai hàm Gonial (chuẩn 120°–130°), phân tích cằm lẹm, hàm bạnh vuông hay thon gọn.
   - **Chẩn Đoán Tình Trạng Da (Skin Health ROI)**: Quét pixel thực tế vùng má, trán và bọng mắt dưới để phát hiện quầng thâm mắt thực tế, bóng dầu chữ T và độ sần sùi lỗ chân lông.
   - **Tư Vấn Tạo Kiểu Tóc (Stylist Corrective Advice)**: Gợi ý kiểu tóc nam & nữ bù trừ khuyết điểm dáng mặt.

3. **Chống Gian Lận Thực Thể Sống (Anti-Spoofing Liveness)**:
   - Theo dõi chỉ số chớp mắt EAR (Eye Aspect Ratio).
   - Theo dõi khẩu độ há miệng MAR (Mouth Aspect Ratio).
   - Ước tính góc quay đầu 3D (Yaw, Pitch).
   - Thử thách ngẫu nhiên 3 bước chống ảnh in hoặc phát lại video.

---

## 🌐 Triển Khai Chạy 24/7 Không Phụ Thuộc Máy Tính Cá Nhân

### GitHub Pages
Bản có đăng nhập và phân quyền cần máy chủ Python phục vụ cả giao diện và API cùng origin. GitHub Pages chỉ phục vụ tệp tĩnh nên không chạy được tính năng tài khoản và database của bản này.

---

### Triển khai trên máy chủ riêng có HTTPS

Giao diện, backend Python và SQL Server chạy trên máy chủ riêng; GitHub dùng để lưu và cập nhật mã nguồn. Caddy nhận HTTPS và chuyển yêu cầu đến Python ở `127.0.0.1:8000`.

Xem [DEPLOYMENT.md](DEPLOYMENT.md) để triển khai trên máy chủ riêng. File `deploy/Caddyfile.example` là mẫu cấu hình HTTPS.

### Chạy thử với Render + Supabase PostgreSQL

Xem [SUPABASE_RENDER.md](SUPABASE_RENDER.md) để tạo Supabase, chuyển cả tài khoản/hồ sơ/nhật ký từ SQL Server, triển khai Render và sao lưu trước khi đóng web cuối tháng 10/2026. Render phục vụ cả giao diện và Python API trên cùng URL HTTPS; Supabase lưu dữ liệu. Cấu hình sẵn trong `render.yaml`, driver trong `requirements-postgres.txt`.

---

## 💻 Chạy Cục Bộ (Localhost Development)

Nếu muốn chạy trên máy tính cá nhân để thử nghiệm:

```bash
# 1. Cài đặt thư viện Python
pip install -r requirements.txt

# 2. Khởi chạy máy chủ AI Server
python server.py
```

Truy cập trên trình duyệt: `http://localhost:8000`

Web yêu cầu đăng nhập. Xem [AUTHENTICATION.md](AUTHENTICATION.md) để tạo admin lần đầu, đăng ký tài khoản người dùng và quản lý từng hồ sơ. Admin đăng nhập tại `/admin-login.html`; người dùng tại `/login.html`.

## Cấu trúc mã nguồn

Chatbot tư vấn AI dùng Gemini: xem [GEMINI_CHAT.md](GEMINI_CHAT.md) để đặt khóa
API trên backend và sử dụng khung chat với kết quả phân tích gần nhất.

- `index.html` và `real_time_face_landmark_liveness_tracker.html`: hai địa chỉ giao diện được giữ tương thích, cùng tải `assets/app.js` và `assets/app.css`. Khi sửa logic hoặc kiểu hiển thị, sửa các file trong `assets/`.
- `server.py`: HTTP API và phục vụ giao diện.
- `auth_store.py`, `manage_accounts.py`: tài khoản, phiên, quyền sở hữu hồ sơ và tạo/khôi phục admin; `admin.html` là trang quản trị.
- `face_liveness_algorithms.py`: thuật toán đặc trưng khuôn mặt và liveness.
- `face_aesthetic_analyzer.py`: phân tích ảnh chính diện và góc nghiêng.
- `face_store.py`: lưu trữ SQLite; hướng dẫn sử dụng trong [DATABASE.md](DATABASE.md).
- `sql_server_store.py`, `database_config.py`: lưu trữ SQL Server và chọn backend; hướng dẫn trong [DATABASE_SQLSERVER.md](DATABASE_SQLSERVER.md).
- `manage_database.py`: tạo schema SQL Server, sao lưu và chuyển dữ liệu từ SQLite. `sql/inspect.sql` dùng để xem dữ liệu thật trong SSMS.
- Hai file thuật toán mang tên tiếng Việt là đường dẫn import tương thích, dùng lại module chính để tránh tồn tại thuật toán cũ khác phiên bản.
- `main_tracker.py`: ứng dụng desktop tùy chọn, độc lập với web; cài bằng `pip install -r requirements-desktop.txt`.

Khi triển khai, đưa cả thư mục `assets/` và các file HTML lên máy chủ Python.

Kiểm tra sau khi sửa code:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p 'test_*.py'
.\.venv\Scripts\python.exe -B tests/check_profile_backend.py
node tests/check_web.cjs
node tests/check_profile_capture.cjs
node tests/check_database_ui.cjs
```

