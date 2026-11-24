'use strict';
const assert = require('assert');
const tools = require('../lib/agent-tools');

assert.ok(tools.CORE.length >= 13);
assert.strictEqual(tools.normalizeToolAction({ type: 'extract_page' }).type, 'extract');
assert.strictEqual(tools.normalizeToolAction({ type: 'read' }).type, 'extract');
assert.strictEqual(tools.normalizeToolAction({ type: 'open_many', urls: ['https://a.com', 'https://b.com'] }).type, 'navigate');
assert.strictEqual(tools.normalizeToolAction({ type: 'open_many', urls: ['https://a.com'] }).url, 'https://a.com');
// Phase 3: press_key is first-class (no longer aliased only to type)
assert.strictEqual(tools.normalizeToolAction({ type: 'press_key', key: 'Enter', id: 1 }).type, 'press_key');
assert.strictEqual(tools.normalizeToolAction({ type: 'press_key', key: 'Enter', id: 1 }).key, 'Enter');
assert.strictEqual(tools.normalizeToolAction({ type: 'search', query: 'x' }).engine, 'bing');
assert.ok(tools.toolsPromptBlock().includes('TOOLS'));
assert.ok(tools.functionTools().length >= 13);
assert.ok(!tools.toolsPromptBlock().includes('fetch_feed'));
assert.ok(tools.toolsPromptBlock().includes('search'));

// Phase 3 tools
assert.strictEqual(tools.normalizeToolAction({ type: 'tabs', op: 'list' }).type, 'tabs');
assert.strictEqual(tools.normalizeToolAction({ type: 'wait_for', text: 'Hello' }).type, 'wait_for');
assert.strictEqual(tools.normalizeToolAction({ type: 'select', value: 'VN' }).type, 'select');
assert.strictEqual(tools.normalizeToolAction({ type: 'screenshot' }).type, 'screenshot');
assert.strictEqual(tools.normalizeToolAction({ type: 'save_file', content: 'x' }).type, 'save_file');
assert.strictEqual(tools.normalizeToolAction({ type: 'unknown_xyz' }), null);
assert.strictEqual(tools.riskOf('extract'), 'read');
assert.strictEqual(tools.riskOf('type'), 'write');

const ba = require('fs').readFileSync(require('path').join(__dirname, '../lib/browser-agent.js'), 'utf8');
assert.ok(ba.includes("require('./agent-tools')"));
assert.ok(ba.includes('agentTools.toolsPromptBlock') || ba.includes('toolsPromptBlock()'));
assert.ok(ba.includes('agentTools.functionTools'));
assert.ok(!ba.includes("name: 'fetch_feed'"));

console.log('[PASS] agent-tools-standard');
