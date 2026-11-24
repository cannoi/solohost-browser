'use strict';
const assert = require('assert');
const { validateAction, ACTION_TYPES } = require('../lib/browser-agent');

// Core extract alias
let v = validateAction({ type: 'extract' }, { elements: [] });
assert.strictEqual(v.ok, true, 'extract should be valid');
assert.ok(['extract', 'extract_page'].includes(v.action.type));

v = validateAction({ type: 'goto', url: 'https://example.com' }, {});
assert.strictEqual(v.ok, true);
assert.strictEqual(v.action.type, 'navigate');

v = validateAction({ type: 'web_search', query: 'AI trends' }, {});
assert.strictEqual(v.ok, true);
assert.strictEqual(v.action.type, 'search');

// Unknown → soft note recovery (not hard fail)
v = validateAction({ type: 'teleport_to_mars' }, {});
assert.strictEqual(v.ok, true);
assert.strictEqual(v.action.type, 'note');
assert.ok(v.recovered || /ignored_unknown/.test(v.action.text));

v = validateAction({ type: 'finish', summary: 'done text' }, {});
assert.strictEqual(v.ok, true);
assert.strictEqual(v.action.type, 'done');

console.log('[PASS] agent-plan-recovery');
