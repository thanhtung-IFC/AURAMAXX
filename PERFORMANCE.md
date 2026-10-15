# Cấu hình hoạt động theo thiết bị

Chọn **Chế độ hoạt động** trong **My Aura → Giao diện** hoặc **Face Lab → Cài đặt
camera**. Hai nơi dùng chung lựa chọn trên trình duyệt hiện tại.

| Mức | Cạnh dài nhận diện | Khoảng xử lý mục tiêu | Vẽ điểm mốc | DPR tối đa | Camera tự động |
| --- | --- | --- | --- | --- | --- |
| Tiết kiệm | 480px | 125ms | 200ms | 1 | 720p, 20 FPS |
| Cân bằng | 640px | 90ms | 100ms | 1.5 | 720p, 24 FPS |
| Chất lượng cao | 960px | 66ms | 66ms | 2 | 1080p, 30 FPS nếu hỗ trợ |

Đây là mục tiêu cấu hình, không bảo đảm FPS thực nhận. Trình duyệt/camera có thể
cung cấp mức thấp hơn; giao diện hiển thị kích thước và frame rate từ track/video.
Nguồn thấp không bị phóng lớn để tạo ảnh chụp có vẻ nhiều chi tiết hơn.

## Tự động

- Số luồng CPU ≤4 hoặc RAM ước lượng ≤2GB chỉ gợi ý khởi đầu Tiết kiệm. Nếu thiếu
  API hoặc không thuộc nhóm này, khởi đầu Cân bằng. Không gán mức cao theo hãng máy.
- Đo trên các lượt nhận diện đang chạy bằng đồng hồ đơn điệu. Bỏ ba lượt làm nóng;
  cần ít nhất ba giây và 12 mẫu dùng được trước khi chọn mức ban đầu.
- Dùng phân vị 90% của tối đa 24 mẫu gần nhất, gồm thời gian xử lý toàn khung và
  độ trễ callback giao diện. Yêu cầu API nhận diện được gửi riêng, không được chờ
  trong phép đo hiệu năng máy.
- Áp lực kéo dài ít nhất hai giây làm hạ một mức. Chỉ nâng một mức sau ít nhất
  mười giây nhanh ổn định. Khung nhận diện và lớp điểm mốc giảm trước; khi đang
  giữ ảnh Full HD, chờ thêm sáu giây ở mức thấp trước khi giảm luồng camera.
- Đo lại khi bật/đổi camera hoặc chọn lại Tự động. Chế độ thủ công giữ mức người
  dùng chọn. Chất lượng camera đặt thủ công vẫn được ưu tiên về độ phân giải.

## Ảnh chụp, xác thực và giao diện

- Đổi chế độ áp dụng trên track đang chạy, không mở thêm camera, không xóa ảnh
  đã chụp. Các thay đổi camera được xếp nối tiếp và gộp lựa chọn mới nhất.
- Giữ ảnh và landmark cùng một frame; kiểm tra sáng, nét, góc và độ ổn định
  dùng các ngưỡng hiện hành. Thay đổi kích thước video yêu cầu giữ yên lại.
- Khi liveness hoạt động, đặt nhịp xử lý mục tiêu tối thiểu như chế độ thường
  trước đây: khoảng 66ms, cạnh dài ≥640px, camera mục tiêu ≥24 FPS. Tạm dừng
  phân hạng tự động và đổi độ phân giải trong bước này. Đây là mục tiêu lấy mẫu,
  chưa phải xác nhận tỷ lệ nhận diện chớp mắt trên mọi phần cứng thật.
- Tiết kiệm giảm mật độ/tần suất vẽ điểm mốc, bỏ blur nền thanh điều hướng và
  một số hiệu ứng trang. Chỉ báo đang tải và lựa chọn giảm chuyển động vẫn có tác dụng.
- Chỉ lưu enum lựa chọn tại `auramaxx-performance-mode`. Không lưu số đo hiệu năng,
  thông tin phần cứng, ảnh hoặc điểm mốc. Nếu bộ nhớ trình duyệt không dùng được,
  lựa chọn vẫn hoạt động trong tab hiện tại.

## Kiểm tra

```powershell
node tests/test_camera.cjs
.\.venv\Scripts\python.exe -X utf8 -B -m unittest tests.test_frontend
node tests/browser_unified_smoke.cjs
node tests/browser_aura_smoke.cjs
```

Các bài kiểm tra bao gồm làm nóng, phân hạng ban đầu, áp lực UI, hạ/nâng có thời
gian chờ, chế độ thủ công, API phần cứng thiếu, nhịp liveness, cấu hình nối tiếp,
đổi mức khi đã chụp, đồng bộ hai menu và tải lại trang. Edge dùng camera/model/AI
giả lập và backend Python/SQLite thật; chưa phải benchmark trên iPhone, MacBook,
Android hoặc webcam thật. Không công bố mức tăng FPS hoặc giảm pin khi chưa đo.

API đối chiếu: [applyConstraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/applyConstraints),
[performance.now](https://developer.mozilla.org/en-US/docs/Web/API/Performance/now),
[hardwareConcurrency](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/hardwareConcurrency),
[deviceMemory](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/deviceMemory).
