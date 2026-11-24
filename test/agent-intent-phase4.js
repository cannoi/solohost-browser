'use strict';
const assert = require('assert');
const intentLlm = require('../lib/agent-intent-llm');

const u1 = intentLlm.understandDeterministic('So sánh giá iPhone 16', 'vi');
assert.strictEqual(u1.language, 'vi');
assert.ok(u1.plan_outline.length >= 2);

const u2 = intentLlm.understandDeterministic('hi', 'en');
assert.ok(typeof u2.confidence === 'number');

const u3 = intentLlm.understandDeterministic('https://example.com', 'en');
assert.ok(u3.entities.url || u3.intent === 'QUICK_LOOKUP' || u3.kind);

const ask = intentLlm.buildAskPayload({ language: 'vi', inputs_missing: ['product'], plan_outline: ['a', 'b'] });
assert.ok(ask.question);
assert.ok(Array.isArray(ask.options));

const tasks = intentLlm.commonTasks('vi');
assert.ok(tasks.length >= 4);
assert.ok(tasks[0].label && tasks[0].prompt);

const vagueTask = intentLlm.understandDeterministic('so sánh giúp mình', 'vi');
assert.ok(vagueTask.inputs_missing.length || vagueTask.confidence < 0.7 || vagueTask.kind === 'compare');

intentLlm.understandWithOptionalLlm('compare prices', 'en', null).then((r) => {
  assert.ok(r.source === 'deterministic');
  console.log('[PASS] agent-intent-phase4');
}).catch((e) => { console.error(e); process.exit(1); });
