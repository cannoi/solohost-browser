# SoloHost Browser V11 — Phase 1 / 1b Report

**Date:** 2026-11-24  
**Version:** 11.0.0-phase1b  
**Result:** Phase 1 core + 1b delivered (Live, cookies, dialogs, session expiry signals)

## 1. Mục tiêu & kết quả

Đóng **Vấn đề 2** (đăng nhập / phiên / tương thích) ở mức thực dụng.

**Kết quả: Đạt phần lớn.** Live mode dùng được, cookie manager an toàn, dialog JS hiện trong UI app, phát hiện màn hình đăng nhập / hết hạn phiên.

## 2. ĐÃ LÀM

### Phase 1 (trước)
- Live CDP + WebSocket, client input đầy đủ (chuột/cuộn/phím/IME/paste)
- Toggle ◉ + overlay canvas
- Cookie domains API + UI (không lộ giá trị)

### Phase 1b (phiên này)
- **JS Dialogs**: `page.on('dialog')` → queue → UI modal (alert/confirm/prompt) → accept/dismiss qua API. Timeout 60s → dismiss an toàn.
- **API**: `GET .../dialogs`, `POST .../dialogs/:id`, `GET .../session-status`
- **Session expiry signal**: `detectSessionExpiry(url, title)` — nhận login path / title / “session expired” → toast “Cần đăng nhập lại” + nút mở Live
- **Popup**: giữ cơ chế absorb vào tab opener (đã có); dialog hook gắn cùng session create
- Poll client 2.5s cho dialog + session-status

## 3. CHƯA LÀM / DỜI

| Hạng mục | Ghi chú |
|---|---|
| Popup thành tab SoloHost riêng | Hiện absorb vào opener (ổn cho OAuth phổ biến) |
| beforeunload UX riêng | Dùng chung modal |
| Upload/download UI | Phase 2 / sau |
| Auto-switch Live khi gặp login | Có toast gợi ý mở Live; chưa tự bật |
| Profile backup mã hoá | Tuỳ chọn Phase sau |

## 4. CHƯA KIỂM CHỨNG

- Dialog thật trên trang `alert()` / `confirm()` / `prompt()` trong Docker
- OAuth popup Google/GitHub absorb + còn đăng nhập sau restart
- Toast session-status trên redirect login thật

## 5. File đổi (1b)

- `lib/engine/playwright-engine.js` — attachDialogHandling, resolveDialog, getPendingDialogs, detectSessionExpiry
- `server-app.js` — routes dialogs + session-status
- `public/index.html` — modal + toast
- `public/style.css` — styles
- `public/app.js` — poll + UI controllers
- `package.json` — 11.0.0-phase1b
- `docs/V11_PHASE1_REPORT.md`

## 6. Test

- `node --check` các file đổi: PASS
- Baseline / test:phase1: giữ từ trước (PASS)
- E2E dialog + OAuth: **CHƯA KIỂM CHỨNG** trên Docker

## 7. Next

Phase 1/1b đủ để chuyển **Phase 2 — Video & Media** (trong khuôn khổ hợp lệ: không tải YouTube, không DRM).

