# Face Arena

Arena đặt luyện tập BOT ở phần chính: chọn độ khó, gợi ý đối thủ theo Elo,
dùng kết quả Face Lab hiện có và xem lại từng tiêu chí trong lịch sử. Hồ sơ
và bảng xếp hạng PvP được giữ riêng. PvP vẫn đóng cho đến khi có quy trình
xác minh kết quả trận đấu; API không nhận Elo do trình duyệt tự đặt.

## Quy tắc luyện tập v2

- Chỉ so các tiêu chí có số đo hợp lệ ở người chơi. BOT sử dụng đúng cùng
  tập tiêu chí, với trọng số được chuẩn hóa trên tập này. Không điền điểm
  cho nhóm thiếu dữ liệu. Cần ít nhất 50% tổng trọng số có số đo.
- Chênh lệch không quá 1 điểm tính hòa. Đây là ngưỡng sản phẩm để hạn chế
  quyết định thắng/thua từ chênh lệch nhỏ, không phải khoảng tin cậy thống kê.
- Elo bắt đầu ở 1000. K = 40 trong 10 trận đầu, sau đó K = 32; K được nhân
  với tỷ lệ trọng số có dữ liệu. Tỷ lệ này biểu thị độ đầy đủ, không phải
  xác suất phép đo chính xác. BOT giữ nguyên Elo tham chiếu.
- API ba góc nhìn vẫn tính trung bình ba góc cho cả hai bên, đồng thời lưu
  chính các điểm đã dùng để quyết định kết quả. Giao diện Face Lab hiện dùng
  các tiêu chí có số đo từ báo cáo, không tự tạo ba điểm góc nhìn.
- Một báo cáo trong bộ nhớ có một mã trận cho mỗi BOT, dùng chung giữa
  Face Lab và Arena. Yêu cầu đang chạy được dùng lại; gửi lại sau lỗi mạng
  giữ nguyên mã. Máy chủ trả lại kết quả cũ thay vì cập nhật Elo lần nữa.
  Cùng mã nhưng khác nội dung trả 409. Tạo báo cáo mới để luyện tập tiếp.

## Dữ liệu và khả năng tương thích

`arena_bot_match_details` lưu phiên bản thuật toán, điểm so sánh từng tiêu
chí, trọng số, hệ số Elo và dấu vân tay yêu cầu. Bảng được tạo khi backend
khởi động, không sửa hoặc tính lại lịch sử cũ. Trận cũ không có chi tiết
vẫn hiển thị điểm tổng và Elo ban đầu.

Việc ghi trận, chi tiết và thống kê nằm trong một giao dịch. Trận đấu dùng
cùng khóa theo người dùng với thao tác thu hồi quyền Face Lab, rồi kiểm tra
đồng ý trong khóa trước khi ghi. Thu hồi quyền xóa trận, chi tiết và Elo BOT.
Không lưu ảnh hoặc landmark trong các bảng Arena. Điểm gửi từ trình duyệt
vẫn là đầu vào luyện tập, chưa phải kết quả PvP đã xác minh.

## Kiểm tra

```powershell
./.venv/Scripts/python.exe -X utf8 -m unittest tests.test_arena tests.test_frontend tests.test_api
node tests/browser_arena_smoke.cjs
```

Kiểm tra trình duyệt dùng tài khoản, báo cáo mẫu và SQLite riêng trong
`.test-output`, không chạm database đang dùng. Kiểm tra gồm ghi trận, gửi
lại, bộ lọc, hồ sơ, điều kiện ảnh, thu hồi quyền và bố cục sáng/tối từ
320px đến 1895px. PostgreSQL thật cần bộ kiểm tra tích hợp được cấu hình riêng.
