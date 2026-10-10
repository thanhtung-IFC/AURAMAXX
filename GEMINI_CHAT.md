# Chatbot tư vấn Gemini

Khung **Tư vấn AI** xuất hiện ở góc dưới bên phải trên hai trang phân tích.
Người dùng cần đăng nhập. Sau khi phân tích, chatbot có thể đính kèm báo cáo
gần nhất để giải thích các chỉ số và gợi ý cách tạo kiểu. Có thể bỏ chọn đính kèm.
Khi đổi kết quả hoặc chụp lại, cuộc trò chuyện được làm mới để tránh tư vấn theo
khuôn mặt trước đó. Hội thoại chỉ ở bộ nhớ trang, mất khi tải lại hoặc bấm xóa.

## Chạy trên máy tính

Trong PowerShell, nhập khóa vào biến môi trường rồi khởi động máy chủ trong
cùng cửa sổ. Không ghi khóa vào mã nguồn, HTML hoặc Git. Nhập ẩn để khóa không
nằm trong lịch sử lệnh:

```powershell
$geminiSecret = Read-Host 'Gemini API key' -AsSecureString
$env:GEMINI_API_KEY = [System.Net.NetworkCredential]::new('', $geminiSecret).Password
$env:GEMINI_MODEL = 'gemini-3.8-flash'
.\.venv\Scripts\python.exe -B server.py
```

Máy chủ đọc `GEMINI_API_KEY` và `GEMINI_MODEL` từ môi trường; model mặc định là
`gemini-3.8-flash`. Dự án không tự đọc file `.env`. Cần khởi động lại máy chủ
sau khi đổi biến môi trường. Không cần cài thêm thư viện Python cho chat.

## Render hoặc máy chủ riêng

Thêm `GEMINI_API_KEY` dưới dạng biến môi trường bí mật của dịch vụ backend,
và tùy chọn `GEMINI_MODEL=gemini-3.8-flash`. Khởi động lại/redeploy dịch vụ.
Không đặt khóa trong giá trị công khai của `render.yaml`.

## Dữ liệu và giới hạn

`POST /api/chat` dùng phiên đăng nhập, kiểm tra nguồn yêu cầu và CSRF như các API
hiện có. Payload gồm `message`, `history` (tối đa 6 cặp hỏi/đáp), `analysis`
(tùy chọn). Chỉ các nhóm chỉ số được chọn mới gửi sang Gemini; không gửi ảnh,
landmarks, tên tài khoản hoặc dữ liệu từ database. Người dùng vẫn cần tránh tự
nhập thông tin riêng tư vào câu hỏi. Mỗi tài khoản tối đa 8 yêu cầu/phút và một
yêu cầu đang xử lý. Các giới hạn này áp dụng trong một tiến trình máy chủ.

Gemini được hướng dẫn giải thích giới hạn số đo, không suy diễn tính cách hoặc
chẩn đoán bệnh từ khuôn mặt, không tự chỉ định thuốc hay can thiệp thẩm mỹ.
Đây là hướng dẫn cho mô hình, không đảm bảo mọi câu trả lời đều đúng.

Nếu chưa đặt khóa, chat báo chưa được cấu hình; lỗi hạn mức, kết nối và câu trả
lời bị chặn có thông báo riêng. Không trả lỗi thô của nhà cung cấp về trình duyệt.

Tài liệu API: https://ai.google.dev/api/generate-content
Model: https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash

## Kiểm tra

```powershell
.\.venv\Scripts\python.exe -B -m unittest discover -s tests -p 'test_gemini_chat.py'
node tests/check_chat_browser.cjs
```

Bài kiểm tra trình duyệt cần Microsoft Edge trên Windows (hoặc biến `EDGE_PATH`
trỏ tới executable Chromium tương thích). Câu trả lời AI được giả lập; không gọi
Gemini thật và không sử dụng khóa API. Kiểm tra API dùng database SQLite tạm.
