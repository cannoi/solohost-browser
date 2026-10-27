# Mô phỏng sử dụng Browser Agent — Báo cáo kết quả

## Cách mô phỏng
Sandbox này không có mạng nên không thể `npm install` (Express/Playwright) hay chạy `server.js` thật, cũng không có API key AI thật để test. Thay vào đó tôi đã:
1. Đọc kiến trúc thật trong `docs/AGENT.md` và các báo cáo version liên quan (`V10.26` → `V10.33.0_LEAN_AGENT`).
2. **Gọi trực tiếp hàm lõi `planStep()`/`heuristicPlan()`** trong `lib/browser-agent.js` bằng Node thật (không phải đọc code suông) với đúng các câu lệnh mẫu trong tài liệu của chính app, để xem bộ não của Agent thực sự quyết định hành động gì.
3. Chạy toàn bộ test suite không cần Playwright có sẵn trong repo (`security`, `agent-web`, `agent-actions`, `agent-report`, `config`, `agent-unify`, `vietnamese-input`, `proxy-manager`, `personal-browser-signals`, `keep-engine`, `chrome-toolbar`) — tất cả đều PASS, cả trước và sau khi sửa.

## Kết quả mô phỏng

### ✅ Điểm mạnh xác nhận được (qua test thật, không phải đọc code)
- Kiến trúc an toàn: Agent chạy phía backend, không tự ý điền mật khẩu/OTP/thẻ, chặn SSRF, có bước xác nhận cho hành động nhạy cảm, có cơ chế chống prompt-injection từ nội dung trang web — tất cả đều có test riêng và PASS.
- **Tự nhận diện ngôn ngữ từ chính câu lệnh** (không cần cài đặt thủ công): gõ tiếng Việt có dấu sẽ tự trả lời tiếng Việt, gõ tiếng Anh sẽ trả lời tiếng Anh — đã xác nhận đúng trong `public/browser-agent.js` (`resolveLang`). Khớp đúng mục tiêu "trả lời theo ngôn ngữ người dùng".

### 🐞 Lỗi thật tìm thấy — ĐÃ SỬA trong phiên này
Khi gọi hàm thật với **chính 2 câu lệnh mẫu trong tài liệu `docs/AGENT.md` của app** lúc chưa cấu hình AI (chế độ offline — cũng là tình trạng CI thật của project theo `agent-benchmark-latest.json`: *"AI not configured in this environment"*):

- `"tìm phim hay trên youtube và mở video đầu tiên"` → **SAI**: thay vì tìm đúng trên YouTube, bộ xử lý offline gộp cả câu thành chuỗi tìm kiếm vô nghĩa trên DuckDuckGo.
- Nguyên nhân: quy tắc nhận diện câu lệnh dùng `\b` (ranh giới từ) của JavaScript — nhưng `\b` chỉ nhận diện ký tự ASCII, **không nhận diện đúng chữ có dấu tiếng Việt** như "à" trong "và", nên câu lệnh có thêm vế sau ("và mở video đầu tiên") bị tuột khỏi quy tắc đúng.

**Đã sửa**: thay `\b` bằng lookahead (`(?=\s|$)`), hoạt động đúng với cả tiếng Việt có dấu. Xác nhận lại bằng cách gọi lại đúng hàm thật — giờ ra đúng `engine: youtube, query: "phim hay"`. Không đụng đến phần AI thật/luồng có AI, chỉ sửa đúng 1 dòng trong nhánh offline-heuristic.

### ⚠️ Giới hạn thật tìm thấy — CHƯA SỬA (cần quyết định hướng đi, không tự ý làm để tránh rủi ro)
1. **Luồng AI thật chưa từng được CI của chính project kiểm thử** — file benchmark của project ghi rõ "AI not configured... SoloHost production not tested in this CI sandbox." Nghĩa là toàn bộ khả năng suy luận nhiều bước thực sự (không phải offline heuristic) chưa có test tự động nào xác nhận hoạt động đúng.
2. **Thư viện "playbook" chuyên biệt cực kỳ hẹp**: chỉ có đúng 2 cái — so sánh giá điện thoại ở vài nhà bán lẻ Việt Nam, và tóm tắt tin tức. Không có playbook cho: mua hàng/thanh toán, đặt vé/đặt phòng, điền form, email, bản đồ/chỉ đường — những tác vụ phổ thông nhất người dùng thực sự cần một "Browser Agent mạnh mẽ".
3. **Chế độ offline chỉ làm được đúng 1 bước đơn giản** (theo đúng thiết kế, có ghi rõ trong code) — câu lệnh nhiều bước như "...và mở video đầu tiên" sẽ KHÔNG BAO GIỜ mở video, dù đã sửa lỗi tìm sai ở trên. Đây là giới hạn chủ đích khi chưa cấu hình AI, không phải bug — nhưng người dùng phổ thông sẽ không biết điều này trừ khi báo rõ.

## Vì sao chưa tự làm "Agent mạnh mẽ hơn" trong phiên này
Phần lớn khoảng trống ở trên (mở rộng playbook, cải thiện suy luận nhiều bước, tăng độ bao phủ test với AI thật) đòi hỏi quyết định kiến trúc lớn và rủi ro phá vỡ một hệ thống đã được rà soát bảo mật kỹ (nhiều báo cáo an toàn/hang-fix/session-fix qua các bản 10.26–10.33). Theo đúng nguyên tắc "hành động tối thiểu, không đoán mò, không phá app", tôi chỉ sửa lỗi cụ thể đã **xác minh bằng cách chạy code thật**, và đề xuất prompt dưới đây để bạn (hoặc AI Code có quyền truy cập đầy đủ môi trường) thực hiện phần nâng cấp lớn hơn một cách có kiểm soát.
