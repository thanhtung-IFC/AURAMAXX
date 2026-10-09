# Triển khai VisionFace trên máy chủ riêng

Giao diện và API Python được phục vụ cùng địa chỉ HTTPS. GitHub lưu mã nguồn; SQL Server lưu tài khoản, hồ sơ, mẫu khuôn mặt, liên kết và nhật ký.

```text
Trình duyệt → HTTPS (Caddy) → Python 127.0.0.1:8000 → SQL Server
GitHub → cập nhật mã nguồn trên máy chủ
```

## Điều kiện trước khi đưa online

Cần một máy chủ hoạt động khi người dùng truy cập và một tên miền trỏ về địa chỉ IP công khai của máy chủ. Có thể thuê VPS hoặc tự vận hành máy cá nhân. Máy cá nhân cần mạng cho phép nhận kết nối từ Internet; cần kiểm tra IP công khai/CGNAT và khả năng chuyển tiếp cổng trước khi chọn cách này.

Với dự án đang phát triển trên Windows và SQL Server Express dùng Windows Authentication, máy chủ Windows giúp giữ cách cấu hình quen thuộc. Nếu chọn Linux, code hỗ trợ xác thực SQL bằng `SQLSERVER_USERNAME` và `SQLSERVER_PASSWORD`, nhưng vẫn cần cài SQL Server/ODBC và cấu hình database trên máy chủ.

Chưa có máy chủ và tên miền thì vẫn dùng `http://localhost:8000` để phát triển; các bước dưới đây thực hiện trên máy chủ sau khi đã có các điều kiện này.

## Chuẩn bị ứng dụng và database trên Windows

1. Cài Git, Python, SQL Server Express, ODBC Driver 18 và Caddy trên máy chủ.
2. Clone repository, tạo venv và cài `requirements-sqlserver.txt`.
3. Sao lưu **toàn bộ** database `VisionFaceDB` hiện tại và restore lên SQL Server của máy chủ. Giữ các bảng tài khoản, phiên, hồ sơ, mẫu và nhật ký. Không dùng công cụ chuyển SQLite để chuyển tài khoản hiện tại.
4. Tạo `database.local.json` trên máy chủ theo `DATABASE_SQLSERVER.md`. Nếu dùng Windows Authentication, tài khoản Windows chạy Python phải được cấp quyền với database; quyền trên máy cũ không tự chuyển sang máy chủ mới.
5. Kiểm tra database:

   ```powershell
   .\.venv\Scripts\python.exe check_deployment.py
   ```

Không tạo lại admin nếu database restore đã có admin. Với database mới trống, tạo admin bằng lệnh trong `AUTHENTICATION.md`.

Không commit file database, bản backup, `database.local.json`, `.env` hoặc mật khẩu vào GitHub. `.dockerignore` cũng loại dữ liệu cục bộ khi build image.

## Chạy Python phía sau HTTPS

Trên máy chủ, khởi động Python với:

```powershell
$env:HOST='127.0.0.1'
$env:PORT='8000'
$env:FACE_COOKIE_SECURE='true'
.\.venv\Scripts\python.exe -u server.py
```

Các biến trên áp dụng cho phiên terminal đó. Khi cấu hình Python chạy thành dịch vụ, đặt lại cùng các biến trong cấu hình dịch vụ và chọn đúng tài khoản Windows có quyền SQL Server. `FACE_COOKIE_SECURE=true` dùng cho HTTPS; web HTTP localhost khi phát triển giữ mặc định.

## Cấu hình tên miền và HTTPS

Trỏ bản ghi DNS A của tên miền về IP công khai máy chủ. Nếu có bản ghi AAAA, nó cũng phải trỏ đúng máy chủ. Cho phép kết nối vào Caddy qua TCP 80/443. Python ở cổng 8000 chỉ nghe nội bộ; SQL Server không cần mở cho người dùng Internet.

Sao chép `deploy/Caddyfile.example` thành Caddyfile trên máy chủ. Tại thư mục dự án, chạy ví dụ sau sau khi thay `face.example.com` bằng tên miền thật:

```powershell
$env:VISIONFACE_DOMAIN='face.example.com'
caddy validate --config .\deploy\Caddyfile.example --adapter caddyfile
caddy run --config .\deploy\Caddyfile.example --adapter caddyfile
```

Caddy chuyển HTTPS về Python và quản lý chứng chỉ khi tên miền/DNS/cổng đáp ứng điều kiện. Cấu hình này dành cho Caddy và Python chạy trực tiếp trên cùng máy; trong Docker, địa chỉ upstream cần đổi theo mạng container. Khi đưa vào vận hành lâu dài, chạy cả Caddy và Python thành dịch vụ tự khởi động, theo tài liệu của công cụ và tài khoản máy chủ.

Tài liệu: [Caddy HTTPS](https://caddyserver.com/docs/quick-starts/https), [chạy Caddy thành dịch vụ](https://caddyserver.com/docs/running).

## Kiểm tra online

```powershell
.\.venv\Scripts\python.exe check_deployment.py --url https://face.example.com
```

Lệnh chỉ đọc database và kiểm tra status/quyền truy cập API admin khi chưa đăng nhập. Sau đó kiểm tra thủ công: đăng nhập admin, xem hồ sơ/nhật ký, tạo người dùng thử, gán hồ sơ và bật camera qua HTTPS. Khi hoàn tất kiểm tra, xóa dữ liệu thử từ trang quản trị.

## Cập nhật mã nguồn

Sao lưu database trước các thay đổi schema; cập nhật code bằng Git và cài thư viện cần thiết, sau đó khởi động lại dịch vụ Python. Giữ nguyên database và các file cấu hình riêng trên máy chủ. Chạy lại kiểm tra online sau cập nhật. Việc commit/push lên GitHub không tự deploy máy chủ nếu chưa cấu hình quy trình tự động.
