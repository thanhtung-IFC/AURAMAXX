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

## Kiểm tra API

```powershell
# Chỉ kiểm tra cấu hình; không gửi yêu cầu tới nhà cung cấp.
.\.venv\Scripts\python.exe -B scripts/check_aura_api.py

# Kiểm tra kết nối thật bằng một câu hỏi ngắn; có dùng hạn mức API.
.\.venv\Scripts\python.exe -B scripts/check_aura_api.py --live
```

Lệnh không in API key và không ghi hội thoại vào database. `GET /api/aura/status`
chỉ phản ánh cấu hình máy chủ; khóa và quyền model được xác minh khi thực sự gọi
nhà cung cấp. Giao diện chỉ báo **AI đã kết nối** sau một lượt chat thành công.

- `POST /api/aura/chat`: SSE, nhận `message`, `conversation_id` tùy chọn và
  `analysis` tùy chọn. Dùng phiên đăng nhập, CSRF, quyền đồng ý và giới hạn lượt.
- Sự kiện `delta` chứa `text`; `done` chứa `conversation_id`, `provider`, `model`;
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
node tests/browser_aura_smoke.cjs
node tests/browser_unified_smoke.cjs
```

Kiểm thử dùng câu trả lời giả lập và SQLite tạm, không dùng khóa thật. Kiểm thử
trình duyệt cần Edge hoặc biến `EDGE_PATH` trỏ tới Chromium. Ảnh giao diện được
lưu ở `.test-output/aura-ai-*.png`.

Định dạng API được đối chiếu với [OpenAI Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events)
và [Gemini streamGenerateContent](https://ai.google.dev/api/generate-content#method:-models.streamgeneratecontent).
