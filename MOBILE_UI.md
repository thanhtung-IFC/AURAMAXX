# Giao diện điện thoại

- Face Lab đưa các nút chụp, phân tích và tự chụp góc nghiêng ngay dưới camera.
  Khi mở camera, trang cuộn tới khung hình; cài đặt camera thu gọn trên điện thoại.
  Các nút dùng chung với desktop, không nhân đôi sự kiện hoặc ảnh chụp.
- Thanh điều hướng có 5 vùng bấm: Tổng quan, Face Lab, Sức khỏe, Aura AI và Thêm.
  Menu Thêm mở My Aura, Tiến trình và Face Arena bằng dialog hỗ trợ bàn phím.
- Tăng vùng bấm của nút, bộ lọc routine, công tắc quyền riêng tư và nút gửi chat;
  ô nhập trên điện thoại dùng cỡ chữ 16px, chừa vùng an toàn của màn hình.
- Khi bàn phím mở, dùng VisualViewport để dành chỗ cho ô chat và nút gửi,
  kể cả khi chiều cao bố cục giữ nguyên; thanh điều hướng hiện lại khi đóng bàn phím.
- Chế độ hoạt động có trong My Aura → Giao diện và Cài đặt camera của Face Lab.
  Tiết kiệm giảm hiệu ứng và tải vẽ điểm mốc; xem [PERFORMANCE.md](PERFORMANCE.md).

## Kiểm tra

```powershell
.\.venv\Scripts\python.exe -X utf8 -B -m unittest tests.test_frontend
node tests/browser_unified_smoke.cjs
node tests/browser_aura_smoke.cjs
```

Kiểm thử Edge dùng camera/landmark và dịch vụ AI giả lập, máy chủ Python/SQLite
thật. Kiểm tra nút chụp bằng sự kiện chạm ở màn hình 320–430px và bố cục ngang
667×375, chuyển về desktop, phân tích ảnh, menu Thêm và 7 trang không tràn ngang.
Kiểm thử chat mô phỏng cả bàn phím giảm chiều cao bố cục và chỉ giảm vùng hiển thị.
Ảnh kiểm tra nằm trong `.test-output/`.

Đây là mô phỏng trình duyệt, chưa thay thế kiểm tra camera, bàn phím và thanh
địa chỉ trên iPhone/Safari hoặc Android thật. Cần deploy mã mới để website Render
nhận thay đổi.

Tham khảo API: [VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport).
