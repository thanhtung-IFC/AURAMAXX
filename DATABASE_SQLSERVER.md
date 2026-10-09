# SQL Server cho VisionFace

Backend hỗ trợ SQLite và SQL Server. Web đã có tài khoản người dùng và admin; xem [AUTHENTICATION.md](AUTHENTICATION.md) để tạo admin, đăng nhập và gán hồ sơ khuôn mặt cho tài khoản.

## Cấu hình trên máy hiện tại

- SQL Server: `localhost\SQLEXPRESS`.
- Database ứng dụng: `VisionFaceDB`; độc lập với database bài tập `VisionFacePractice`.
- Xác thực: Windows Authentication, theo tài khoản chạy Python.
- Driver: ODBC Driver 18 for SQL Server + `pyodbc` trong `.venv`.
- `database.local.json`: chọn backend cho những lần khởi động sau; file này không đưa vào Git và không được tải qua HTTP.

Chạy backend:

```powershell
.\.venv\Scripts\python.exe server.py
```

Nếu đã có server chạy, dừng bằng Ctrl+C rồi chạy lại. Mở `http://localhost:8000/api/status`: trường `database` phải là `sqlserver`. Trên web, tải lại bằng Ctrl+F5 và chọn Python online để đăng ký vào SQL Server. Chế độ JavaScript offline vẫn dùng LocalStorage riêng.

Backend chỉ cho một tiến trình chiếm cổng trên Windows. Nếu chạy thêm bị báo cổng đang bận, kiểm tra API của server hiện có trước. Backend xử lý nhiều kết nối trình duyệt đồng thời để một kết nối đang chờ không chặn các yêu cầu trạng thái khác.

Không tự chuyển sang SQLite khi SQL Server bị lỗi, để tránh lưu dữ liệu nhầm nơi. Windows Authentication cho database không phải chức năng đăng nhập tài khoản của website.

## Xem dữ liệu thật bằng SSMS

1. Kết nối `localhost\SQLEXPRESS`, chọn Windows Authentication.
2. Mở `Databases → VisionFaceDB → Tables`. Nếu chưa thấy, Refresh.
3. `dbo.people`: hồ sơ người. `dbo.face_samples`: các mẫu khuôn mặt. `dbo.metadata`: phiên bản, revision và dấu mốc chuyển dữ liệu.
4. Mở file `sql/inspect.sql` trong SSMS hoặc chạy:

```sql
USE VisionFaceDB;
GO
SELECT p.id, p.name, COUNT(s.id) AS sample_count
FROM dbo.people AS p
LEFT JOIN dbo.face_samples AS s ON s.person_id = p.id
GROUP BY p.id, p.name;
```

Tên được lưu bằng NVARCHAR để giữ tiếng Việt. ID, thời gian UTC và vector được giữ khi chuyển. Vector có 60 số, không phải ảnh gốc.

Thêm người/mẫu và xóa hồ sơ qua web để backend kiểm tra dữ liệu. Trigger cập nhật revision khi hồ sơ hoặc mẫu thay đổi, kể cả đổi tên từ SSMS. Không tự sửa vector_json/vector_hash bằng tay: hash phục vụ chống lưu trùng.

## Thực hành thêm hồ sơ từ SQL

Mở `sql/demo_new_person.sql` trong SSMS và chạy toàn bộ bằng F5. Mặc định bài thử thêm mã `TEST_USER_001`, tên `Người dùng thử`, truy vấn kết quả rồi ROLLBACK. Không để lại hồ sơ thử trong database. Muốn lưu thật, thay mã/tên theo nhu cầu và đặt `@SaveChanges = 1`. Mã `id` phải duy nhất; tên được phép trùng. Đây là hồ sơ khuôn mặt, chưa phải tài khoản đăng nhập.

Hồ sơ nhập từ SQL có **0 mẫu**. Tải lại web khi Python online, chọn `+ Mẫu` trên đúng dòng mới và chụp khuôn mặt để bổ sung. Khi đăng ký người mới trực tiếp trên web, backend tự tạo ID và mẫu đầu tiên. Hiện chưa có cột email/CCCD hay mã nghiệp vụ riêng: `id` là mã định danh nội bộ. Không tự tạo vector giả để đăng ký khuôn mặt.

## Cài lại trên máy khác

Cần cài SQL Server và Microsoft ODBC Driver 18 trước. Sau đó:

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-sqlserver.txt
.\.venv\Scripts\python.exe manage_database.py setup-sqlserver --server 'localhost\SQLEXPRESS' --database VisionFaceDB --trust-server-certificate --activate
```

Dừng đăng ký vào backend cũ trước khi chuyển. Công cụ sao lưu SQLite bằng SQLite backup API, tạo schema, nhập dữ liệu trong một transaction và chỉ ghi cấu hình kích hoạt sau khi thành công. Nếu lỗi nhập, transaction được hoàn tác. File nguồn SQLite và JSON không bị sửa/xóa. Database đích phải trống trong lần nhập đầu tiên.

Chỉ nhập SQLite một lần. Chạy lại không tạo bản sao và không hồi sinh hồ sơ đã xóa. Dữ liệu mới ghi vào SQLite sau lần chuyển không tự đồng bộ; sau chuyển hãy dùng backend SQL Server.

`--trust-server-certificate` dành cho instance cục bộ được tin cậy. Khi triển khai máy chủ, cấu hình chứng chỉ TLS hợp lệ. Bộ adapter hiện dùng Windows Authentication; triển khai Linux/cloud cần bổ sung phương thức xác thực phù hợp.

## Biến môi trường

Biến môi trường ghi đè `database.local.json`:

- `FACE_DB_BACKEND`: `sqlite` hoặc `sqlserver`.
- `SQLSERVER_SERVER`: tên server/instance.
- `SQLSERVER_DATABASE`: tên database, mặc định `VisionFaceDB`.
- `SQLSERVER_DRIVER`: tên ODBC driver.
- `SQLSERVER_TRUST_CERTIFICATE`: `true`/`false`, mặc định false.
- `FACE_DATABASE_PATH`: đường dẫn khi dùng SQLite.

Để mở lại dữ liệu SQLite cũ khi cần đối chiếu:

```powershell
$env:FACE_DB_BACKEND = 'sqlite'
.\.venv\Scripts\python.exe server.py
```

Đây là dữ liệu độc lập tại thời điểm chuyển, không chứa những thay đổi mới trong SQL Server. Xóa biến ghi đè bằng `Remove-Item Env:FACE_DB_BACKEND` để quay về cấu hình local.

## Sao lưu

`backups/` giữ snapshot SQLite trước khi chuyển. Sau khi dùng SQL Server, phải sao lưu chính `VisionFaceDB`: trong SSMS nhấp phải database → Tasks → Back Up → Full → chọn đường dẫn mà dịch vụ SQL Server được quyền ghi. Giữ bản `.bak` ở nơi lưu trữ riêng. Sao chép SQLite cũ không sao lưu dữ liệu mới trong SQL Server.

## Kiểm tra

Kiểm thử SQL Server tạo database thử riêng `VisionFaceTest_<UUID>` và tự xóa, không chạy các thao tác xóa trên `VisionFaceDB`:

```powershell
$env:VISIONFACE_TEST_SQLSERVER = 'localhost\SQLEXPRESS'
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p 'test_sqlserver_integration.py' -v
```

Các kiểm tra khác:

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p 'test_*.py'
.\.venv\Scripts\python.exe -B tests/check_profile_backend.py
node tests/check_web.cjs
node tests/check_profile_capture.cjs
node tests/check_database_ui.cjs
```
