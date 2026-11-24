# SoloHost Browser V11 — Phase 2 Report (Video & Media)

**Date:** 2026-11-24  
**Version:** 11.0.0-phase2  
**Result:** ĐẠT (trong phạm vi hợp lệ)

## 1. Mục tiêu
Phát media không nhúng được khi có quyền kỹ thuật + pháp lý; YouTube/DRM xử lý trung thực.

## 2. ĐÃ LÀM
- `lib/media/blocked-hosts.js` — chặn YouTube, googlevideo, Netflix, Disney+, … (cấu hình thêm qua env)
- `lib/media/media-sniffer.js` — nhận diện video/audio/HLS/DASH + DRM hints (`#EXT-X-KEY`, ContentProtection)
- `lib/media/media-cache.js` — cache đĩa `/app/data/media-cache`, LRU, TTL, hạn mức MB, SSRF (net-guard), từ chối host bị chặn / DRM / private mode / thiếu xác nhận user
- API:
  - `GET /api/media` — danh sách cache
  - `POST /api/media/cache` — `{ url, userConfirmed }` (bắt buộc xác nhận)
  - `GET /api/media/:id` — stream + **Range / 206**
  - `DELETE /api/media` — xóa cache
- YouTube player fallback: nhắc dùng Live (◉) hoặc Open ↗; **không tải YouTube**
- Test `test/media-policy.js` + `npm run test:phase2`

## 3. CHƯA LÀM / GIỚI HẠN
- HLS remux bằng ffmpeg → chỉ khi image có ffmpeg đầy đủ (Docker chưa bắt buộc cài thêm; degrade mềm)
- Gắn sniffer tự động vào mọi page Playwright (có API/module sẵn; hook session-wide có thể làm Phase 2b)
- UI player đầy đủ trong app (endpoint đã có — có thể `<video src="/api/media/:id">`)
- Không cache YouTube / DRM (đúng chính sách)

## 4. CHƯA KIỂM CHỨNG
- Tải mp4 công khai thật + phát Range trên Docker
- LRU khi vượt SOLOHOST_MEDIA_CACHE_MAX_MB

## 5. File mới/sửa
- `lib/media/*` (mới)
- `server-app.js` (routes media)
- `lib/adapters/youtube.js` (fallback copy)
- `test/media-policy.js`, `package.json`, `docs/V11_PHASE2_REPORT.md`

## 6. Test
- `node test/media-policy.js` → **PASS**
- `node --check` modules → **PASS**

## 7. Next
Phase 3 — mở rộng bộ công cụ Agent (tabs, screenshot, wait_for, …) là bước tối ưu tiếp theo cho “Agent thực dụng”.
