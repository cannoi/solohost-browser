'use strict';
const assert = require('assert');
const recovery = require('../lib/agent-action-recovery');

const obs = {
  url: 'https://example.com',
  title: 'Example',
  elements: [
    { id: 1, kind: 'button', label: 'Continue', region: 'main', disabled: false },
    { id: 2, kind: 'input', label: 'Email', placeholder: 'you@x.com', region: 'form' },
    { id: 3, kind: 'button', label: 'Pay now', region: 'main' }
  ],
  targets: { 1: '1', 2: '2' }
};

assert.strictEqual(recovery.resolveTarget(obs, 1).ok, true);
assert.strictEqual(recovery.resolveTarget(obs, 1).strategy, 'target_map');
assert.strictEqual(recovery.resolveTarget(obs, 99).ok, false);
assert.strictEqual(recovery.resolveTarget(obs, 99).code, 'MISSING_ELEMENT');

assert.strictEqual(recovery.isSensitiveConfirmLabel('Pay now'), true);
assert.strictEqual(recovery.isSensitiveConfirmLabel('Continue'), false);

assert.strictEqual(recovery.classifyActionError('Timeout 5000ms exceeded'), 'TIMEOUT');
assert.strictEqual(recovery.classifyActionError('Element is not attached'), 'STALE_ELEMENT');
assert.strictEqual(recovery.classifyActionError('unknown', { noEffect: true }), 'NO_EFFECT');

const a = recovery.snapshotPage({ url: 'https://a.com', title: 'A' }, obs);
const b = recovery.snapshotPage({ url: 'https://b.com', title: 'A' }, obs);
assert.strictEqual(recovery.pageChanged(a, b), true);
assert.strictEqual(recovery.pageChanged(a, a), false);

// executeAction integration: missing id
const { createExecuteAction } = require('../lib/agent-actions');
const fn = createExecuteAction({
  domBridge: {
    dispatchEvent: async () => ({ ok: true, result: 'ok' }),
    navigate: async (s, url) => ({ url, hasContent: true })
  },
  assertSafeUrl: async () => {}
});

(async () => {
  const task = { urlStack: [], urlIndex: -1, sourcesStatus: {}, workMemory: {} };
  const miss = await fn(task, {}, { type: 'click', id: 42 }, obs);
  assert.strictEqual(miss.ok, false);
  assert.ok(/unknown_element|MISSING/i.test(miss.result + miss.code));

  const sens = await fn(task, {}, { type: 'click', id: 3 }, obs);
  assert.strictEqual(sens.ok, false);
  assert.ok(/sensitive/i.test(sens.result + sens.code));

  const okClick = await fn(task, {}, { type: 'click', id: 1 }, obs);
  assert.strictEqual(okClick.ok, true);

  const disabledObs = {
    elements: [{ id: 5, kind: 'button', label: 'X', disabled: true }],
    targets: { 5: '5' }
  };
  const dis = await fn(task, {}, { type: 'click', id: 5 }, disabledObs);
  assert.strictEqual(dis.ok, false);
  assert.strictEqual(dis.code, 'DISABLED');

  console.log('[PASS] agent-action-recovery');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
