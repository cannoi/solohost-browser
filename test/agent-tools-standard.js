'use strict';
const assert = require('assert');
const tools = require('../lib/agent-tools');

assert.strictEqual(tools.CORE.length, 13);
assert.strictEqual(tools.normalizeToolAction({ type: 'extract_page' }).type, 'extract');
assert.strictEqual(tools.normalizeToolAction({ type: 'read' }).type, 'extract');
assert.strictEqual(tools.normalizeToolAction({ type: 'open_many', urls: ['https://a.com', 'https://b.com'] }).type, 'navigate');
assert.strictEqual(tools.normalizeToolAction({ type: 'open_many', urls: ['https://a.com'] }).url, 'https://a.com');
assert.strictEqual(tools.normalizeToolAction({ type: 'press_key', key: 'Enter', id: 1 }).type, 'type');
assert.strictEqual(tools.normalizeToolAction({ type: 'search', query: 'x' }).engine, 'bing');
assert.ok(tools.toolsPromptBlock().includes('TOOLS'));
assert.strictEqual(tools.functionTools().length, 13);
assert.ok(!tools.toolsPromptBlock().includes('fetch_feed'));
assert.ok(tools.toolsPromptBlock().includes('search'));

const ba = require('fs').readFileSync(require('path').join(__dirname, '../lib/browser-agent.js'), 'utf8');
assert.ok(ba.includes("require('./agent-tools')"));
assert.ok(ba.includes('agentTools.toolsPromptBlock') || ba.includes('toolsPromptBlock()'));
assert.ok(ba.includes('agentTools.functionTools'));
assert.ok(!ba.includes("name: 'fetch_feed'"));

console.log('[PASS] agent-tools-standard');
