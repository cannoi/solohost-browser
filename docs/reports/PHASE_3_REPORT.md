# PHASE 3 REPORT — Visual Fallback

## 1. Objective
Add gated screenshot→Vision assist when DOM observation is insufficient or DOM actions fail. DOM remains default.

## 2. Files inspected
- lib/backend-agent.js observeSession + action loop
- lib/browser-agent.js planStep images
- lib/ai-module/ai-service.js complete(images)
- lib/engine/playwright-engine.js captureThumbnail
- lib/ai-module/provider-engine.js vision model heuristics

## 3. Files created
- lib/agent-vision-fallback.js
- test/agent-vision-fallback.js
- docs/reports/PHASE_3_REPORT.md

## 4. Files modified
- lib/backend-agent.js — gated maybeAttachVision; track _lastActionFailed / _consecutiveNoEffect
- lib/browser-agent.js — attach images only if model likely supports vision + not sensitive
- package.json 10.47.2

## 5. Cannot implement without user provider
- Guaranteed vision accuracy depends on configured multimodal model
- No new API key required; uses existing AI settings

## 6. Completed
- Policy: AGENT_VISION=off|auto|on (default auto)
- Capture only when: thin DOM, dialog thin, DOM action failed codes, no-effect streak ≥2, or forced on
- Privacy: skip when password/OTP-like fields detected
- Rate limit ≥8s between captures
- Size limit ~160KB data URL; JPEG thumbnail via existing captureThumbnail
- Planner: soft skip if model unlikely to support vision
- Assistive prompt hint when screenshot present
- Soft failure if capture/provider unavailable (no crash, no fake success)

## 7. Not completed
- Structured vision→bbox→click pipeline (intentionally avoided; no blind coordinates)
- Live vision E2E with real GPT-4o/Gemini: NOT TESTED in this environment
- Canvas-only apps: limited to screenshot understanding by the model

## 8–9. Defects fixed
- Uncontrolled thumbnail on every thin page without rate limit / sensitive guard (tightened)

## 10–13. Tests
| Test | Result |
|------|--------|
| agent-vision-fallback | PASS |
| Full npm test | delivery step |
| Real Vision provider | NOT TESTED |
| Live Chromium screenshot | BLOCKED without browser |

## 14. Impact on old features
- Default path unchanged when DOM is rich
- Existing complete({images}) path reused

## 15. Dependencies
- None added

## 16. Risks
- Multimodal models may still hallucinate UI structure — planner instructed to prefer element ids
- Auto model may not be vision-capable — soft skip

## 17. Decision
Phase 3 COMPLETE for gated fallback implementation. Proceed Phase 4 when approved.
