# Đăng nhập và quản trị VisionFace

Chạy web bằng `server.py`, rồi mở cùng địa chỉ máy chủ cho giao diện và API.

| Địa chỉ trên localhost:8000 | Chức năng |
| --- | --- |
| `/login.html` | Đăng nhập hoặc tạo tài khoản người dùng |
| `/admin-login.html` | Đăng nhập admin |
| `/admin.html` | Quản lý hồ sơ, tài khoản và nhật ký |
| `/account.html` | Đổi mật khẩu |
| `/` | Camera và phân tích khuôn mặt sau khi đăng nhập |

## Sử dụng lần đầu

1. Cài thư viện: `.\.venv\Scripts\python.exe -m pip install -r requirements.txt`. Với SQL Server, cài thêm `requirements-sqlserver.txt` như hướng dẫn trong `DATABASE_SQLSERVER.md`.
2. Tạo admin bằng terminal tại thư mục dự án:

   ```powershell
   .\.venv\Scripts\python.exe manage_accounts.py create-admin --username admin --generate-password
   ```

   Lệnh tạo mật khẩu ngẫu nhiên và chỉ in tại terminal. Không có mật khẩu mặc định trong code. Lệnh dùng database đang cấu hình trong `database.local.json` hoặc biến môi trường.
3. Khởi động `.\.venv\Scripts\python.exe server.py`, mở `http://localhost:8000/admin-login.html`.
4. Đăng nhập admin. Web yêu cầu đổi mật khẩu tạm trước khi sử dụng; đổi xong đăng nhập lại bằng mật khẩu mới.
5. Người dùng mở `http://localhost:8000/login.html`, chọn **Tạo tài khoản**. Tên đăng nhập 3–64 ký tự không dấu (chữ, số, `.`, `_`, `-`); họ tên được nhập tiếng Việt; mật khẩu 12–128 ký tự.

Nếu đã tạo admin, không chạy lại lệnh tạo. Khi quên mật khẩu, đặt lại tại terminal:

```powershell
.\.venv\Scripts\python.exe manage_accounts.py reset-password --username admin --generate-password
```

Lệnh thu hồi mọi phiên của tài khoản đó và yêu cầu đổi mật khẩu ở lần đăng nhập tiếp theo. Có thể bỏ `--generate-password` để tự nhập mật khẩu, không hiển thị khi gõ.

## Xem chi tiết và gán hồ sơ cũ

Trong trang quản trị, chọn **Hồ sơ khuôn mặt → Chi tiết** để xem ID, tên, ngày tạo, số mẫu, thời gian tạo từng mẫu, số điểm mốc và phiên bản đặc trưng. Admin có thể sửa tên, gán tài khoản sở hữu hoặc xóa hồ sơ cùng các mẫu.

Các hồ sơ có sẵn, ví dụ Tùng, được giữ nguyên và ban đầu **Chưa gán**. Tạo tài khoản người dùng trước, sau đó chọn tài khoản ở mục **Tài khoản sở hữu** và **Lưu thay đổi**. Người dùng đăng nhập sẽ thấy hồ sơ vừa được gán. Hồ sơ đăng ký mới từ trang camera tự liên kết với tài khoản đang đăng nhập. Một tài khoản có thể sở hữu nhiều hồ sơ.

Admin xem mọi hồ sơ; người dùng chỉ xem, thêm mẫu, nhận dạng và xóa hồ sơ thuộc tài khoản mình. Tài khoản người dùng không truy cập được API quản trị và không được xóa toàn bộ database. Các mẫu hiện lưu vector đặc trưng, chưa lưu ảnh chân dung gốc hay kết quả phân tích lâu dài.

Trong tab **T?i kho?n**, admin xem h? t?n, quy?n, tr?ng th?i, l?n ??ng nh?p g?n nh?t v? kh?a/m? kh?a t?i kho?n ng??i d?ng ho?c admin kh?c. C? th? t?o t?i ?a 3 t?i kho?n admin (t?nh c? t?i kho?n b? kh?a); h? th?ng lu?n gi? ?t nh?t m?t admin ?ang ho?t ??ng v? kh?ng cho admin t? kh?a m?nh. Kh?a t?i kho?n thu h?i c?c phi?n ??ng nh?p. Tab **Nh?t k?** hi?n th? 100 thao t?c g?n ??y ???c th?c hi?n qua ?ng d?ng; thay ??i tr?c ti?p trong SSMS kh?ng ?i qua nh?t k? ?ng d?ng.

## Quản lý thông tin đăng nhập và mật khẩu người dùng

Trong **Tài khoản → Chi tiết**, admin xem ID tài khoản, tên đăng nhập, họ tên, trạng thái, ngày tạo, lần đăng nhập cuối, số phiên hoạt động và các hồ sơ khuôn mặt đang liên kết. Có thể mở hồ sơ từ trang chi tiết tài khoản, hoặc chọn **Xem tài khoản đăng nhập** trong chi tiết hồ sơ để chuyển theo chiều ngược lại.

- **T?o t?i kho?n:** ch?n quy?n ng??i d?ng ho?c admin, nh?p h? t?n v? t?n ??ng nh?p. C? t?i ?a 3 t?i kho?n admin; m?t kh?u t?m c? th? t? nh?p (12?128 k? t?) ho?c ?? tr?ng ?? t?o ng?u nhi?n. Admin m?i ph?i ??i m?t kh?u ? l?n ??ng nh?p ??u ti?n.
- **L?u th?ng tin:** ch?nh s?a t?n ??ng nh?p v? h? t?n c?a t?i kho?n kh?c, g?m c? admin. ??i t?n ??ng nh?p thu h?i c?c phi?n c?; ng??i d?ng ??ng nh?p l?i b?ng t?n m?i. T?n h? s? khu?n m?t ???c qu?n l? ri?ng, c?c li?n k?t gi? nguy?n theo ID.
- **??t l?i m?t kh?u:** c?p m?t kh?u t?m m?i, thu h?i m?i phi?n c? v? bu?c t?i kho?n ???c c?p l?i m?t kh?u ??i m?t kh?u khi ??ng nh?p. M?t kh?u tr??c ?? kh?ng d?ng ???c n?a.
- **Đăng xuất mọi phiên của người dùng:** thu hồi các phiên hiện có mà không đổi mật khẩu.

Mật khẩu tạm vừa cấp xuất hiện trong khung riêng; bấm **Hiện mật khẩu** để đọc và cung cấp trực tiếp cho người dùng. Khung này được xóa khi đóng, chuyển tab, chọn tài khoản khác hoặc tải lại trang. Mật khẩu hiện tại không thể xem lại vì SQL Server chỉ lưu băm Argon2id trong `accounts.password_hash`; mật khẩu tạm cũng được băm trước khi lưu. Mật khẩu không được ghi vào nhật ký, LocalStorage hay SessionStorage. Nếu không còn mật khẩu tạm, admin có thể cấp lại.

C?c thao t?c tr?n ghi nh?t k? `account.created`, `account.admin_created`, `account.updated`, `account.password_reset`, `account.sessions_revoked` v?i ID admin th?c hi?n v? ID t?i kho?n ???c qu?n l?. M?c n?y qu?n l? t?i kho?n ng??i d?ng v? admin kh?c; admin ??i m?t kh?u c?a m?nh ? **T?i kho?n** tr?n thanh ?i?u h??ng.

Nhật ký được lưu trong `VisionFaceDB.dbo.audit_logs` khi chọn backend SQL Server, cùng database với tài khoản và khuôn mặt. Tab Nhật ký hiển thị nguồn dữ liệu; bấm **Làm mới** để tải lại. Trong SSMS, kết nối `localhost\SQLEXPRESS`, Refresh mục **Databases → VisionFaceDB → Tables**, rồi mở `dbo.audit_logs`. Mở [sql/inspect_audit.sql](sql/inspect_audit.sql) và bấm **F5** để xem nhật ký kèm tên tài khoản, lọc theo tài khoản/thao tác/ID/ngày UTC, thống kê và đối chiếu dữ liệu khuôn mặt. Có thể dùng **Save Results As…** ở bảng kết quả để xuất dữ liệu.

Schema tài khoản phiên bản 2 đồng bộ collation của `audit_logs.actor_id` và `audit_logs.target_id` với các mã tài khoản/khuôn mặt (`Latin1_General_100_BIN2`), sửa lỗi SQL Server 468 khi ghép bảng. Máy chủ tự nâng cấp trong một giao dịch lúc khởi động, giữ các sự kiện cũ và thêm index cho truy vấn nhật ký mới nhất. Nhật ký HTTP trong thư mục `logs/` là log kỹ thuật riêng; bảng `audit_logs` ghi các thao tác tài khoản và hồ sơ qua ứng dụng.

## Đối chiếu bằng SQL Server

Trong SSMS, chọn `VisionFaceDB` và chạy:

```sql
USE VisionFaceDB;

SELECT id, username, display_name, role, is_active, created_at, last_login
FROM dbo.accounts
ORDER BY created_at DESC;

SELECT p.id, p.name, a.username AS owner_username,
       p.created_at, COUNT(s.id) AS sample_count
FROM dbo.people p
LEFT JOIN dbo.account_people o ON o.person_id = p.id
LEFT JOIN dbo.accounts a ON a.id = o.account_id
LEFT JOIN dbo.face_samples s ON s.person_id = p.id
GROUP BY p.id, p.name, a.username, p.created_at
ORDER BY p.created_at DESC;

SELECT TOP (100) l.created_at, a.username, l.action, l.target_id
FROM dbo.audit_logs l
LEFT JOIN dbo.accounts a ON a.id = l.actor_id
ORDER BY l.created_at DESC;
```

`accounts` là tài khoản đăng nhập; `people` là hồ sơ khuôn mặt; `account_people` liên kết chúng. `auth_sessions` lưu phiên đăng nhập; `audit_logs` lưu nhật ký. Schema tài khoản được tạo bổ sung khi khởi động, không thay thế bảng khuôn mặt. Khi sao lưu, sao lưu toàn bộ database để giữ cả tài khoản và liên kết. Công cụ chuyển SQLite sang SQL Server hiện chỉ chuyển dữ liệu khuôn mặt; không dùng nó để chuyển tài khoản giữa hai backend.

## Phiên và cấu hình

Mật khẩu được băm bằng Argon2id. Cookie phiên có `HttpOnly`, `SameSite=Strict`, hết hạn sau 8 giờ; database lưu băm token phiên. Các thao tác ghi yêu cầu CSRF token. Đăng nhập và tạo tài khoản giới hạn tổng cộng 15 yêu cầu / IP / 5 phút trên mỗi tiến trình máy chủ; bộ đếm đặt lại khi khởi động lại.

Với triển khai HTTPS, đặt `FACE_COOKIE_SECURE=true` trước khi chạy máy chủ. Với HTTP localhost, giữ mặc định. Cần phục vụ giao diện và API cùng origin. Bản có tài khoản cần backend Python; mở HTML trực tiếp hoặc chỉ dùng GitHub Pages không cung cấp đăng nhập hay quản lý database.

Trên domain `*.github.io`, giao diện chuyển về trang đăng nhập trong đúng thư mục repository và thông báo cần backend; đây không phải triển khai hệ thống tài khoản. Push lên GitHub chỉ cập nhật mã nguồn. Để sử dụng đầy đủ, triển khai `server.py` cùng giao diện trên một máy chủ có HTTPS và kết nối database. `localhost\SQLEXPRESS` chỉ đến SQL Server trên máy chạy Python; chuyển Python sang máy chủ khác cần cấu hình kết nối tới database tương ứng, không tự kết nối SQL Server trên máy cá nhân.

## Kiểm tra

Với Supabase PostgreSQL, xem [SUPABASE_RENDER.md](SUPABASE_RENDER.md).
`migrate_to_postgres.py` chuyển cả tài khoản, mật khẩu đã băm, quyền sở hữu
hồ sơ và nhật ký; không chuyển phiên đăng nhập. Dùng lại tài khoản/mật khẩu
cũ sau khi chuyển thành công. Không dùng Supabase Authentication thay thế
`AuthStore` trong cấu hình này.

```powershell
$env:VISIONFACE_TEST_SQLSERVER='localhost\SQLEXPRESS'
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p 'test_*.py'
```

Các kiểm tra SQL Server chỉ tạo và xóa database thử có tên `VisionFaceTest_<UUID>`, không xóa database thật. Nếu không đặt biến môi trường này, các kiểm tra SQL Server sẽ được bỏ qua.

Kiểm tra giao diện trên Windows có Edge và Node 22 trở lên: `node tests/browser_auth_smoke.cjs`. Bài kiểm tra dùng database SQLite và hồ sơ trình duyệt tạm, không đăng nhập hoặc sửa database thật.
