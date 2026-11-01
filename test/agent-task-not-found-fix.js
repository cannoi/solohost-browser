'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Isolate task disk dir
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tasks-'));
process.env.SOLOHOST_DATA_DIR = tmp;

// Load module fresh
delete require.cache[require.resolve('../lib/backend-agent')];
const backend = require('../lib/backend-agent');

assert.ok(typeof backend.resolveTask === 'function', 'resolveTask exported');
assert.ok(typeof backend.getTask === 'function');

// Simulate: no task → null
assert.strictEqual(backend.resolveTask('missing', 'sess-a'), null);

// Write disk task with OLD session id
const tid = 'taskdeadbeef001122334455';
const diskTask = {
  id: tid,
  sessionId: 'old-session-xyz',
  task: 'Compare prices',
  brief: 'Compare prices',
  status: 'limit',
  history: [{ step: 1, action: { type: 'navigate' } }],
  workMemory: { findings: [], visited: [] },
  maxSteps: 40,
  maxMs: 60000,
  updatedAt: Date.now(),
  startedAt: Date.now()
};
fs.mkdirSync(path.join(tmp, 'agent-tasks'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'agent-tasks', tid + '.json'), JSON.stringify(diskTask));

// resolve with NEW session should hydrate + rebind (not task_not_found)
const resolved = backend.resolveTask(tid, 'new-session-abc', null);
assert.ok(resolved, 'hydrated from disk');
assert.strictEqual(resolved.sessionId, 'new-session-abc');
assert.strictEqual(resolved.status, 'limit');

// getTask same
const g = backend.getTask(tid, 'new-session-abc');
assert.ok(g);

// status must not return task_not_found
const st = backend.status(tid, 'new-session-abc', 0);
assert.ok(st.ok !== false);
assert.strictEqual(st.taskId, tid);

// continueTask should work
const cont = backend.continueTask(tid, 'new-session-abc', { id: 'new-session-abc', url: 'about:blank' });
// continue may return promise
Promise.resolve(cont).then((out) => {
  assert.ok(out, 'continue returned');
  assert.ok(out.taskId === tid || out.ok !== false);
  console.log('[PASS] agent-task-not-found-fix');
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
