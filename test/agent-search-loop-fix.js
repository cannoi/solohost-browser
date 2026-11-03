'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const actions = fs.readFileSync(path.join(__dirname, '../lib/agent-actions.js'), 'utf8');
assert.ok(/require\('\.\/agent-links'\)/.test(actions), 'agent-actions must require agent-links');
assert.ok(!/agentLinks\.verifyLinks/.test(actions) || /const agentLinks = require/.test(actions));

// Load module — should not throw on require chain for agentLinks
const agentLinks = require('../lib/agent-links');
assert.ok(typeof agentLinks.canonicalizeUrl === 'function');
assert.ok(typeof agentLinks.verifyLinks === 'function');
assert.strictEqual(agentLinks.canonicalizeUrl('https://Example.COM/Path/?q=1#x'), 'https://example.com/Path/?q=1');

const backend = fs.readFileSync(path.join(__dirname, '../lib/backend-agent.js'), 'utf8');
assert.ok(backend.includes('force_open_search_candidate') || backend.includes('force_open_candidate'),
  'backend must force-open search candidates on repeat search');

const prompt = fs.readFileSync(path.join(__dirname, '../lib/browser-agent.js'), 'utf8');
assert.ok(/Do NOT repeat the same search query/i.test(prompt));

// Simulate: executeAction search path does not throw ReferenceError agentLinks
const { createExecuteAction } = require('../lib/agent-actions');
assert.ok(typeof createExecuteAction === 'function');

console.log('[PASS] agent-search-loop-fix');
