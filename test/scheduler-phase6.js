'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.SOLOHOST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sch-'));
const sch = require('../lib/scheduler');
sch.load();

const next = sch.computeNextRun({ type: 'daily', time: '09:00', timezone: 'UTC' }, new Date('2026-01-15T08:00:00Z'));
assert.ok(next);

const add = sch.addSchedule({ workflowId: 'wf1', name: 'Morning', type: 'daily', time: '09:00' });
assert.ok(add.ok, JSON.stringify(add));
assert.ok(add.schedule.nextRunAt);

const items = sch.listSchedules();
assert.strictEqual(items.length, 1);

let ran = 0;
sch.start(async () => { ran += 1; return { ok: true }; });
// force due
const s = items[0];
sch.updateSchedule(s.id, { enabled: true });
// manually set nextRunAt in past via internal store
sch._testSetStore({
  schedules: [{ ...add.schedule, nextRunAt: new Date(Date.now() - 1000).toISOString(), enabled: true, workflowId: 'wf1', type: 'daily', time: '09:00', failCount: 0 }],
  history: []
});
sch.save();
sch.tick().then(() => {
  assert.ok(ran >= 1, 'runner should fire');
  const st = sch.status();
  assert.ok(st.note);
  sch.stop();
  console.log('[PASS] scheduler-phase6');
}).catch((e) => { console.error(e); process.exit(1); });
