# Phase 6 — Scheduler

**Result:** ĐẠT (core)

- `lib/scheduler.js`: daily/weekly/once, persist schedules.json
- Catch-up: skip if late >2h (default) or run if catchUp=run
- Limits: max schedules, concurrent 1, fail disable after 5
- API: CRUD + history + status note (only while app active)
- Boot: scheduler starts with placeholder runner

Test: `test:phase6` PASS
