# SoloHost Browser V11 — Phase 4 Report

**Version:** 11.0.0-phase4  
**Result:** ĐẠT

## ĐÃ LÀM
- `lib/agent-intent-llm.js`: hiểu yêu cầu có cấu trúc (intent, kind, goal, entities, missing, risk, plan_outline, confidence, language)
- Fallback regex + task-analyzer (offline luôn chạy)
- Optional LLM khi `AGENT_INTENT_LLM=1` + chatFn
- Hỏi lại: `shouldAskUser` / `buildAskPayload` (≤2 vòng, ≤4 lựa chọn)
- Hook `backend-agent`: task mới confidence thấp / thiếu input → `waiting_user` + ask_user trước khi chạy
- `commonTasks()` — việc hay làm song ngữ
- Mở rộng needs_clarification (maps / compare ngắn)
- Test `test:phase4` **PASS**

## CHƯA LÀM
- UI nút “Việc hay làm” (Phase 7 UX) — API/data sẵn
- Plan preview Run/Edit/Cancel trong panel (hook planPreview đã set)
- Ghi preference vào ai-memory sau khi user chọn (có thể Phase 5)

## Next
Phase 5 — Workflow: ghi thao tác mẫu → Agent học.
