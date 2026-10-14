# Dữ liệu và quyền quản lý của chủ dự án

Website dùng **một PostgreSQL trên Supabase** cho cả AURAMAXX và VisionFace.
`DATABASE_URL` trong `.env` là kết nối chung. `AURAMAXX_DB_BACKEND=postgres` và
`FACE_DB_BACKEND=postgres`. Website không khởi động hoặc kết nối SQL Server.
Thông tin kết nối không được đưa vào frontend, Git hoặc bản ZIP tải từ web.

## Mở khu vực quản trị

Chạy `start_auramaxx.bat`, đăng nhập bằng tài khoản hiện có trong My Aura, rồi
chọn **Quản lý dữ liệu**, hoặc mở **http://127.0.0.1:8000/manage**. Quản trị viên
có thể quản lý tài khoản, mật khẩu tạm, trạng thái khóa, phiên đăng nhập, hồ sơ
khuôn mặt, nhật ký, dữ liệu ứng dụng và bản sao lưu đầy đủ.

Trang quản trị cũ đã được gỡ. `/api/vision/admin/*` trả trạng thái 410;
`/api/manage/*` yêu cầu quyền admin và CSRF token cho thao tác thay đổi.
Đăng nhập, đổi mật khẩu, Arena, routine và VisionFace dùng chung một phiên.

## Mở dữ liệu trong Supabase

Mở project Supabase của bạn, vào **Table Editor** hoặc **SQL Editor**. Chạy
[sql/owner_dashboard.sql](sql/owner_dashboard.sql) để xem dữ liệu dự án.

| Schema | Dữ liệu |
| --- | --- |
| `visionface` | Tài khoản và mật khẩu đã băm, hồ sơ, mẫu khuôn mặt, quyền sở hữu, nhật ký quản trị |
| `public` | Người dùng và liên kết tài khoản, đồng ý, nhật ký, hội thoại, Arena/ELO/BOT, biên bản chuyển dữ liệu |

Các bảng dự án bật RLS; API key trình duyệt không được cấp quyền đọc/ghi bảng.
Ứng dụng truy cập qua backend bằng kết nối PostgreSQL bảo mật TLS. Kết nối
được tái sử dụng qua pool có giới hạn, không tạo kết nối mới cho mỗi request.

ID tài khoản, mật khẩu đã băm, hồ sơ và quyền sở hữu được giữ khi chuyển từ
SQL Server. Các dữ liệu cũ trên Supabase đã được đối chiếu trước khi bổ sung.
Ba giá trị `vector_hash` của SQL Server đã được kiểm tra SHA-256. Đây là khóa
chỉ mục suy ra từ vector; PostgreSQL dùng ràng buộc duy nhất trên dữ liệu
vector, còn giá trị nhị phân gốc vẫn được giữ trong bản sao.
Phiên đăng nhập cũ được lưu trong bản sao nhưng không được kích hoạt lại;
người dùng đăng nhập lại sau khi đổi backend.

## Sao lưu và khôi phục

Tạo một bản sao đầy đủ của dữ liệu Supabase đang dùng:

```powershell
.\.venv\Scripts\python.exe -B -m backend.data_handoff export
```

Hoặc chọn **Sao lưu toàn bộ dữ liệu** trong `/manage`. ZIP gồm:

- `visionface.json`: tất cả bảng VisionFace của dự án.
- `auramaxx.json`: tất cả bảng ứng dụng, kể cả biên bản chuyển dữ liệu.
- `manifest.json`: số lượng và SHA-256 của từng tệp/bảng.

Các bản sao nằm trong `backups/`, được Git bỏ qua. Bản sao trước khi chuyển
lưu cả dữ liệu SQL Server và `supabase-before.json`; `postgres-handoff.json`
ghi kết quả nhập và đối chiếu. Cấu hình cũ được giữ riêng trong bản sao trên
máy, không đưa vào ZIP tải qua web. Database SQL Server nguồn được giữ để
khôi phục khi cần, ứng dụng không còn sử dụng nó.

Bản sao chốt trước chuyển: `backups/owner-handoff-20261014T072344143788Z/`.
Bản sao Supabase sau chuyển: `backups/owner-handoff-20261014T073510020356Z/`.
Đã giữ 4 tài khoản, 3 hồ sơ/3 mẫu, 8 bản ghi đồng ý, 1 nhật ký sức khỏe,
1 hội thoại và 6 trận BOT. Cả 4 tài khoản đều có liên kết VisionFace.

Lệnh chuyển có kiểm tra checksum và dừng nếu Supabase có dữ liệu khác:

```powershell
.\.venv\Scripts\python.exe -B -m backend.migrate_unified_postgres --backup backups/THU_MUC_SAO_LUU
```

Không chạy lại một bản sao cũ để thay thế dữ liệu mới. Công cụ chỉ bổ sung
dữ liệu đã đối chiếu, không ghi đè tài khoản hoặc nhật ký khác trên Supabase.

## Kiểm thử

Kiểm thử PostgreSQL dùng schema có UUID riêng và dữ liệu giả. Có kiểm tra
đăng nhập cũ/mới, phân quyền, quản trị, backup, chuyển cả hai kho dữ liệu và
dừng/rollback khi dữ liệu đích xung đột. Không dùng bảng đang hoạt động để
tạo hoặc xóa tài khoản thử. Cấu hình Render hiện có được giữ nguyên.
