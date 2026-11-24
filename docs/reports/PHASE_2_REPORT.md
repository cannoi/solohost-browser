# PHASE 2 REPORT — Smart Action Recovery

## 1. Objective
Prevent the Agent from getting stuck when UI elements move, labels change, or primary selectors fail — with bounded recovery and clear error codes.

## 2. Files inspected
- lib/agent-actions.js (click/type)
- lib/engine/playwright-engine.js (dispatchEvent)
- lib/engine/observer.js (target mapping)
- lib/backend-agent.js (observe targets)

## 3. Files created
- lib/agent-action-recovery.js
- test/agent-action-recovery.js
- docs/reports/PHASE_2_REPORT.md

## 4. Files modified
- lib/engine/observer.js — stamp `data-agent-id`, map all element ids into `targets`
- lib/agent-actions.js — resolveTarget, retries, sensitive guard, codes
- lib/engine/playwright-engine.js — dual selector `data-sh-id` / `data-agent-id`, semantic click fallback
- package.json → 10.47.1

## 5. Cannot change
- No arbitrary x,y clicks
- Secret fields still blocked
- Sensitive payment/order labels require confirmation (`sensitive_confirm_required`)

## 6. Completed
- Target resolution: observation id → target map → agent_id → semantic locator metadata
- Pre-checks: missing element, disabled
- Bounded retries (MAX_RETRIES=2) with waitStable between attempts
- Post-click URL/title change heuristic (`NO_EFFECT`)
- Error codes: MISSING_ELEMENT, DISABLED, TIMEOUT, STALE_ELEMENT, INTERCEPTED, NO_EFFECT, SENSITIVE_ACTION, SECRET_FIELD
- Semantic fallbacks: getByRole button/link, getByLabel, getByPlaceholder, getByText (Playwright)
- Live DOM: `data-agent-id` stamped during observe so clicks work without Bridge HTML ids

## 7. Not completed / limited
- Full re-observe mid-recovery (would need async observe inject into executor; partial via retries only)
- Live Chromium matrix BLOCKED without browser install
- Coordinate/bbox click intentionally not implemented

## 8–9. Defects
- None new; improves live id mapping gap from Phase 1

## 10–13. Tests
| Test | Result |
|------|--------|
| agent-action-recovery | PASS |
| agent-actions | PASS |
| Full npm test | run on delivery |

## 14. Impact
- Existing click/type API unchanged for planner
- Richer `result` / `code` for planner stuckHints

## 15. Dependencies
- None added

## 16. Risks
- Semantic text click may hit wrong node on dense pages — mitigated by role/label preference order
- Sensitive keyword list is heuristic (EN/VI)

## 17. Decision
Phase 2 COMPLETE for unit-level recovery. Proceed Phase 3 when approved.
