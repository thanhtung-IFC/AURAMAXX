# AURAMAXX — Website chính thức

## Truy cập

- **Ứng dụng AURAMAXX:** [Mở trang chính](https://visionface.onrender.com)
- **Video và hướng dẫn sử dụng:** [Mở trang hướng dẫn riêng](https://auramaxx-guide.onrender.com)

AURAMAXX là website chính thức; VisionFace là công nghệ được tích hợp trong các tính năng phân tích khuôn mặt.

Chatbot **AURA AI** hỗ trợ Gemini. Xem [AURA_AI.md](AURA_AI.md) để cấu hình
API, kiểm tra kết nối và sử dụng lịch sử hội thoại theo tài khoản.

Face Lab: xem [FACE_LAB.md](FACE_LAB.md) về luồng camera, điều kiện chụp và các kiểm thử phép đo.

Face Arena: xem [FACE_ARENA.md](FACE_ARENA.md) về luyện tập BOT, cách tính điểm/Elo,
lịch sử chi tiết và các kiểm tra giao diện.

Giao diện AURAMAXX là trang chính, kết hợp Face Lab, Face Arena/ELO, Health Hub,
Aura AI, tiến trình và tài khoản. **Face Lab tích hợp trực tiếp VisionFace**:
camera USB, nhận diện, liveness, hồ sơ, tải ảnh và phân tích chính diện/góc nghiêng
đều nằm trong giao diện AURAMAXX, sử dụng thuật toán Python gốc. Không còn khung
nhúng hoặc hai chế độ phân tích riêng. Báo cáo có đường đo và chi tiết da, tóc,
tỷ lệ; có thể chuyển số đo sang Aura AI để giải thích hoặc dùng trong routine ở Health Hub.

**Health Hub đã hợp nhất AI Routine Builder**: chọn mức độ, điều chỉnh theo phản
hồi, thêm từ thư viện, đọc hướng dẫn, đổi giờ và bỏ qua từng mục. Hoàn thành một
mục sẽ ghi vào cùng nhật ký Health Hub và tiến trình. Routine, chuỗi ngày và tối
đa 2 lượt bảo vệ mỗi tháng được lưu theo tài khoản trên Supabase, đồng bộ giữa
các thiết bị. Lựa chọn dùng số đo Face Lab chỉ lưu các chỉ số bề mặt da đã lọc;
ảnh và landmark không được lưu trong routine. Có thể tạo routine cơ bản trước
khi quét mặt. Bộ chọn routine dùng quy tắc mức độ/phản hồi của pull request,
không cần khóa của nhà cung cấp AI.

Chạy trên Windows: mở `start_auramaxx.bat`, hoặc:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-postgres.txt
.\.venv\Scripts\python.exe run_web.py
```

Mở **http://127.0.0.1:8000/** để vào ứng dụng chính. Trên Render, trang hướng dẫn từ
`guide-site/index.html` được triển khai thành Static Site riêng, dùng chung repository nhưng có
URL và lần triển khai tách biệt với web chính.
Website dùng PostgreSQL trên Supabase nên cần kết nối Internet. Không cần bật
SQL Server hoặc cấp quyền quản trị Windows. Nếu web đã chạy, tệp BAT mở lại trang.
Trong **My Aura**, chọn đăng nhập để mở lại **bố cục trang đăng nhập cũ** đã đổi
nhận diện AURAMAXX. Dùng email hoặc tên đăng nhập VisionFace hiện có; sau đăng
nhập sẽ quay về trang đang dùng. Bật các lựa chọn đồng ý cần dùng trong My Aura.
Đăng nhập quản trị riêng tại **http://127.0.0.1:8000/admin-login.html** bằng tên
đăng nhập hoặc email admin. Đăng nhập thành công mở thẳng `/manage`; tài khoản
người dùng bị chặn. Admin dùng mật khẩu tạm phải đổi mật khẩu rồi đăng nhập
lại. Trang quản trị có nút đăng xuất admin. `python server.py` cũng mở ứng dụng hợp nhất.

Cả dữ liệu AURAMAXX và VisionFace được lưu trong **một PostgreSQL trên
Supabase**. `DATABASE_URL` trong `.env` là kết nối chung. Mở
**http://127.0.0.1:8000/admin-login.html**, hoặc vào `/manage` để được chuyển đến
trang đăng nhập quản trị khi chưa có quyền.
Trang này quản lý tài khoản, hồ sơ, dữ liệu ứng dụng, nhật ký quản trị và bản sao lưu.
Phần quản trị web cũ đã được gỡ. Xem [OWNER_DATA.md](OWNER_DATA.md) để mở dữ liệu
trong Supabase và xem biên bản chuyển dữ liệu.

Muốn chạy bản SQLite riêng để phát triển:

```powershell
$env:FACE_DB_BACKEND="sqlite"
$env:AURAMAXX_DB_BACKEND="sqlite"
.\.venv\Scripts\python.exe run_web.py
```

Tài khoản/hồ sơ nằm trong schema `visionface`; Arena, nhật ký và hội thoại nằm
trong schema `public` của cùng database Supabase. Dữ liệu SQL Server đã được
sao lưu, nhập bổ sung và đối chiếu bằng checksum. Phiên cũ bị thu hồi nên cần
đăng nhập lại. Database SQL Server nguồn chỉ được giữ để khôi phục, không còn
được ứng dụng sử dụng. Tệp BAT không khởi động dịch vụ SQL Server.

**Giới hạn hiện tại:** đấu BOT và ELO luyện tập đã có; PvP xếp hạng vẫn bị khóa
cho đến khi có quy trình xác thực trận trên máy chủ. Aura AI cần cấu hình nhà
cung cấp AI phía máy chủ. Routine được tạo và theo dõi trong Health Hub; báo cáo chỉ được
đính kèm khi người dùng chọn gửi, không kèm ảnh/landmark. Xem [MERGE_NOTES.md](MERGE_NOTES.md) để biết kiến
trúc, cấu hình triển khai và các kiểm thử của bản hợp nhất.

---

# VisionFace Pro — tài liệu nguồn và các backend lịch sử

Phần bên dưới ghi lại công cụ nguồn. Cấu hình chạy hiện tại của website hợp
nhất là Supabase/PostgreSQL như phần trên; không áp dụng hướng dẫn SQL Server
cho bản đang dùng.

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

