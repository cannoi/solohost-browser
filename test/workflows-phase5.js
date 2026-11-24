'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

process.env.SOLOHOST_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-'));
const wf = require('../lib/workflows');

const rec = wf.startRecording('sess1', { name: 'Demo' });
assert.ok(rec.ok && rec.recordingId);

wf.appendRecordingEvent(rec.recordingId, { type: 'navigate', url: 'https://example.com' });
wf.appendRecordingEvent(rec.recordingId, { type: 'click', role: 'button', name: 'Search', css: 'button.search' });
wf.appendRecordingEvent(rec.recordingId, { type: 'input', name: 'password', inputType: 'password', value: 'SECRET123' });
wf.appendRecordingEvent(rec.recordingId, { type: 'type', text: 'hello world', label: 'q' });

const stopped = wf.stopRecording(rec.recordingId, { name: 'Demo flow', goal: 'Test' });
assert.ok(stopped.ok);
assert.ok(stopped.stepCount >= 3);

const doc = wf.loadWorkflow(stopped.workflowId);
assert.ok(doc);
assert.strictEqual(wf.containsSecretLeak(doc), false);
const sensitive = doc.steps.filter((s) => s.sensitive || (s.params && s.params.waitUser));
assert.ok(sensitive.length >= 1, 'password step must be sensitive');
for (const s of sensitive) {
  assert.ok(!s.params.text || s.params.text === '', 'no secret text stored');
}

const actions = wf.workflowToActions(doc, {});
assert.ok(actions.some((a) => a.type === 'ask_user'), 'sensitive requires ask_user');
assert.ok(actions.some((a) => a.type === 'navigate'));

const list = wf.listWorkflows();
assert.ok(list.some((x) => x.id === stopped.workflowId));

console.log('[PASS] workflows-phase5');
