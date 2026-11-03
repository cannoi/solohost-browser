# PHASE 4 REPORT — Deep Research Quality

## 1. Objective
Raise research integrity: distinguish SERP snippets from verified page reads, track coverage, dedupe sources, and refuse to claim targets met without independent verified hosts.

## 2. Files inspected
- lib/agent-evidence.js
- lib/agent-report.js
- lib/backend-agent.js (done path)
- lib/agent-actions.js (addEvidence call sites)

## 3. Files created
- test/agent-research-coverage.js
- docs/reports/PHASE_4_REPORT.md

## 4. Files modified
- lib/agent-evidence.js — classify, canonicalize, dedupe serp→page upgrade, researchCoverage, parseTargetSourceCount, richer ledgerPromptBlock
- lib/backend-agent.js — researchTarget parse, done-path coverage gate (retry up to 2), publicTask.researchCoverage
- lib/agent-report.js — Research coverage section in markdown
- package.json 10.47.3

## 5. Cannot change without live web
- Live 50-source runs depend on network + AI key (NOT TESTED here)

## 6. Completed
- Source class: search_snippet | official | research | news | community | web
- SERP entries are **not** verified; opening/reading upgrades to verified page
- URL canonicalization + tracking param strip + dedupe
- Coverage metrics: found, serp, opened, read, verified, independentHosts, byClass, target, targetMet
- Parse user targets (“30 sources”, “ít nhất 10 nguồn”)
- Done blocked (max 2 retries) if target not met and steps remain
- Limitations appended to summary/report when incomplete
- Prompt ledger shows verified flags + coverage header

## 7. Not completed
- Automatic contradiction matrix across claims (still model-led with evidence ids)
- Live 10/30/50 source E2E: NOT TESTED / BLOCKED without full runtime
- Quota exhaustion path already had partial reports — unchanged

## 8–9. Defects
- None new; prevents overclaiming “done” on snippet-only research

## 10–13. Tests
| Test | Result |
|------|--------|
| agent-research-coverage | PASS |
| Full npm test | delivery |
| Live 50 sources | NOT TESTED |

## 14. Impact
- Planner still uses same actions; evidence semantics stricter
- Reports longer by one coverage section

## 15. Dependencies
- None

## 16. Risks
- Host independence is hostname-based (subdomains count separate)
- Classification heuristics may mislabel niche domains as web

## 17. Decision
Phase 4 COMPLETE for ledger/coverage quality. Proceed Phase 5 when approved.
