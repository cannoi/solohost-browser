# SoloHost Browser v11.0.0

**Simple · Private · Lightweight browser for SoloHost / Pi Network**

A headless Chromium browser hub with DOM Bridge, Live interactive mode, AI Browser Agent, media cache (legal bounds), workflows, and schedules.

## Highlights (v11)

- **Live mode (◉)** — full mouse/keyboard interaction via CDP canvas
- **Signed-in sites** — cookie domains list, clear per site, optional import/export
- **AI Agent** — expanded tools (tabs, wait_for, select, screenshot, …), intent understanding + clarify
- **Media** — cache direct media with Range playback; **never downloads YouTube/DRM**
- **Workflows** — record → save → replay plan (secrets never stored)
- **Scheduler** — daily/weekly/once (runs only while the app is active)
- **Bilingual UI** — EN / VI (`public/i18n.js`)

## Quick start (Docker)

```bash
docker compose up -d
# open http://localhost:8080
```

Set `BROWSER_ACCESS_PASSWORD` in environment or SoloHost config.

## Environment (selected)

| Variable | Meaning |
|----------|---------|
| `BROWSER_ACCESS_PASSWORD` | Gate password |
| `SOLOHOST_MEDIA_CACHE_MAX_MB` | Media cache size (default 512) |
| `SOLOHOST_MEDIA_BLOCKED_HOSTS` | Extra blocked media hosts |
| `AGENT_INTENT_LLM` | `1` = optional LLM intent parse |
| `SOLOHOST_SCHEDULER_MAX` | Max schedules (default 20) |

## API surface (new in v11)

- `GET/POST/DELETE /api/media`, `GET /api/media/:id` (Range)
- Cookie domains: `/api/browser/cookies/domains`, clear
- Workflows: `/api/workflows`, record start/event/stop
- Schedules: `/api/schedules`, history

## Tests

```bash
npm test
npm run test:phase2   # media policy
npm run test:phase3   # agent tools
npm run test:phase4   # intent
npm run test:phase5   # workflows
npm run test:phase6   # scheduler
```

## Docs

- `docs/V11_FINAL_REPORT.md` — full upgrade summary
- `docs/V11_PHASE1_REPORT.md` … `V11_PHASE6_REPORT.md`
- `docs/ARCHITECTURE.md`, `docs/SECURITY_HARDENING.md`

## Limits (honest)

- YouTube: embed / Live / open external — **no download**
- DRM, CAPTCHA, banking MFA: not bypassed
- Schedules run only while this process is up on SoloHost
- Full E2E needs Docker + Playwright image on your host

## License

See repository license file.
