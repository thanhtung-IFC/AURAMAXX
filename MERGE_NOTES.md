# AURAMAXX + VisionFace

> Dữ liệu hiện dùng duy nhất PostgreSQL trên Supabase cho cả hai phần.
> Trang quản trị chung là `/manage`; giao diện/API quản trị cũ đã gỡ.
> Xem [OWNER_DATA.md](OWNER_DATA.md) để biết cấu hình và bản sao hiện tại.
> Giao diện tích hợp và cấu hình Render được giữ nguyên.

## Kết quả phân tích và cách hợp nhất

Mã gốc dùng `server.py`, `assets/`, `AuthStore` và các database adapter để nhận
diện, kiểm tra liveness, lưu hồ sơ, phân tích ảnh nhiều góc và quản trị.
Mã bổ sung trong `frontend/` và `backend/` dùng FastAPI, cookie riêng và schema
riêng cho Arena, nhật ký, lựa chọn đồng ý và hội thoại.

Điểm vào thống nhất là `run_web.py` / `backend.main:app`. Trang `/` phục vụ
`frontend/index.html`. Face Lab dùng `face-lab-native.js` để trình bày trực tiếp
camera, liveness, hồ sơ, chụp đa góc, tải ảnh và báo cáo trong giao diện mới.
`/visionface.html` và đường dẫn tracker cũ chuyển về `/#face-lab`. Không còn
iframe hoặc bộ chấm điểm nhanh độc lập trong luồng người dùng.

`login.html` giữ bố cục journey/form của trang cũ, dùng `frontend/login.js` và
palette AURAMAXX. Email và tên đăng nhập cũ dùng chung `/api/auth/login`, một
phiên và CSRF token; quay về đường dẫn nội bộ sau đăng nhập.

Health Hub dùng giao diện AURAMAXX cùng thuật toán và thư viện của PR
`AI_Routine_Builder`. Lõi đã chuyển vào `backend/routines.py` và
`backend/routine_library.json`; lịch, mức độ/phản hồi, hoàn thành, bỏ qua, đổi
giờ, thêm từ thư viện và chuỗi ngày dùng một bản ghi `health_routines` theo
user. Dữ liệu được lưu trên Supabase; revision và khóa giao dịch ngăn hai thiết
bị ghi đè nhau. Việc hoàn thành và bản ghi nhật ký được commit cùng nhau; xóa
bản ghi routine trong nhật ký cũng bỏ trạng thái hoàn thành tương ứng. Đổi
ngày dùng giờ Việt Nam trên server; bảo vệ tối đa 2 ngày mỗi tháng và xử lý cả
khoảng nghỉ nhiều ngày. Các mục đã hoàn thành/thêm riêng được giữ khi đổi mức độ.

Nút routine ở Face Lab và Aura AI đều mở Health Hub. Dùng số đo là lựa chọn
chủ động, cần cả consent phân tích và lưu sức khỏe. Chỉ bốn chỉ số bề mặt da
được nhận, không nhận ảnh, landmark hoặc định danh. Thu hồi consent phân tích
xóa số đo khỏi routine; thu hồi lưu sức khỏe xóa routine/chuỗi. Bảng mới có RLS,
được xuất trong backup, quản lý trong `/manage`, và cascade khi xóa tài khoản.
Những nội dung hướng dẫn có cam kết thay đổi xương mặt hoặc suy luận sức khỏe
từ ảnh đã được đổi thành hướng dẫn tham khảo; mục mewing được đánh dấu tùy chọn.
Module `assets/daily.js` là nguồn lịch sử của PR, không được tải trong ứng dụng
hợp nhất. Không có trang hoặc tab Routine Builder riêng.

Aura AI nhận số đo báo cáo qua lựa chọn đính kèm để giải thích kết quả.
Bộ lọc báo cáo gốc loại bỏ
ảnh, điểm mốc và định danh; context được giới hạn trước khi gửi nhà cung cấp.
Chỉ câu hỏi và câu trả lời được lưu trong lịch sử, không lưu JSON báo cáo thô.

`backend/routers/vision.py` chuyển đầu vào/đầu ra HTTP của các handler gốc sang
FastAPI trong cùng tiến trình. Thuật toán, phân quyền sở hữu, database adapter
tiếp tục được dùng lại, không cần chạy máy chủ thứ hai. Công thức chụp/căn góc
được lấy từ controller cũ. Lỗi biến `gray_cheek` chưa khai báo trong phân tích
da được sửa bằng phép tính độ sáng vùng má hiện có, giữ công thức tính chỉ số.
Frontend gọi `/api/vision/*`, tránh trùng
`/api/auth/*` của ứng dụng chính. `/api/status` được giữ cho kiểm tra triển khai.

## Tài khoản và dữ liệu

- Email AURAMAXX mới: vẫn dùng scrypt. Một tài khoản nội bộ VisionFace được tạo
  khi đăng ký (hoặc đăng nhập lần đầu với tài khoản email có sẵn), và liên kết
  qua `legacy_account_links`; admin nhìn thấy tài khoản mới trong cùng danh sách.
- Tên đăng nhập cũ: xác thực bằng Argon2 và quyền hiện có; bản ghi AURAMAXX được
  liên kết với đúng ID cũ. Hồ sơ và quyền sở hữu không bị chuyển hoặc sao chép.
- Một cookie phiên HttpOnly và một CSRF token dùng cho tất cả tính năng.
  Đặt lại mật khẩu, khóa tài khoản và thu hồi phiên từ admin có hiệu lực ở cả
  hai phần. Tài khoản dùng mật khẩu tạm phải đổi trước khi sử dụng.
- Đổi mật khẩu từ My Aura cập nhật cả hai đường xác thực và thu hồi các phiên.
  Xóa tài khoản thường xóa dữ liệu AURAMAXX, tài khoản liên kết và hồ sơ thuộc
  tài khoản đó. Tài khoản admin không tự xóa qua luồng người dùng.
- Dữ liệu mới và cũ vẫn dùng các bộ lưu trữ đã cấu hình. Bảng liên kết chỉ lưu
  ID tài khoản và dấu kiểm tra phiên bản mật khẩu; không chứa mật khẩu gốc.

Điểm mốc được gửi để nhận diện/liveness, ảnh chỉ được gửi khi chọn phân tích,
và mẫu khuôn mặt chỉ được lưu khi người dùng chọn lưu hồ sơ. Camera dừng và
ảnh chụp bị xóa khỏi giao diện khi rời Face Lab. Số đo vẫn nằm trong bộ nhớ tab
để chuyển sang Aura AI; đăng xuất, thu hồi đồng ý hoặc xóa kết quả sẽ xóa số đo.

## Chạy và triển khai

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-postgres.txt
.\.venv\Scripts\python.exe run_web.py
```

`start_auramaxx.bat` dùng cùng cổng 8000. `server.py` khi chạy trực tiếp cũng
mở web hợp nhất; các lớp/handler gốc vẫn import được để kiểm thử hoặc tích hợp.
`HOST` và `PORT` thay đổi địa chỉ lắng nghe. Frontend mặc định gọi API cùng
origin; có thể đặt `window.AURAMAXX_API_BASE` cho môi trường phát triển riêng.

PostgreSQL: `DATABASE_URL` là kết nối Supabase Session pooler chung, cổng 5432,
TLS bắt buộc. `FACE_DB_BACKEND=postgres`, `AURAMAXX_DB_BACKEND=postgres`;
schema `visionface` cho tài khoản/mẫu và `public` cho dữ liệu AURAMAXX. Tệp BAT
không bật SQL Server hoặc yêu cầu UAC. Pool kết nối của hai bộ lưu trữ đều có
giới hạn; trigger làm mới cache được cố định search_path của schema VisionFace.

SQLite chỉ dùng cho kiểm thử/phát triển: đặt `FACE_DB_BACKEND=sqlite`; file hồ sơ mặc định là
`face_database.sqlite3`, file ứng dụng là `backend/data/auramaxx.sqlite3`.
`FACE_DATABASE_PATH` / `AURAMAXX_DB_PATH` có thể chọn file khác.

Render: `render_start.py` khởi động FastAPI, dùng `DATABASE_URL` PostgreSQL cho
VisionFace và mặc định cho AURAMAXX nếu chưa có `SUPABASE_DATABASE_URL`.
VisionFace dùng schema riêng như trước. Cookie HTTPS bắt buộc trong entry point
này. Nếu đã có dữ liệu AURAMAXX ở SQLite, dùng `backend.migrate_supabase` sau khi
sao lưu để chuyển vào database đích trống. Bảng liên kết được chuyển cùng dữ liệu;
database nguồn trước bản hợp nhất chưa có bảng này cũng được hỗ trợ.
Docker khởi động `run_web.py`. Khóa AI chỉ được cấu hình ở backend qua `.env`.

## Kiểm thử

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p 'test_*.py'
.\.venv\Scripts\python.exe -B tests/check_profile_backend.py
node tests/check_web.cjs
node tests/check_profile_capture.cjs
node tests/check_database_ui.cjs
node tests/check_chat_browser.cjs
node tests/check_pages_hosting.cjs
node tests/browser_unified_smoke.cjs
.\.venv\Scripts\python.exe -B -m unittest tests.test_health_hub tests.test_api
```

Các bài tích hợp dùng database tạm, không đụng dữ liệu người dùng. Browser smoke
test dùng Edge headless, trang đăng nhập gốc, theme chung, Face Lab trực tiếp,
đổi camera USB, liveness, lưu mẫu, chụp hai góc, tải ảnh, báo cáo từ Python gốc,
đấu BOT, routine và lựa chọn đính kèm cho AI. Cả bảy trang được kiểm tra ở độ
rộng điện thoại. Thiết bị/landmark và câu trả lời AI dùng fixture thử; ảnh nằm
trong `.test-output/`, được Git bỏ qua.

Đặt `$env:AURAMAXX_TEST_REAL_MEDIAPIPE='1'` trước browser smoke để tải SDK,
WASM và mô hình MediaPipe thật, chạy IMAGE inference trên canvas không có mặt
và đóng detector. Chế độ IMAGE/VIDEO theo [hướng dẫn Google](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).
Camera vật lý, dịch vụ AI trả phí và database từ xa cần kiểm tra với thiết
bị/cấu hình triển khai tương ứng. Kiểm thử PostgreSQL dùng hai schema UUID
riêng để xác minh cả app API và VisionFace trong cùng database; công cụ chuyển
dữ liệu kiểm tra xung đột và rollback trước khi đổi cấu hình đang hoạt động.

Arena giữ ELO luyện tập BOT tách khỏi PvP. Không tạo kết quả PvP hay điểm xếp
hạng từ dữ liệu chưa được máy chủ xác thực.
