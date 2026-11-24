'use strict';
const assert = require('assert');
const tools = require('../lib/agent-tools');

const extra = ['tabs', 'screenshot', 'press_key', 'select', 'hover', 'wait_for', 'extract_table', 'extract_form', 'handle_dialog', 'save_file'];
for (const t of extra) {
  assert.ok(tools.CORE.includes(t), 'missing core ' + t);
  assert.ok(tools.normalizeToolAction({ type: t, key: 'Enter', value: 'x', content: 'y', op: 'list', id: 1 }), 'normalize ' + t);
}
assert.ok(tools.functionTools().some((f) => f.function.name === 'wait_for'));
assert.ok(tools.toolsPromptBlock().includes('wait_for'));
console.log('[PASS] agent-tools-phase3');
