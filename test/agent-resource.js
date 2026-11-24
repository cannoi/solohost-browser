'use strict';
const assert = require('assert');
const res = require('../lib/agent-resource');

const obs = { screenshotDataUrl: 'data:image/jpeg;base64,AAAA', vision: { used: true, reason: 'thin_dom' }, text: 'hi' };
assert.strictEqual(res.clearObsVision(obs), true);
assert.strictEqual(obs.screenshotDataUrl, undefined);
assert.ok(obs.vision.clearedAt);

const session = { thumbDataUrl: 'data:image/jpeg;base64,BBBB', thumbAt: Date.now() };
res.clearSessionThumbs(session);
assert.strictEqual(session.thumbDataUrl, null);

const task = { _lastObservation: { screenshotDataUrl: 'data:image/jpeg;base64,CCC' }, session: { thumbDataUrl: 'x', thumbAt: 1 } };
res.hygieneOnRelease(task);
assert.strictEqual(task._lastObservation.screenshotDataUrl, undefined);

const stats = res.engineStats();
assert.ok(stats && typeof stats === 'object');
assert.ok('thumbTtlMs' in stats || stats.error);

console.log('[PASS] agent-resource');
console.log(stats);
