# SoloHost Browser V11 — Phase 3 Report (Agent tools)

**Version:** 11.0.0-phase3  
**Result:** ĐẠT

## ĐÃ LÀM
- Mở rộng `lib/agent-tools.js`: +10 tool  
  `tabs`, `screenshot`, `press_key`, `select`, `hover`, `wait_for`, `extract_table`, `extract_form`, `handle_dialog`, `save_file`
- Giữ 13 tool gốc + alias cũ (`read`→extract, `open_many`→navigate, …)
- `press_key` / `select` thành tool thật (không còn chỉ alias `type`)
- Risk class: `read | write | sensitive` (`riskOf`)
- Executor trong `agent-actions.js` cho mọi tool mới (Playwright khi có session)
- `extractTablesFromPlaywrightSession` / `extractFormsFromPlaywrightSession` (bỏ password fields)
- `save_file` → `/app/data/downloads` (mode 0600)
- Tests: `test:phase3` **PASS**

## CHƯA LÀM
- `upload` file từ máy user (cần UI chọn file — dời Phase 7 UX)
- `download` tự động bắt file Chromium (có thể gắn Phase 1b downloads path)
- Tab Playwright thật đa page (hiện tab logic ở task memory; đủ cho planner)

## CHƯA KIỂM CHỨNG
- screenshot / select / wait_for trên Chromium Docker thật

## Next
Phase 4 — Intent LLM + hỏi lại tự nhiên (phổ thông hóa Agent).
