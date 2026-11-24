# Phase 5 — Workflows

**Result:** ĐẠT (core)

- Recorder model: events → semantic steps with multi-locators
- Password/OTP/card: `waitUser`, never store values (`containsSecretLeak` test)
- Save `/app/data/workflows/*.json` mode 0600
- Replay plan via `workflowToActions` (ask_user for sensitive)
- API: list/get/create/delete, record start/event/stop, actions
- Self-heal full loop with live DOM: partial (locators stored; executor uses agent tools next)

Test: `test:phase5` PASS
