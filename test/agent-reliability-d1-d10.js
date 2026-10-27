'use strict';
const assert = require('assert');
const reliability = require('../lib/agent-reliability');

const results = { pass: [], fail: [] };
function pass(id, note) { results.pass.push(id); console.log('[PASS]', id, note || ''); }
function fail(id, err) { results.fail.push(id + ': ' + err); console.error('[FAIL]', id, err); }

async function run() {
  try {
    assert.strictEqual(reliability.classifyError('Navigation timeout of 25000 ms exceeded').code, 'TIMEOUT');
    assert.strictEqual(reliability.classifyError('net::ERR_NAME_NOT_RESOLVED').code, 'DNS');
    assert.strictEqual(reliability.classifyError('connect ECONNREFUSED 127.0.0.1:1').code, 'CONNECTION');
    assert.strictEqual(reliability.classifyError({ message: 'Not Found', status: 404 }).code, 'HTTP_404');
    assert.strictEqual(reliability.classifyError('unknown_element_id').code, 'MISSING_ELEMENT');
    assert.ok(reliability.classifyError('Navigation timeout').transient);
    assert.ok(!reliability.classifyError({ status: 404 }).transient);
    pass('D9', 'error classification');
  } catch (e) { fail('D9', e.message); }

  try {
    const c = reliability.classifyError(new Error('TimeoutError: page.goto: Timeout 25000ms exceeded'));
    assert.strictEqual(c.code, 'TIMEOUT');
    assert.ok(reliability.shouldRetry(c, 'navigate', 0, 2));
    assert.ok(!reliability.shouldRetry(c, 'navigate', 2, 2));
    pass('D1', 'nav timeout + bounded retry');
  } catch (e) { fail('D1', e.message); }

  try {
    const c = reliability.classifyError({ result: 'unknown_element_id' });
    assert.strictEqual(c.code, 'MISSING_ELEMENT');
    assert.ok(!reliability.shouldRetry(c, 'click', 0, 3));
    pass('D2', 'missing element no retry');
  } catch (e) { fail('D2', e.message); }

  try {
    let n = 0;
    const out = await reliability.withBoundedRetry({
      actionType: 'navigate', maxRetries: 3, baseDelayMs: 5, maxDelayMs: 20,
      fn: async () => { n += 1; if (n < 3) return { ok: false, error: 'ETIMEDOUT' }; return { ok: true, result: 'https://example.com' }; }
    });
    assert.ok(out.ok); assert.strictEqual(n, 3);
    pass('D3', 'transient then success');
  } catch (e) { fail('D3', e.message); }

  try {
    let n = 0;
    const out = await reliability.withBoundedRetry({
      actionType: 'navigate', maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5,
      fn: async () => { n += 1; return { ok: false, error: 'socket hang up' }; }
    });
    assert.ok(!out.ok);
    assert.strictEqual(out.classification.code, 'CONNECTION');
    assert.strictEqual(n, 3);
    pass('D4', 'persistent failure budget');
  } catch (e) { fail('D4', e.message); }

  try {
    let phase = 0;
    const out = await reliability.withBoundedRetry({
      actionType: 'navigate', maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5,
      fn: async () => {
        phase += 1;
        if (phase === 1) return { ok: false, error: 'net::ERR_CONNECTION_RESET' };
        return { ok: true, result: 'https://example.org/recovered' };
      }
    });
    assert.ok(out.ok);
    pass('D5', 'recovery after connection reset');
  } catch (e) { fail('D5', e.message); }

  try {
    const out = await reliability.withBoundedRetry({
      actionType: 'navigate', maxRetries: 5, baseDelayMs: 1,
      fn: async () => ({ ok: false, error: 'ETIMEDOUT' }),
      shouldAbort: () => true
    });
    assert.ok(out.cancelled);
    assert.strictEqual(out.classification.code, 'CANCELLED');
    pass('D6', 'cancellation');
  } catch (e) { fail('D6', e.message); }

  try {
    const sig = reliability.actionSignature({ type: 'click', id: 7, text: 'Submit' });
    assert.ok(reliability.isDuplicateBurst([sig, sig, sig], sig, 3));
    assert.ok(!reliability.isIdempotentAction('click'));
    assert.ok(!reliability.shouldRetry(reliability.classifyError('ETIMEDOUT'), 'click', 0, 3));
    pass('D7', 'duplicate submit / no click retry');
  } catch (e) { fail('D7', e.message); }

  try {
    assert.strictEqual(reliability.normalizeTaskStatus('done'), 'succeeded');
    assert.strictEqual(reliability.normalizeTaskStatus('stopped'), 'cancelled');
    assert.strictEqual(reliability.normalizeTaskStatus('failed'), 'failed');
    const se = reliability.structuredError(reliability.classifyError({ status: 404, message: 'Not Found' }));
    assert.strictEqual(se.error.code, 'HTTP_404');
    pass('D8', 'lifecycle + structured error');
  } catch (e) { fail('D8', e.message); }

  try {
    for (let i = 0; i < 20; i++) {
      const d = reliability.backoffMs(i, 50, 500);
      assert.ok(d >= 0 && d <= 500);
    }
    await reliability.sleep(10);
    pass('D10', 'backoff bounds + sleep');
  } catch (e) { fail('D10', e.message); }

  try {
    const { createExecuteAction } = require('../lib/agent-actions');
    assert.ok(typeof createExecuteAction === 'function');
    const fs = require('fs');
    const actions = fs.readFileSync(require('path').join(__dirname, '../lib/agent-actions.js'), 'utf8');
    assert.ok(/withBoundedRetry/.test(actions), 'navigate must use withBoundedRetry');
    assert.ok(/errorCode: 'MISSING_ELEMENT'/.test(actions));
    pass('SMOKE', 'agent-actions wired');
  } catch (e) { fail('SMOKE', e.message); }

  console.log('\n=== D summary PASS', results.pass.length, 'FAIL', results.fail.length);
  if (results.fail.length) { console.error(results.fail); process.exit(1); }
}
run().catch((e) => { console.error(e); process.exit(1); });
