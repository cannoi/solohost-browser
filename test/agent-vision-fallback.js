'use strict';
const assert = require('assert');
const v = require('../lib/agent-vision-fallback');

assert.strictEqual(v.shouldRequestVision({ elements: new Array(10).fill({id:1}), text: 'x'.repeat(500) }, {}).capture, false);
assert.strictEqual(v.shouldRequestVision({ elements: [], text: '' }, {}).reason, 'thin_dom');
assert.strictEqual(v.shouldRequestVision({ elements: [], text: '' }, {}).capture, true);

process.env.AGENT_VISION = 'off';
assert.strictEqual(v.shouldRequestVision({ elements: [], text: '' }, {}).capture, false);
process.env.AGENT_VISION = 'on';
assert.strictEqual(v.shouldRequestVision({ elements: [{ id: 1 }], text: 'hello world' }, {}).capture, true);
process.env.AGENT_VISION = 'auto';

const sens = v.shouldRequestVision({
  elements: [{ id: 1, type: 'password', label: 'Password' }],
  text: 'Login'
}, {});
assert.strictEqual(sens.capture, false);
assert.strictEqual(sens.reason, 'sensitive_page');

assert.strictEqual(v.modelLikelySupportsVision('gpt-4o'), true);
assert.strictEqual(v.modelLikelySupportsVision('gpt-3.5-turbo'), false);
assert.strictEqual(v.modelLikelySupportsVision('auto'), true);

assert.strictEqual(
  v.shouldRequestVision({ elements: [{ id: 1 }], text: 'enough text here for a page body that is long' }, {
    lastActionFailed: true,
    lastErrorCode: 'MISSING_ELEMENT'
  }).capture,
  true
);

assert.strictEqual(
  v.shouldRequestVision({ elements: new Array(20).fill({ id: 1 }), text: 'x'.repeat(500) }, {
    lastVisionAt: Date.now()
  }).reason,
  'rate_limited'
);

assert.ok(v.visionPromptHint('vi').includes('VISION'));
assert.ok(v.visionPromptHint('en').includes('VISION'));

(async () => {
  const fakeEngine = {
    captureThumbnail: async () => 'data:image/jpeg;base64,' + Buffer.alloc(100).toString('base64')
  };
  const shot = await v.captureVisionShot(fakeEngine, 's1', {});
  assert.strictEqual(shot.ok, true);
  const obs = { elements: [], text: '' };
  const att = await v.maybeAttachVision(obs, { pwSessionId: 's1' }, {});
  // maybeAttach uses require playwright-engine internally for real session — with only thin obs should attempt
  // Without real engine module session, capture goes through require('./engine/playwright-engine')
  // so may fail in unit env — still must not throw
  assert.ok(att && typeof att.attached === 'boolean');

  console.log('[PASS] agent-vision-fallback');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
