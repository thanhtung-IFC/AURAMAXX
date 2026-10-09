# Database khuôn mặt

Backend hiện hỗ trợ cả SQLite và SQL Server. Khi `database.local.json` chọn `sqlserver`, xem [DATABASE_SQLSERVER.md](DATABASE_SQLSERVER.md) để chạy và quản lý database hiện tại. Phần bên dưới mô tả chế độ SQLite và dữ liệu nguồn trước khi chuyển.

Backend dùng SQLite qua thư viện chuẩn Python, không cần cài thêm database server.
Tệp mặc định là `face_database.sqlite3`, nằm cạnh `server.py`.

## Chuyển dữ liệu cũ

Khi khởi động `server.py`, backend tạo schema và nhập `face_database.json` một lần.
ID, tên, vector và giờ đăng ký cũ được giữ lại. Tệp JSON không bị sửa hoặc xóa.
Dấu mốc chuyển dữ liệu được lưu trong SQLite: xóa người dùng sau này sẽ không khiến
người đó bị nhập lại từ JSON ở lần khởi động tiếp theo.

Nếu JSON sai cấu trúc, có ID trùng, vector không đủ 60 số hoặc chứa NaN/Infinity,
server báo lỗi và dừng khởi động. Không bỏ qua dữ liệu lỗi hoặc tự xóa database.
Sửa bản JSON rồi khởi động lại để thử chuyển dữ liệu lần nữa.

## Cấu trúc và cách dùng

- `people`: ID, tên, thời điểm tạo theo UTC và giờ hiển thị tương thích giao diện cũ.
- `face_samples`: nhiều vector cho mỗi người, phiên bản đặc trưng, số điểm mốc và thời điểm tạo.
- `metadata`: phiên bản dữ liệu dùng cho cache và dấu mốc nhập JSON.
- Phiên bản schema nằm trong `PRAGMA user_version`; hiện là `1`.

Tên giống nhau không tự gộp thành một người. ID mới dùng UUID.
Một vector giống hệt đã có của cùng người và cùng phiên bản không được lưu lặp.
Xóa người dùng sẽ xóa toàn bộ mẫu của người đó trong cùng giao dịch.
Nhận dạng chỉ đọc vector của phiên bản `geometric-v1`, kích thước 60 số.
Database lưu các mẫu hình học; thay đổi này không thay mô hình nhận dạng hoặc ngưỡng so khớp.

Trên web, khi Python online:

1. Nhập tên rồi bấm đăng ký để tạo người mới.
2. Đứng trước camera và bấm `+ Mẫu` ở dòng người đã đăng ký để thêm mẫu cho đúng ID.
3. Danh sách hiển thị số người và số mẫu. API lỗi sẽ không được báo là lưu/xóa thành công.

Chế độ JavaScript trên trang tĩnh vẫn dùng LocalStorage riêng của trình duyệt;
dữ liệu đó không tự chuyển vào SQLite. SQLite nhập tệp JSON của backend.

## API tương thích

- `GET /api/faces`: danh sách người, không có vector; có thêm `created_at`, `sample_count`.
- `GET /api/status`: có thêm `database`, `registered_samples_count`, `feature_version`.
- `POST /api/register`: `{ "name": "Tên", "landmarks": [...] }` tạo người mới.
- Thêm `"user_id": "ID đã có"` vào yêu cầu đăng ký để thêm mẫu; tên phải khớp người đã chọn.
- `POST /api/process`: nhận dạng qua toàn bộ mẫu tương thích, trả về ID người gần nhất như trước.
- `DELETE /api/faces`: `{ "id": "ID" }` xóa một người; `{}` xóa tất cả.

Tham số không hợp lệ trả HTTP 400; ID không tồn tại trả 404; lỗi SQLite trả 500.
Các tệp database và JSON cũ không được tải trực tiếp qua HTTP GET/HEAD.

## Lưu trữ và sao lưu

Để sao lưu thủ công, dừng server rồi sao chép `face_database.sqlite3` sang nơi lưu trữ riêng.
Khôi phục bằng cách dừng server và thay tệp SQLite bằng bản sao lưu phù hợp phiên bản schema.
Không đưa database vào Git; các tệp SQLite và journal đã được thêm vào `.gitignore`.

Có thể đặt đường dẫn tuyệt đối bằng biến `FACE_DATABASE_PATH`, ví dụ PowerShell:

```powershell
$env:FACE_DATABASE_PATH = 'D:\visionface-data\faces.sqlite3'
.\.venv\Scripts\python.exe server.py
```

Khi triển khai cloud, đặt đường dẫn trên ổ lưu trữ bền vững được gắn vào dịch vụ.
Tệp trên filesystem tạm của container có thể mất khi triển khai lại; SQLite không tự giải quyết điều đó.

## Kiểm tra

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p 'test_*.py'
node tests\check_web.cjs
node tests\check_profile_capture.cjs
node tests\check_database_ui.cjs
```
