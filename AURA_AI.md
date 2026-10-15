# AURA AI

AURA AI ở `/#aura-ai` dùng cùng API chat, lịch sử tài khoản và quyền đồng ý cho
OpenAI hoặc Gemini. Khóa chỉ nằm ở backend; trình duyệt không gọi trực tiếp nhà
cung cấp AI. API cũ trong `gemini_chat.py` được giữ để tương thích với VisionFace.

## Cấu hình

Trong `.env` ở thư mục gốc, chọn **một** cấu hình. Không commit khóa thật.

```dotenv
AI_PROVIDER=openai
AI_API_KEY=<khóa OpenAI của bạn>
AI_MODEL=gpt-6-astra
```

Hoặc dùng chatbot Gemini:

```dotenv
AI_PROVIDER=gemini
GEMINI_API_KEY=<khóa Gemini của bạn>
AI_MODEL=gemini-3.8-flash
```

Với Gemini, `AI_API_KEY` cũng được hỗ trợ và được ưu tiên hơn `GEMINI_API_KEY`.
Nếu không đặt `AI_MODEL`, Gemini dùng `GEMINI_MODEL` hoặc mặc định
`gemini-3.8-flash`. Chọn model mà tài khoản nhà cung cấp có quyền truy cập.
Không để model OpenAI khi chuyển `AI_PROVIDER` sang Gemini.

Backend tự đọc `.env`; biến môi trường đã đặt được ưu tiên. Khởi động lại bằng
`.\.venv\Scripts\python.exe run_web.py`, đăng nhập, bật đồng ý **AURA AI** trong
**My Aura**, rồi mở **Aura AI**. Chỉ bật đính kèm Face Lab khi muốn gửi số đo.

## Tốc độ và chất lượng trả lời

Trong ô soạn tin có **Cách trả lời**; mặc định là **Cân bằng**. Lựa chọn chỉ
áp dụng cho câu hỏi gửi tiếp theo, không lưu vào bộ nhớ trình duyệt:

| Lựa chọn | Cách trả lời | Gemini 3.8 Flash |
| --- | --- | --- |
| Nhanh | Ngắn, trực tiếp, ưu tiên bước cần làm ngay | Thinking `low` |
| Cân bằng | Giải thích vừa đủ và bước thực hiện cụ thể | Thinking `medium` |
| Phân tích kỹ | Kiểm tra giả định, giải thích lựa chọn và đánh đổi | Thinking `high` |

OpenAI và các dòng Gemini khác nhận cùng hướng dẫn về cách trả lời, giữ nguyên
tham số suy luận mặc định của model. Không tự đổi model đang cấu hình. Chế độ
Nhanh phù hợp câu hỏi đơn giản; với câu hỏi phức tạp, dùng Cân bằng hoặc Phân
tích kỹ. Các mức suy luận của Gemini 3.8 Flash được đối chiếu với
[tài liệu Google](https://ai.google.dev/gemini-api/docs/generate-content/thinking).

Backend dùng chung pool HTTP trong vòng đời ứng dụng, đóng khi server dừng;
khóa, timeout và nội dung của từng yêu cầu được truyền riêng. Lịch sử gửi AI
giới hạn 12 tin / 12.000 ký tự, giữ nguyên các lượt hỏi/đáp gần nhất trong giới
hạn thay vì cắt mất đầu câu. Câu hỏi hiện tại và số đo đã lọc được giữ nguyên.
Hướng dẫn yêu cầu ưu tiên đính chính mới nhất, phân biệt dữ liệu với suy đoán,
không dùng câu trả lời AI cũ làm bằng chứng và hỏi lại khi thiếu thông tin quan trọng.

Giao diện tải kiểm tra dịch vụ/tài khoản/đồng ý đồng thời, thêm chữ theo khung
hình và dựng lịch sử theo một lượt. `done` trả kèm tiêu đề và thời gian cập nhật,
giúp mở lại ô nhập ngay mà không phải chờ tải danh sách hội thoại thêm lần nữa.
Đây là tối ưu đường truyền và hiển thị; tốc độ sinh chữ vẫn phụ thuộc model,
mạng và máy chủ Render. Kiểm thử giả lập không chứng minh độ chính xác thực tế.

`AI_TIMEOUT_SECONDS` (mặc định 45) là timeout mạng của mỗi yêu cầu. OpenAI dùng
`AI_MAX_OUTPUT_TOKENS` (mặc định 1200). Gemini dùng riêng
`AI_GEMINI_MAX_OUTPUT_TOKENS` (mặc định 8192, tối đa 16384), vì ngân sách này
bao gồm cả suy luận và phần trả lời. Trần lớn hơn tránh cắt hết phần trả lời
trước khi suy luận xong, nhưng có thể dùng thêm hạn mức API, nhất là Phân tích
kỹ. Có thể giảm biến này trên Render để khống chế chi phí; đáp án vượt trần vẫn
báo chưa hoàn tất và không lưu như câu trả lời đầy đủ. Giới hạn văn bản đầu ra
vẫn là 16.000 ký tự. Không cache câu trả lời cá nhân giữa các tài khoản.

## Quản lý hạn mức trong Admin

Đăng nhập Admin, mở `/manage` → **Hạn mức AI**, hoặc nhấn **Hạn mức AI**
trên dòng tài khoản ở **Tài khoản & admin**.

- Xem lượt đã dùng hôm nay/tháng này, hạn mức và trạng thái từng tài khoản;
  tìm theo tên, nhấn **Làm mới thống kê** để lấy số mới nhất.
- Admin trung tâm mở **Hạn mức mặc định & trần toàn hệ thống** để đặt lượt
  ngày/tháng/phút mặc định và trần tổng ngày/tháng dùng chung cho mọi tài khoản.
- **Điều chỉnh** → bật **Dùng hạn mức riêng** để đặt mức cho một tài khoản.
  Bỏ chọn rồi lưu để trở về mặc định. **Tạm dừng AI / Mở lại AI** chỉ đổi quyền
  dùng AI, không khóa tài khoản đăng nhập.
- Để trống hạn mức ngày/tháng nghĩa là không giới hạn; `0` không cấp lượt.
  Mặc định ban đầu không giới hạn ngày/tháng, giữ mức phút từ
  `AI_RATE_LIMIT_PER_MINUTE` (8 nếu không cấu hình).
- Admin phụ xem thống kê và quản lý hạn mức người dùng thường. Chỉ admin
  trung tâm sửa mặc định, trần chung và hạn mức của tài khoản admin.

Ngày/tháng làm mới lúc 00:00 theo giờ Việt Nam. Một yêu cầu hợp lệ được nhận
để gọi AI tiêu thụ một lượt, bao gồm lỗi nhà cung cấp và người dùng dừng;
yêu cầu bị chặn vì thiếu đồng ý, sai hội thoại, hết hạn mức hoặc cấu hình AURA
chưa sẵn sàng không được tính vào lượt AURA. Bộ đếm bắt đầu khi triển khai
tính năng, không suy ngược từ các cuộc trò chuyện trước đó.

Hạn mức được kiểm tra và ghi nhận trong một giao dịch trước khi gọi nhà cung
cấp, không giữ khóa ghi database trong thời gian AI trả lời. Gửi đồng thời
không vượt được giới hạn. Cả `/api/aura/chat`, `/api/aura/messages`,
`/api/assistant/messages` và chat tương thích `/api/vision/chat` đi qua bộ đếm.
Trình kiểm tra API chạy trực tiếp từ CLI không tính vào hạn mức người dùng.
Máy chủ VisionFace độc lập `server.py` không dùng trang Admin của ứng dụng hợp nhất.

Xóa lịch sử chat không trả lại lượt. Xóa tài khoản sẽ gỡ liên kết người dùng
khỏi các lượt đã ghi nhận, nhưng giữ số lượt ẩn danh để trần toàn hệ thống
không bị làm mới bởi việc tạo/xóa tài khoản. Các thay đổi hạn mức có nhật ký
quản trị và được lưu cùng giao dịch; sao lưu bao gồm chính sách và bộ đếm.

Đây là hạn mức **theo lượt của ứng dụng**, không phải token, số dư thanh toán
hay quota dự án Google/OpenAI. Hết quota của nhà cung cấp vẫn có thể xảy ra
trước hạn mức ứng dụng. Không có khóa API hoặc nội dung chat trong bộ đếm.

Các bảng `ai_quota_settings`, `ai_user_quotas`, `ai_usage_events` và index được
tạo tự động khi backend khởi động sau deploy, giữ nguyên dữ liệu hiện có.
Hỗ trợ schema SQLite/PostgreSQL và script SQL Server của dự án.

API Admin: `GET /api/manage/ai/usage`, `PATCH /api/manage/ai/settings`,
`PATCH` hoặc `DELETE /api/manage/accounts/{account_id}/ai-quota`.
Các lệnh ghi cần phiên admin và CSRF. `GET /api/aura/quota` chỉ trả hạn mức
và lượt dùng của chính tài khoản đăng nhập. `PATCH` nhận đầy đủ chính sách;
các trường ngày/tháng có thể là `null`, `enabled` dùng để cho phép/tạm dừng
trong hạn mức riêng. Trần dùng chung luôn áp dụng kể cả tài khoản có mức riêng.

## Kiểm tra API

```powershell
# Chỉ kiểm tra cấu hình; không gửi yêu cầu tới nhà cung cấp.
.\.venv\Scripts\python.exe -B scripts/check_aura_api.py

# Kiểm tra kết nối thật bằng một câu hỏi ngắn; có dùng hạn mức API.
.\.venv\Scripts\python.exe -B scripts/check_aura_api.py --live

# Đo thời gian nhận chữ đầu tiên và tổng thời gian với chế độ Nhanh.
.\.venv\Scripts\python.exe -B scripts/check_aura_api.py --live --style quick
```

Lệnh không in API key và không ghi hội thoại vào database. `GET /api/aura/status`
chỉ phản ánh cấu hình máy chủ; khóa và quyền model được xác minh khi thực sự gọi
nhà cung cấp. Giao diện chỉ báo **AI đã kết nối** sau một lượt chat thành công.

- `POST /api/aura/chat`: SSE, nhận `message`, `conversation_id` tùy chọn và
  `analysis` tùy chọn; `response_style` là `quick`, `balanced` (mặc định) hoặc
  `thorough`. Dùng phiên đăng nhập, CSRF, quyền đồng ý và giới hạn lượt.
- Sự kiện `delta` chứa `text`; `done` chứa `conversation_id`, `title`,
  `updated_at`, `provider`, `model`;
  `error` chứa `message`, `kind`, `status` và không lưu lượt chat thất bại.
- `/api/aura/conversations`: xem, tạo hoặc xóa lịch sử riêng của tài khoản.
- `/api/aura/conversations/{id}/messages`: mở lại nội dung đã lưu.

Chỉ lưu cặp hỏi/đáp khi nhà cung cấp báo hoàn tất. Luồng bị ngắt, hết token hoặc
bị chặn không được lưu thành câu trả lời hoàn chỉnh. Việc dừng sát thời điểm máy
chủ hoàn tất có thể xảy ra sau khi lượt chat đã lưu; mở lại lịch sử để đối chiếu.
Báo cáo được lọc, chỉ gửi khi chọn đính kèm; ảnh và landmark không được gửi.
Số đo chỉ áp dụng cho lượt gửi đó; khi hỏi tiếp về số đo hãy giữ lựa chọn đính kèm.

## Kiểm thử

```powershell
.\.venv\Scripts\python.exe -B -m unittest tests.test_ai_service tests.test_aura_chat tests.test_vision_context tests.test_frontend tests.test_api
.\.venv\Scripts\python.exe -B -m unittest tests.test_ai_quota tests.test_admin_atomic_audit
node tests/browser_aura_smoke.cjs
node tests/browser_unified_smoke.cjs
```

Kiểm thử dùng câu trả lời giả lập và SQLite tạm, không dùng khóa thật. Kiểm thử
trình duyệt cần Edge hoặc biến `EDGE_PATH` trỏ tới Chromium. Ảnh giao diện được
lưu ở `.test-output/aura-ai-*.png`.

Định dạng API được đối chiếu với [OpenAI Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)
và [Gemini streamGenerateContent](https://ai.google.dev/api/generate-content#method:-models.streamgeneratecontent).
