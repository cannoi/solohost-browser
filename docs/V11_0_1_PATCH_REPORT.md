# SoloHost Browser v11.0.1 — Patch Report

**Date:** 2026-11-24

## Yêu cầu → Kết quả

| # | Yêu cầu | Kết quả | Ghi chú |
|---|---------|---------|---------|
| 1 | Agent chạy → luôn Live | **Đã làm** | SoloHostLive.enable + agent-live-lock |
| 2 | Fix Live interaction | **Đã làm** | live-view rewrite + live-stream buttons |
| 3 | Bỏ Login desktop UI | **Đã làm** | Remove #btn-novnc (API kept) |
| 4 | Nút ngôn ngữ default EN | **Đã làm** | #btn-lang-toolbar EN/VI |
| 5 | Agent theo ngôn ngữ user | **Đã làm** | detectMessageLang + opts.lang |

## Chưa kiểm chứng E2E Docker
Live WS + CDP cần host có Playwright image.

## Không đổi
Architecture, media, workflows, scheduler, auth.
