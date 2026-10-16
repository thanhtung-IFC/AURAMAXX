# Face Lab: camera và chất lượng phép đo

## Thay đổi

- Camera có chế độ tự động: mở HD, đo hiệu năng và đọc `getCapabilities()`, thử
  nâng tới Full HD khi hiệu năng/thiết bị phù hợp, giữ luồng nếu cấu hình thất bại.
  `getSettings()` và kích thước video được dùng để hiển thị cấu hình nhận được.
  Không suy đoán chất lượng camera từ thương hiệu hay tên thiết bị.
- Camera trước/sau trên thiết bị cảm ứng dùng `facingMode`; webcam tích hợp,
  USB và iPhone qua Continuity Camera vẫn chọn theo danh sách thiết bị trình duyệt.
  Chuyển trước/sau không mang theo `deviceId` của camera cũ. Lật gương tự theo
  hướng camera đến khi người dùng chỉnh bằng tay.
- Bấm dừng khi đang xin quyền sẽ hủy phiên mở; nếu quyền được cấp sau đó, luồng
  đến muộn được đóng. Camera bận không gây vòng lặp mở lại. Camera bị tháo,
  tạm ngắt hoặc ngừng phát khung hình làm mất trạng thái sẵn sàng chụp.
- Lấy nét, phơi sáng và cân bằng trắng liên tục chỉ được yêu cầu khi capability
  tương ứng có hỗ trợ; lỗi điều khiển tùy chọn không chặn mở camera.
- Nhận diện dùng cạnh dài 480/640/960px theo mức hoạt động, tự điều chỉnh theo
  hiệu năng đo được khi chọn Tự động. Ảnh chụp giữ riêng tới cạnh dài
  1920px, đúng tỷ lệ nguồn, JPEG 0.92; không phóng lớn nguồn độ phân giải thấp.
  Landmark chuẩn hóa và ảnh chụp vẫn thuộc cùng khung hình đã xử lý.
- Bắt mặt dùng ngưỡng detection 0.45, presence/tracking 0.5. Nếu không thấy mặt,
  thử lại toàn bộ cùng khung hình ở cạnh dài tối thiểu 960px (không phóng lớn
  nguồn), tối đa một lượt bổ sung mỗi 500 ms. Giữ độ phân giải tìm lại trong
  1.5 giây (kèm chỉnh sáng nếu cần) để đủ thời gian ổn định khi chụp, sau đó
  quay về mức hoạt động đã chọn.
- Lượt tìm lại có chỉnh gamma/tương phản giới hạn khi thiếu sáng, dư sáng hoặc
  ít tương phản; bỏ qua ảnh gần như trống và lượt suy luận trùng cấu hình.
  Ảnh tải lên cũng có lượt sửa sáng khi cần. Chỉ ảnh đưa vào model được chỉnh;
  ảnh chụp và kiểm tra sáng/nét vẫn dùng ảnh gốc.
- Kiểm tra landmark hữu hạn và quan hệ mắt–mũi–miệng–cằm trước khi gửi nhận diện
  hoặc cho chụp. Không lấy landmark cũ khi mất mặt và không loại riêng một mặt
  khỏi kết quả nhiều người để cho ảnh nhóm vượt qua điều kiện chụp.
- Dùng `requestVideoFrameCallback()` nếu có, bộ hẹn giờ nếu thiếu; không nhận
  diện trùng frame hoặc chạy chồng phiên khi đổi camera. Khi video đổi kích thước
  (ví dụ xoay điện thoại), bỏ kết quả cũ và yêu cầu giữ yên lại. Khung căn mặt
  tính theo vùng video thực sự hiển thị, tránh đặt hướng dẫn vào dải đen của ảnh.
- Kiểm tra độ nét bằng năng lượng Laplacian trên ROI mặt 64×64, ngưỡng RMS 2.
  Đây là quy tắc loại ảnh quá ít chi tiết, chưa được hiệu chuẩn trên tập ảnh thật;
  không phải confidence hay bảo đảm phát hiện mọi trường hợp nhòe.
- MediaPipe chạy trong classic Web Worker trên trình duyệt hỗ trợ; `importScripts`
  của bộ tải WASM không hoạt động trong module worker. Nếu worker không khởi tạo
  được, ứng dụng dùng bộ xử lý trực tiếp với GPU/CPU như trước.
- Mỗi lần chỉ xử lý một khung hình, bỏ qua video chưa đổi frame, dùng lại canvas
  và hủy yêu cầu đang chạy khi dừng camera hoặc rời trang.
- Ảnh dùng để chụp được giữ riêng với đúng bộ landmark đã xử lý xong. Điểm mốc
  hiển thị được làm mượt; số đo, ảnh gửi phân tích và nhận diện dùng landmark gốc.
- Kiểm tra giữ yên trên cửa sổ 650 ms, ít nhất 4 mẫu; việc trôi chậm, đổi góc,
  mất mặt hoặc khoảng ngắt lớn đều làm mới cửa sổ. Ánh sáng lấy từ vùng mặt thay
  vì toàn nền. Ngưỡng là quy tắc chụp tham khảo, chưa phải confidence đã hiệu chuẩn.
- Nhận diện nền tối đa khoảng một yêu cầu mỗi 850 ms; khi liveness hoạt động,
  khoảng cách tối thiểu còn 220 ms. Mạng chậm không chặn vòng nhận diện trên máy.
- Sửa cặp khóe mắt ngoài 33–263 và trong 133–362; tâm mắt dùng trung điểm khóe
  mắt để phép đo cấu trúc không thay đổi khi đồng tử dịch chuyển.
- Texture da lấy trên patch cùng kích thước và trừ gradient sáng tuyến tính.
  Không lấy được ROI thì trả `null`; điểm tổng hợp chỉ tính các nhóm có dữ liệu.
  Landmark suy biến không tạo báo cáo có vẻ hợp lệ.
- API `/api/face-analyses/status` phản ánh đúng việc phân tích ảnh có backend tại
  `/api/vision/analyze_face`. Quyền đăng nhập, đồng ý và hồ sơ theo tài khoản giữ nguyên.

## Kiểm tra

```powershell
# SQLite riêng để các bài kiểm tra không dùng database của website.
$env:FACE_DB_BACKEND='sqlite'
$env:FACE_DATABASE_PATH="$PWD/.test-output/face-algorithm-import.sqlite3"
$env:AURAMAXX_DB_BACKEND='sqlite'
.\.venv\Scripts\python.exe -B -m unittest tests.test_face_measurements tests.test_algorithm_pipeline tests.test_frontend tests.test_api tests.test_health_hub tests.test_vision_context
node tests/test_capture_stability.cjs
node tests/test_face_acquisition.cjs
node tests/test_camera.cjs
node tests/check_face_worker_browser.cjs
node tests/browser_unified_smoke.cjs

# Chỉ chạy phần Face Lab của kiểm thử website hợp nhất.
$env:FACE_TEST_CAPTURE_ONLY='1'
node tests/browser_unified_smoke.cjs
Remove-Item Env:FACE_TEST_CAPTURE_ONLY

# Kiểm tra model MediaPipe thật, dùng ảnh trống; cần kết nối CDN/Google.
$env:FACE_TEST_REAL_MODEL='1'
node tests/check_face_worker_browser.cjs
Remove-Item Env:FACE_TEST_REAL_MODEL
```

Các bài hình học dùng dữ liệu tổng hợp để kiểm tra bất biến theo độ phân giải,
xoay trong mặt phẳng và vị trí đồng tử. Kiểm thử trình duyệt dùng camera/landmark
giả lập. Phép kiểm tra model thật xác nhận khởi tạo, truyền ảnh, VIDEO/IMAGE,
hủy tác vụ, nhận diện ảnh chân dung mẫu chính thức của MediaPipe và bản giả lập
thiếu sáng của ảnh đó. Đây là kiểm tra tích hợp, chưa phải đánh giá độ chính xác
trên một tập ảnh đại diện cho người dùng.

Chưa có tập ảnh gắn nhãn và số đo chuẩn để công bố phần trăm chính xác tăng thêm.
Điểm tổng hợp vẫn là chỉ số theo quy tắc, không phải phép đo chuẩn lâm sàng.
Model và trọng số điểm không được thay bằng một bộ chưa đánh giá.

Kiểm thử trình duyệt bổ sung các tình huống: hủy khi quyền còn chờ; tự nâng
Full HD và hiển thị kích thước thật; máy xử lý chậm; ảnh đủ sáng nhưng thiếu nét;
đổi camera trước/sau không giữ ID cũ; video đổi sang 1080×1920; nhận diện nối tiếp;
ảnh chụp 1920×1080 vẫn khớp điểm mốc khi lượt nhận diện kế tiếp đang chạy.

Trước khi phát hành rộng, cần thử trên Safari iPhone, Safari MacBook, Chrome
Android, webcam USB và Continuity Camera thật. Kiểm tra cho phép/từ chối quyền,
đổi camera, xoay máy, khóa/mở màn hình, tháo camera và ảnh trong các điều kiện sáng.
Phiên bản web dùng luồng video được trình duyệt cấp, chưa thu dữ liệu TrueDepth
hoặc ảnh tĩnh riêng qua ImageCapture.

Tài liệu đối chiếu: [MediaPipe Face Landmarker cho web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).
Các API camera: [capabilities](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/getCapabilities),
[applyConstraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/applyConstraints),
[requestVideoFrameCallback](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).

Các mức hoạt động, đo hiệu năng và lưu lựa chọn: [PERFORMANCE.md](PERFORMANCE.md).
