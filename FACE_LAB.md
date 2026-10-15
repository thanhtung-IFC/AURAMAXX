# Face Lab: camera và chất lượng phép đo

## Thay đổi

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
node tests/check_face_worker_browser.cjs
node tests/browser_unified_smoke.cjs

# Kiểm tra model MediaPipe thật, dùng ảnh trống; cần kết nối CDN/Google.
$env:FACE_TEST_REAL_MODEL='1'
node tests/check_face_worker_browser.cjs
Remove-Item Env:FACE_TEST_REAL_MODEL
```

Các bài hình học dùng dữ liệu tổng hợp để kiểm tra bất biến theo độ phân giải,
xoay trong mặt phẳng và vị trí đồng tử. Kiểm thử trình duyệt dùng camera/landmark
giả lập; phép kiểm tra model thật xác nhận khởi tạo, truyền ảnh, VIDEO/IMAGE và
hủy tác vụ, không đo độ chính xác nhận diện trên khuôn mặt thật.

Chưa có tập ảnh gắn nhãn và số đo chuẩn để công bố phần trăm chính xác tăng thêm.
Điểm tổng hợp vẫn là chỉ số theo quy tắc, không phải phép đo chuẩn lâm sàng.
Model và trọng số điểm không được thay bằng một bộ chưa đánh giá.

Tài liệu đối chiếu: [MediaPipe Face Landmarker cho web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).
