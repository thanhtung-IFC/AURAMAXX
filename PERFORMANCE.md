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

## Rà soát mã nguồn ngày 15/10/2026

Đo trang chủ khi chưa đăng nhập bằng Edge headless, hồ sơ trình duyệt mới và
backend SQLite tạm. Bản trước thay đổi lấy từ commit `d89a4b7`; hai lần đo dùng
cùng máy và cùng kịch bản. Chỉ tính JavaScript nội bộ và yêu cầu API của ứng dụng,
không tính phông chữ bên ngoài, CSS hoặc ảnh.

| Chỉ số tải trang chủ | Trước | Sau |
| --- | ---: | ---: |
| Số tệp JavaScript | 26 | 11 |
| JavaScript sau giải nén | 210.960 byte | 44.176 byte |
| JavaScript truyền qua mạng | 210.960 byte | 15.343 byte |
| Yêu cầu API ban đầu | 11 | 3 |

Lượng JavaScript truyền ban đầu giảm khoảng 93%, nhờ tải chức năng theo trang
và nén gzip. Đây là số đo dung lượng tải trên môi trường local, không phải mức
tăng FPS hoặc thời gian đáp ứng của máy chủ Supabase/Render.

Các thay đổi:

- Face Lab, Arena, Health Hub, Tiến trình và Aura AI tải mã khi mở lần đầu.
  Mỗi trang chỉ khởi tạo một lần; rời trang trong lúc tải không khởi tạo trang
  đã ẩn. Lỗi tải module có nút tải lại trang, giữ địa chỉ trang hiện tại.
- Tài nguyên web được nén gzip ở mức 5. API được chuyển tiếp trực tiếp để giữ
  luồng chat và tải bản sao lưu. Tài nguyên tĩnh dùng ETag và yêu cầu xác thực
  lại cache; HTML và API giữ `no-store` để tránh dùng dữ liệu riêng tư cũ.
- Bộ định tuyến phát sự kiện khi trang thực sự thay đổi. Bỏ lượt xử lý menu
  di động và lượt quét hiệu ứng DOM trùng; bỏ tệp trung gian `face-lab.js`.
- Nhật ký chỉ tải lại một lần sau khi lưu/xóa. Hủy yêu cầu đọc nhật ký, tiến
  trình và Arena cũ khi chuyển trang; bỏ phản hồi đến muộn. Khi đổi tài khoản,
  xóa nội dung riêng tư ngay và chỉ tải lại các chức năng đang mở.
- Các truy vấn Arena độc lập chạy song song; đổi tab bảng xếp hạng hủy yêu
  cầu trước. Lỗi tải thêm không làm nhảy qua một trang kết quả.
- Trạng thái tính năng dùng một truy vấn thay cho năm truy vấn. Tổng số bản
  ghi tiến trình được tính từ kết quả nhóm đã có, bỏ một truy vấn đếm trùng.
- HTTP `204`, `205` và `HEAD` không đọc JSON từ nội dung rỗng; xóa nhật ký
  thành công sẽ cập nhật giao diện bình thường.

Đã kiểm tra: 305 bài Python, trong đó 221 bài đạt và 84 bài bỏ qua theo môi
trường tích hợp; 9 kịch bản Node về camera, chụp ảnh, tài khoản, giao diện và
database; ba kịch bản trình duyệt về hiệu suất, Aura AI và website hợp nhất.
Camera/model/nhà cung cấp AI trong các kịch bản giao diện dùng dữ liệu giả lập;
API, đăng nhập, nhật ký, thuật toán phân tích Python và bản sao lưu dùng backend
thật với SQLite tạm. Không sửa dữ liệu hoặc triển khai lên máy chủ đang dùng.

Chạy lại kiểm tra hiệu suất và các trường hợp tải chậm, lỗi tải module, chuyển
trang nhanh, phản hồi tài khoản cũ, lưu/xóa nhật ký:

```powershell
node tests/browser_performance_smoke.cjs
.\.venv\Scripts\python.exe -X utf8 -B -m unittest tests.test_web_performance tests.test_api
```

Kết quả đo mới nằm trong `.test-output/performance-after.json`. Nếu renderer
Edge không khởi động trong môi trường kiểm thử bị sandbox, có thể đặt
`$env:EDGE_NO_SANDBOX="1"` cho riêng kịch bản hiệu suất với hồ sơ trình duyệt
tạm. Cấu hình này không tác động đến website hoặc trình duyệt thường dùng.
