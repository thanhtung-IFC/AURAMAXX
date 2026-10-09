# Chạy thử với Supabase PostgreSQL và Render đến hết tháng 10/2026

Render phục vụ cả HTML, trang đăng nhập và Python API trên cùng URL HTTPS.
Supabase lưu tài khoản, mật khẩu Argon2 đã băm, liên kết tài khoản–hồ sơ,
mẫu khuôn mặt và nhật ký. GitHub lưu mã nguồn. Không cần tên miền riêng.
SQL Server trên máy vẫn giữ nguyên; chuyển dữ liệu là sao chép một lần,
không phải đồng bộ hai chiều. Sau khi chuyển, dữ liệu mới trên cloud nằm ở Supabase.

## 1. Tạo project Supabase

1. Vào https://supabase.com/dashboard, đăng nhập và tạo organization nếu được yêu cầu.
2. Chọn **New project**, tên `visionface`, gói **Free** nếu chỉ thử nghiệm.
3. Đặt **Database password** mạnh và lưu trong trình quản lý mật khẩu.
   Đây là mật khẩu database, khác với mật khẩu admin của web.
4. Chọn vùng gần Việt Nam, ví dụ Singapore nếu dashboard có, rồi tạo project.
5. Khi project sẵn sàng, nhấn **Connect → Session pooler → URI**.
   Lấy chính xác host và username từ dashboard, dùng cổng **5432**.
   Không dùng Transaction pooler cổng 6543 trong cấu hình này.

Chuỗi có dạng minh họa (không sao chép nguyên các dấu ngoặc):

```text
postgresql://postgres.PROJECT_REF:MAT_KHAU@POOLER_HOST:5432/postgres?sslmode=require
```

Thay `[YOUR-PASSWORD]` bằng mật khẩu database. Ký tự đặc biệt trong mật khẩu
cần được percent-encode khi đặt vào URI. Để tránh lỗi, có thể chọn mật khẩu
ngẫu nhiên dài chỉ gồm chữ, số, `_` và `-` khi tạo project.
Không gửi URI chứa mật khẩu vào chat, không đưa vào JavaScript hay GitHub.
Backend kết nối bằng PostgreSQL; không cần anon key hoặc service-role API key.

Các bảng thuộc schema **visionface**, có RLS và không có chính sách truy cập công khai.
Giữ schema này ngoài danh sách **Exposed schemas** của Data API.
Tài khoản đăng nhập web tiếp tục do `AuthStore` quản lý, không tự biến thành
người dùng trong Supabase Authentication.

## 2. Chuẩn bị và xem trước dữ liệu trên máy

Chạy PowerShell tại thư mục dự án, giữ `database.local.json` hiện tại trỏ đến SQL Server.
Không đặt `FACE_DB_BACKEND=postgres` ở bước chuyển dữ liệu, vì biến đó chọn **nguồn**.

```powershell
.\.venv\Scripts\python.exe -m pip install -r requirements-postgres.txt
.\.venv\Scripts\python.exe -B migrate_to_postgres.py --preview
```

Lệnh preview chỉ đọc và in số lượng ở `accounts`, `people`, `face_samples`,
`account_people`, `audit_logs`; chưa kết nối cloud. Nếu dùng môi trường Python mới
để đọc SQL Server, cài thêm `requirements-sqlserver.txt` và ODBC Driver 18.
Trước khi chuyển thật, tạm dừng đăng ký/sửa dữ liệu trên web local và tạo bản
backup SQL Server bằng SSMS: database → **Tasks → Back Up → Full**.

## 3. Sao chép toàn bộ sang Supabase

```powershell
.\.venv\Scripts\python.exe -B migrate_to_postgres.py
```

Khi hiện `Supabase Session pooler DATABASE_URL (hidden):`, dán URI ở bước 1
và Enter. Phần nhập ẩn nên bạn không thấy ký tự khi dán.

Công cụ tạo schema đích, chuyển dữ liệu trong một transaction và đối chiếu
nội dung từng bảng trước commit. Đích phải trống; không ghi đè dữ liệu có sẵn
và không cho nhập lại sau khi đã hoàn tất. Nếu lỗi giữa chừng, dữ liệu nhập
được rollback. Các ID, ngày tạo, mật khẩu đã băm, quyền admin/user và chủ sở hữu
hồ sơ được giữ nguyên. **Phiên đăng nhập cũ không chuyển**; đăng nhập lại bằng
tài khoản và mật khẩu đang dùng. Không có bước đặt lại mật khẩu admin.

Kết quả cần có `mode: imported_and_verified`, số lượng khớp preview.
Chỉ deploy web sau khi bước này thành công.

## 4. Kiểm tra trong Supabase

Mở **SQL Editor → New query**, chạy:

```sql
SELECT 'accounts' AS bang, COUNT(*) AS so_luong FROM visionface.accounts
UNION ALL SELECT 'people', COUNT(*) FROM visionface.people
UNION ALL SELECT 'face_samples', COUNT(*) FROM visionface.face_samples
UNION ALL SELECT 'account_people', COUNT(*) FROM visionface.account_people
UNION ALL SELECT 'audit_logs', COUNT(*) FROM visionface.audit_logs;

SELECT p.id, p.name, a.username, p.created_at, COUNT(s.id) AS so_mau
FROM visionface.people p
LEFT JOIN visionface.account_people ap ON ap.person_id = p.id
LEFT JOIN visionface.accounts a ON a.id = ap.account_id
LEFT JOIN visionface.face_samples s ON s.person_id = p.id
GROUP BY p.id, a.username
ORDER BY p.created_at DESC;

SELECT id, username, display_name, role, is_active, last_login
FROM visionface.accounts ORDER BY created_at DESC;

SELECT * FROM visionface.audit_logs ORDER BY created_at DESC LIMIT 50;
```

Trong **Table Editor**, chọn schema `visionface` để xem bảng nếu giao diện cho phép.
Hồ sơ lưu đặc trưng khuôn mặt, không phải ảnh gốc. Không chia sẻ password_hash
hay vector của người dùng khi gửi ảnh chụp kết quả.

## 5. Triển khai Render

Đưa thay đổi mã nguồn lên repository GitHub của bạn, gồm `render.yaml`,
`requirements-postgres.txt`, `postgres_store.py`, thư mục `sql/`, HTML và `assets/`.
Không đưa database, backup hay bí mật lên GitHub.

**Cách dùng Blueprint:** Render Dashboard → **New → Blueprint** → kết nối repo
→ chọn nhánh chứa thay đổi → điền `DATABASE_URL` bằng URI Supabase → deploy.

**Nếu tạo Web Service thủ công:** chọn repo và cấu hình:

| Mục | Giá trị |
| --- | --- |
| Runtime | Python |
| Instance | Free, nếu chỉ thử |
| Build command | `pip install -r requirements-postgres.txt` |
| Start command | `python -u render_start.py` |
| Health check | `/api/status` |

Thêm environment variables trong Render, không trong GitHub:

| Biến | Giá trị |
| --- | --- |
| `FACE_DB_BACKEND` | `postgres` |
| `DATABASE_URL` | URI Session pooler Supabase có `sslmode=require` |
| `FACE_COOKIE_SECURE` | `true` |
| `HOST` | `0.0.0.0` |

Render cấp `PORT` tự động. Không cần cài ODBC/SQL Server trên Render.
Web dùng tối đa 5 kết nối PostgreSQL trong mỗi tiến trình Python.

Khi deploy thành công, mở `https://TEN-DICH-VU.onrender.com/`.
Trang chính cần đưa người chưa đăng nhập về trang login.
Admin truy cập `/admin-login.html`, đăng nhập bằng admin hiện có.
Mở `/api/status`, kiểm tra `database` là **postgres**, số hồ sơ/mẫu khớp.
Thử đăng nhập user, xem hồ sơ của mình; admin xem toàn bộ và nhật ký.
Cho phép camera trên URL HTTPS của Render. Không mở web từ GitHub Pages.

## 6. Chi phí và kết thúc đợt thử

Gói Free có giới hạn. Render có thể ngủ sau 15 phút không hoạt động nên lần mở
đầu tiên cần chờ khởi động; Supabase Free có thể tạm dừng project ít hoạt động.
Xem mức sử dụng và gói thực tế trong hai dashboard; đừng nâng cấp gói trả phí
nếu chưa cần. Hết tháng không có cơ chế tự xóa dữ liệu trong mã nguồn.

Ngày **31/10/2026**, sau khi ngừng nhận dữ liệu mới:

1. Tạo bản backup PostgreSQL cuối cùng bằng `pg_dump` hoặc công cụ backup
   được Supabase hướng dẫn cho gói đang dùng; bao gồm schema `visionface`.
   Chỉ xuất CSV hồ sơ sẽ không giữ đủ tài khoản, liên kết và ràng buộc.
   Dùng client PostgreSQL phù hợp phiên bản máy chủ; thử khôi phục bản backup
   vào database riêng trước khi xóa dịch vụ.
2. Suspend hoặc xóa **Web Service** trên Render để đóng truy cập web.
3. Giữ Supabase nếu còn cần xem dữ liệu; chỉ pause/xóa project sau khi đã
   kiểm tra backup. Xóa project Supabase đồng nghĩa xóa dữ liệu trên cloud.
4. Kiểm tra dashboard billing của cả hai bên và dừng tài nguyên trả phí nếu có.

SQL Server cũ chỉ chứa dữ liệu trước lần chuyển, không thay thế bản backup
cuối đợt của Supabase.

Ví dụ `pg_dump` trong PowerShell sau khi đã cài PostgreSQL client (thay host và
username bằng giá trị trong Connect; dùng direct connection nếu mạng hỗ trợ):

```powershell
New-Item -ItemType Directory -Force backups | Out-Null
$env:PGSSLMODE='require'
pg_dump -h POOLER_HOST -p 5432 -U postgres.PROJECT_REF -d postgres -n visionface -Fc --no-owner --no-acl -W -f backups/visionface-final-20261031.dump
```

`-W` hỏi mật khẩu database, không đưa mật khẩu vào dòng lệnh. Giữ bản dump
ở nơi riêng tư vì nó chứa hash mật khẩu và đặc trưng khuôn mặt.

Nguồn: [Supabase connection methods](https://supabase.com/docs/guides/database/connecting-to-postgres),
[Supabase backups](https://supabase.com/docs/guides/platform/backups),
[Render Blueprints](https://render.com/docs/blueprint-spec),
[Render Free](https://render.com/docs/free).
