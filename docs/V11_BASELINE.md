# SoloHost Browser — V11 Baseline (Phase 0)

Source: `solohost-browser-main.zip` (package.json 10.48.1). Measured on 2026-11-23 in a Linux sandbox with Node 24 and network access. No Docker was available.

## 1. File inventory
- Files (excluding node_modules/.git): **448** (the zip listing said 445; the extra 3 are untracked dotfiles created during extraction).
- Tree checksum (sha256 of sorted per-file sha256): `6055afea03a61752…`
- Legacy `*.v8-legacy`: 6 · entries under `test/` + `tests/`: 45 · Markdown reports in root + docs: 95.
- `npm ci` succeeded.

## 2. Test baseline (`timeout 60` per test)
| Test | Result |
|---|---|
| test-syntax.js | PASS |
| All 40 entries of `npm test` (test/security.js … test/agent-nav-resilience.js) | **40/40 PASS**, each ≤1 s |

None hung. The earlier >300 s hang was environmental: dependencies were missing. The same 40 tests were rerun after the Phase 0 edits and all pass again (see §5).

## 3. Assumption checks
| # | Assumption | Result | Evidence |
|---|---|---|---|
| a | IndexedDB is persisted | **FALSE (code contradicts the comment and the V10.22 report)** | `playwright-engine.js:553`, `:744` and `:1036` all call `storageState({ indexedDB: false })`, while the comment says it is included and `capabilities.indexedDBPersistence` reports `true`. The runtime probe could not run (see §4). Fix in Phase 1.2. |
| b | Popup / `window.open` handling | Partial | `playwright-engine.js:578-584`: listens to `openerPage.on('popup')`, deliberately not `context.on('page')`. Popups are tied to the opener tab. There is no UI tab sync, OAuth return flow or dialog surfacing. |
| c | Live input forwarding | **Implemented but disabled** | `lib/engine/live-stream.js` forwards `Input.dispatchMouseEvent`, `dispatchKeyEvent`, `insertText` (IME-safe) and `dispatchTouchEvent` over WebSocket with CDP screencast. `server.js:157-166` comments out `liveStream.attachToServer` ("removed v10.36"). `public/live-view.js` is a 49-line stub. There is **no audio**. Latency was not measured. |
| d | ffmpeg / python3 | Sandbox: no `ffmpeg` in PATH, python3 present. The Docker image (`playwright:v1.51.1-jammy`) was **NOT VERIFIED**: Playwright's bundled ffmpeg is only for video recording, not a general codec tool. Phase 2 must install `ffmpeg` via apt with a soft fallback. |
| e | Audio over port 8080 | Assessment: **feasible, but costly**. It needs PulseAudio null-sink + ffmpeg → Opus/WebM over WebSocket: about +30-60 MB RAM and ~5-15 % of one core per active stream. It also requires headed Chromium (Xvfb, already present for noVNC). **NOT VERIFIED** (no Docker/Pulse in the sandbox). The recommendation is to keep it opt-in (`SOLOHOST_LIVE_AUDIO=0` by default). |
| f | RAM/CPU for 1 and 3 tabs | **Invalid measurement.** Node idle ≈ 279 MB RSS, 1 tab ≈ 296 MB, 3 tabs ≈ 297 MB. Sessions reported `backend: playwright-pending`, which means the app fell back to its static crawler because Chromium did not start (see §4). Chromium figures are **NOT VERIFIED** and must be measured in Docker. |

## 4. Environment blockers (honest notes)
- `npx playwright install chromium` downloaded, but `chromium_headless_shell-1161` was only partially extracted (`headless_lib_data.pak` only, no `headless_shell` binary). As a result:
  - The runtime IndexedDB probe could not launch. Conclusion (a) rests on the code.
  - RAM measurements (f) do not include Chromium.
- No Docker → `docker compose config`, the image build, apt ffmpeg and noVNC were **NOT VERIFIED**.

How to verify it yourself:
```
docker build -t shb:v11 . && docker run --rm -p 8080:8080 shb:v11
docker exec <id> sh -c 'which ffmpeg; ffmpeg -hide_banner -codecs | grep -E "h264|aac"; which python3'
docker stats <id>    # with 1 and 3 tabs open
```

## 5. Changes made in Phase 0 (version + strict order only)
| File | Change |
|---|---|
| `lib/agent-task-analyzer.js` | Moved `'use strict'` to line 1 (it was after `require`, so it had no effect). |
| `README.md` | v10.46.10 → v11.0.0-dev |
| `Dockerfile` | Comment line on line 1 → v11.0.0-dev (no build instruction changed) |
| `docs/V11_BASELINE.md` | New (this file) |

`package.json` stays at 10.48.1 until Phase 8. Other mismatches noted for later: `docker-compose.yml` image name `ghcr.io/cannoi/imported-zip-solohost-browser-native-v3zip` (needs user approval) and 68 inline `vi ? … : …` strings in `public/app.js` (Phase 7).

## 6. Implications for Phase 1
1. Live mode does not need a rewrite. Phase 1 re-enables `live-stream.js` under `SOLOHOST_LIVE=1`, adds auth on the WS upgrade, tab sync and a real `live-view.js` client.
2. Switch to `storageState({ indexedDB: true })` with a fallback to the old call.
3. Audio stays opt-in. The YouTube fallback "Open externally ↗" remains the default (Phase 2.5).
