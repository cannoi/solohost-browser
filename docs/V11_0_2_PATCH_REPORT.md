# SoloHost Browser v11.0.2 — Patch Report

**Date:** 2026-11-24

## Requests → Results

| # | Request | Result | Notes |
|---|---------|--------|-------|
| 1 | Full English + Vietnamese | **Done** | Expanded `i18n.js` dictionary; menu/chat/agent keys; default EN; placeholders EN-first |
| 2 | Cannot click — only text select | **Done (client)** | `body.live-on` forces iframe `pointer-events:none`; Live canvas `pointer-events:auto`; user-select none on canvas; unlock agent lock on end |
| 3 | App / Agent very slow | **Done (tune)** | Live screencast lower quality + every 2nd frame; mouse-move throttle ~30fps; agent poll 280–400ms; nav timeout 18s; shorter post-nav waits |

## Files changed

- `public/i18n.js` — full EN/VI strings
- `public/index.html` — data-i18n, lang=en defaults
- `public/style.css` — live-on / click hit-testing
- `public/app.js` — body.live-on, iframe pointerEvents
- `public/live-view.js` — move throttle
- `public/browser-agent.js` — faster poll, EN status
- `public/ai-panel.js` — unlock on agent end
- `lib/engine/live-stream.js` — perfQuality snappier
- `lib/engine/playwright-engine.js` — timeouts
- `lib/backend-agent.js` — shorter sleep
- `package.json` → 11.0.2

## Not done / limits

- Full E2E click test needs Docker Chromium on your host
- Agent LLM latency is network/model bound (not fully controllable here)
- Deep rewrite of DOM Bridge click path **not** changed (Live is the full-interaction path)

## Unchanged on purpose

Media policy, workflows, scheduler, auth, core architecture.
