# 🌟 VisionFace Pro - AI Facial Biometrics & Aesthetic Diagnostic System

Hệ thống nhận diện khuôn mặt thời gian thực, kiểm tra thực thể sống (**Liveness Verification Anti-Spoofing**), và chẩn đoán định lượng thẩm mỹ nhân trắc học (**Anthropometric Aesthetic Engine**) đạt chuẩn khoa học khách quan (không nịnh nọt).

Hệ thống hoạt động theo kiến trúc **Hybrid**:
- **Chạy trực tiếp 100% trên Trình duyệt Web (Client-Side)** thông qua MediaPipe Face Mesh + Client Aesthetic Engine (Hoạt động 24/7 trên **GitHub Pages** không cần bật máy tính cá nhân).
- **Python Backend Engine (REST API)**: Phục vụ phân tích nhân trắc học nâng cao, xử lý ma trận điểm mốc và phân tích ROI cấu trúc da, có thể triển khai lên Cloud (Render, Railway, Hugging Face Spaces) hoàn toàn miễn phí.

---

## 🚀 Các Tính Năng Nổi Bật

1. **Tối Ưu Hóa Truy Cập Phần Cứng Camera Rời (USB Cam)**:
   - Tự động nhận diện webcam USB rời (`[USB Cam Ngoài]`) so với webcam laptop.
   - Cơ chế Fallback 4 cấp độ chống lỗi `OverconstrainedError` trên mọi thiết bị UVC (Logitech, OBS Cam, DroidCam,...).
   - Hỗ trợ rút/cắm nóng USB camera động (`devicechange` debouncing).
   - Giải phóng tài nguyên bất đồng bộ (250ms delay) chống lỗi khóa cổng DirectShow trên Windows.

2. **Chẩn Đoán Thẩm Mỹ & Nhân Trắc Học Khách Quan (Không Nịnh Nọt)**:
   - **Thang điểm Gauss (Gaussian Bell Curve)**: Điểm thực tế của người bình thường từ 60 - 75/100, loại bỏ hoàn toàn việc tâng bốc điểm ảo 90 - 95%.
   - **Độ Cân Đối Khuôn Mặt (Symmetry)**: Đo sai lệch pixel từng ngũ quan, góc nghiêng trục mắt (`Eye Level Tilt`), chỉ rõ bên lệch (thói quen nhai một bên / nằm nghiêng).
   - **Quy Tắc 3 Tầng (Rule of Thirds) & fWHR**: Đánh giá trán cao/dô, trán ngắn, cằm lẹm, cằm dài.
   - **Tỷ Lệ Mũi (Nose Analysis)**: Đo tỷ lệ cánh mũi so với khoảng cách hai hốc mắt trong, cảnh báo độ vẹo vách ngăn / lệch sống mũi.
   - **Đường Viền Hàm & Cằm (Jawline & Chin)**: Đo góc quai hàm Gonial (chuẩn 120°–130°), phân tích cằm lẹm, hàm bạnh vuông hay thon gọn.
   - **Chẩn Đoán Tình Trạng Da (Skin Health ROI)**: Quét pixel thực tế vùng má, trán và bọng mắt dưới để phát hiện quầng thâm mắt thực tế, bóng dầu chữ T và độ sần sùi lỗ chân lông.
   - **Tư Vấn Tạo Kiểu Tóc (Stylist Corrective Advice)**: Gợi ý kiểu tóc nam & nữ bù trừ khuyết điểm dáng mặt.

3. **Chống Gian Lận Thực Thể Sống (Anti-Spoofing Liveness)**:
   - Theo dõi chỉ số chớp mắt EAR (Eye Aspect Ratio).
   - Theo dõi khẩu độ há miệng MAR (Mouth Aspect Ratio).
   - Ước tính góc quay đầu 3D (Yaw, Pitch).
   - Thử thách ngẫu nhiên 3 bước chống ảnh in hoặc phát lại video.

---

## 🌐 Triển Khai Chạy 24/7 Không Phụ Thuộc Máy Tính Cá Nhân

### Cách 1: Chạy Trực Tiếp Qua GitHub Pages (Miễn phí 100%, 0 server cần bật)
1. Push mã nguồn lên GitHub Repository của bạn.
2. Vào **Settings** của repository -> Chọn tab **Pages**.
3. Tại mục **Build and deployment** -> **Source**: Chọn `Deploy from a branch`.
4. Chọn nhánh `main` (hoặc `master`) và thư mục `/(root)` -> Bấm **Save**.
5. Sau 1 phút, trang web sẽ online tại: `https://<ten-user>.github.io/<ten-repo>/`
6. Trang web có sẵn **Client-Side AI Engine** tích hợp sẵn trong trình duyệt, bạn có thể bật camera trên điện thoại hoặc máy tính khác để sử dụng 24/7 mà không cần mở máy tính cá nhân.

---

### Cách 2: Triển Khai Python Backend Lên Cloud 24/7 (Render / Railway / Hugging Face)

Nếu bạn muốn có thêm máy chủ Python chạy liên tục trên mạng để lưu trữ cơ sở dữ liệu khuôn mặt và xử lý Numpy trên đám mây:

#### Triển khai lên Render.com (Miễn phí):
1. Đăng ký tài khoản tại [Render.com](https://render.com).
2. Chọn **New** -> **Web Service** -> Kết nối với GitHub Repository của bạn.
3. Render sẽ tự động nhận diện tệp `render.yaml` và `requirements.txt`:
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python server.py`
4. Bấm **Deploy**. Bạn sẽ nhận được đường dẫn API HTTPS (ví dụ: `https://visionface-ai.onrender.com`).
5. Copy đường dẫn này dán vào giao diện web để kết nối backend đám mây 24/7!

---

## 💻 Chạy Cục Bộ (Localhost Development)

Nếu muốn chạy trên máy tính cá nhân để thử nghiệm:

```bash
# 1. Cài đặt thư viện Python
pip install -r requirements.txt

# 2. Khởi chạy máy chủ AI Server
python server.py
```

Truy cập trên trình duyệt: `http://localhost:8000`
