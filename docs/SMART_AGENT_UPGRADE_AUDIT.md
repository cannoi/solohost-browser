# SMART AGENT UPGRADE — PHASE 0 AUDIT

**Baseline version:** 10.46.22  
**Audit date:** 2026-11-02  
**Source package:** solohost-browser-v10.46.22-agent-tools.zip  
**Git:** Not present in delivery ZIP (`NO_GIT_IN_ZIP`)

---

## 1. Current architecture (summary)

```
UI (public/) ──chat/agent──► Express (server-app.js)
                                │
                                ├─ AI module (chat, settings, providers)
                                ├─ DOM Bridge (lib/engine/dom-bridge.js)
                                │     └─ Playwright Chromium (lib/engine/playwright-engine.js)
                                │           └─ observer.js (page.evaluate OBSERVE_JS)
                                └─ Backend Agent (lib/backend-agent.js)
                                      ├─ planStep (lib/browser-agent.js) + agent-tools.js
                                      ├─ executeAction (lib/agent-actions.js)
                                      ├─ search (lib/agent-search.js)
                                      ├─ evidence (lib/agent-evidence.js)
                                      └─ report (lib/agent-report.js) → data/agent-reports/
```

**Single browser session model:** Agent shares Chromium via `SOLOHOST_AGENT_SHARED_BROWSER` (default on). Live page is mirrored to the user UI through the Bridge; user control is blocked while Agent runs.

**Runtime dependencies (package.json):** `express`, `cors`, `dotenv`, `playwright@1.51.1` only — lean.

---

## 2. Capabilities already complete

| Area | Status | Notes |
|------|--------|-------|
| Shared Chromium + Bridge | Done | Playwright engine, session pin, idle sweep |
| Agent task lifecycle | Done | queued/running/waiting_user/succeeded/failed/cancelled |
| planStep LLM loop | Done | observe → plan → act → repeat |
| Core tools (13) | Done | `lib/agent-tools.js` — search, navigate, extract, click, type, scroll, note, recall, wait, back, ask_user, done, fail |
| Action aliases | Done | read/extract_page→extract, open_many→navigate, etc. |
| Smart search | Done | intent, multi-engine merge, quality score, query repair/adjust, force-open quality candidates |
| Clarification answers | Done | clarifications + anti re-ask |
| Evidence ledger | Done | `agent-evidence.js`, grounded report links |
| Report files | Done | auto `.md` + `.html` under `data/agent-reports/` |
| Feedback Hub | Done | hardcoded hub, notice merge from `/api/notices` |
| Proxy manager | Done | user-configured HTTP/HTTPS/SOCKS5 |
| Bilingual UI + AI language | Done | en/vi |
| Safety | Done | SSRF net-guard, secret field block, confirm sensitive actions |
| Observer basics | Partial | roles, labels, bbox, visibility, secret redaction, same-origin iframe walk, main text, dialog flag |

---

## 3. Gaps vs Smart Agent target (Phases 1–5)

### Phase 1 — Smart page understanding
**Present:** `lib/engine/observer.js` (~219 lines) collects up to 120 interactive elements with tag/type/role/label/href/value/bbox/disabled; main/article text; dialog detection; shallow shadowRoot walk; same-origin iframe document access.

**Missing / weak:**
- Full accessibility tree snapshot (CDP `Accessibility.getFullAXTree`) not used.
- Weak semantic regions (nav vs main vs footer vs ad) beyond simple CSS selectors.
- Limited SPA readiness signals (no explicit network-idle / hydration wait in observe).
- Cross-origin iframe: not readable (Playwright limitation — must document).
- Element budget truncation may drop important controls on dense pages.
- No structured “page type” classification (search results, article, form, app shell).

### Phase 2 — Smart action recovery
**Present:** Basic execute paths; reliability helpers in history of upgrades; loop detection; force-open after repeated search.

**Missing / weak:**
- No systematic post-action verification (URL/title/DOM hash change).
- Limited alternate locator strategies after click/type fail (role/name/text fallback chain incomplete).
- Stale/detached element recovery not explicit.
- Unknown action `nope` currently maps to `note` with `ok:true` (see baseline FAIL).

### Phase 3 — Visual fallback
**Present:** Optional `screenshotDataUrl` on observation when `AGENT_VISION!=off`; planner can attach image to AI complete call (`browser-agent.js`).

**Missing / weak:**
- No gated policy “DOM failed N times → one screenshot”.
- No vision result parsing into actionable element targets.
- No explicit “provider lacks vision” user message path.
- Screenshots may be large; need strict size/PII policy (partial length cap exists ~180KB).

### Phase 4 — Deep research quality
**Present:** search quality scoring, authoritative domain preference, evidence ledger, report generation, source status map.

**Missing / weak:**
- No formal coverage counters (found/opened/read/verified) exposed as first-class task metrics.
- Snippet vs opened-page distinction can still be blurred by LLM if not forced.
- Multi-source contradiction handling is prompt-level only.
- Target “50 sources” not enforced as structured budget.

### Phase 5 — Resource & stability
**Present:** session pin, idle sweep, task disk persistence, shared browser.

**Risks:** Playwright not installed in audit environment; orphan pages closed logs; need regression on RAM when agent idle.

---

## 4. Module inventory (Agent-related)

| Module | Role |
|--------|------|
| `lib/backend-agent.js` | Task orchestration, session pin, loop, answer/continue |
| `lib/browser-agent.js` | planStep, prompts, tool defs |
| `lib/agent-tools.js` | Canonical 13 tools + normalize |
| `lib/agent-tools-impl.js` | Extra read/PDF/media extraction helpers |
| `lib/agent-actions.js` | executeAction switch |
| `lib/agent-search.js` | SERP, repair, variants, merge, score |
| `lib/agent-evidence.js` | Ledger |
| `lib/agent-report.js` | Markdown/HTML reports + files |
| `lib/agent-planner.js` | Optional jobs/DAG + playbook seeds |
| `lib/agent-playbooks/*` | compare_products, news_digest, maps, forms |
| `lib/agent-web.js` | safeFetch |
| `lib/engine/observer.js` | Live page observation |
| `lib/engine/playwright-engine.js` | Chromium lifecycle |
| `lib/engine/dom-bridge.js` | Bridge session API |

**Duplication note:** `agent-tools.js` (planner surface) vs `agent-tools-impl.js` (extraction helpers) — different roles; do not merge blindly. Multiple `*.v8-legacy` copies under `lib/` — dead weight risk, do not delete in Phase 0.

---

## 5. Defects found at baseline

| ID | Severity | Description |
|----|----------|-------------|
| B0-1 | Medium | `test/agent-actions.js` **FAIL**: action type `nope` normalized to `note` → `ok:true`; test expects `ok:false`. Introduced by tool alias safety net. |
| B0-2 | Env | `playwright_not_installed` in this audit environment — live Chromium tests **BLOCKED**. |
| B0-3 | Low | ZIP has no `.git` — checkpoint is ZIP-based only. |
| B0-4 | Product | SERP quality still depends on external engine HTML; bot blocking yields weak candidates in restricted networks. |

---

## 6. Files expected to change in later phases (plan only)

| Phase | Primary files |
|-------|----------------|
| 1 | `lib/engine/observer.js`, possibly small helpers; `browser-agent.js` observation prompt only if schema extends |
| 2 | `lib/agent-actions.js`, `lib/backend-agent.js` (verify step), tests |
| 3 | `lib/backend-agent.js`, `lib/browser-agent.js`, vision gate helper |
| 4 | `lib/agent-search.js`, `lib/agent-evidence.js`, `lib/agent-report.js`, `backend-agent.js` metrics |
| 5 | `playwright-engine.js` cleanup, monitoring |
| 6 | Full regression + final ZIP |

**Must not change without strong reason:** Docker ports, SoloHost labels, Feedback Hub hardcoding, proxy manager API shape, public route prefixes.

---

## 7. Compatibility risks

- Extending observation schema must remain backward compatible with `sanitizeObservation` in `browser-agent.js`.
- Action recovery must not bypass sensitive confirmations.
- Vision must not send password fields or payment screenshots.
- Unknown actions should fail closed (`ok:false`) not silently become notes (B0-1).

---

## 8. Upgrade plan (sequential)

1. **Phase 1** — Enhance observer (AX roles, regions, noise, budgets) + tests with HTML fixtures.  
2. **Phase 2** — Action recovery + fix B0-1 + verification after act.  
3. **Phase 3** — Gated visual fallback using existing AI image path.  
4. **Phase 4** — Research coverage metrics + stronger evidence rules.  
5. **Phase 5** — Resource pass.  
6. **Phase 6** — Full regression + final ZIP + SHA256.

---

## 9. Baseline test results (2026-11-02)

**Command:** `npm test` (script in package.json)

| Result | Count / notes |
|--------|----------------|
| PASS | security, agent-web, challenge, agent-report, config, geo-storage, agent-unify, vietnamese-input, proxy-manager, personal-browser-signals, keep-engine, chrome-toolbar, agent-general-loop, agent-dynamic-playbook, agent-bugfix-playbooks-secret, agent-task-not-found-fix, feedback-security, responsive-profile, browser-thumbnail, bridge-base-csp, ai-message-format, ai-kernel-knowledge, feedback-hub-paths, agent-clarification-answer, feedback-notices, agent-search-loop-fix, agent-candidate-quality, agent-query-adjust, agent-search-smart, agent-query-repair, agent-report-files, agent-tools-standard |
| FAIL | **test/agent-actions.js** (B0-1) |
| BLOCKED | Live Playwright/Chromium e2e (`playwright_not_installed`) |
| NOT TESTED | Docker build/push, real Vision provider, 50-source live research |

**Overall npm test:** FAIL (stops at agent-actions due to `&&` chain).  
**Individual remainder after skip:** all listed PASS.

---

## 10. Phase 0 completion criteria

- [x] Source inventory  
- [x] Architecture documented  
- [x] Gaps mapped to phases  
- [x] Baseline tests executed and recorded honestly  
- [x] Risks and planned files listed  
- [x] No functional Smart Agent code changes in Phase 0 (audit only)  

**Decision:** Phase 0 **COMPLETE**. Ready for Phase 1 after explicit proceed (or automatic continue per master prompt when Phase 0 passes gate).
