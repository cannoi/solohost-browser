'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');

const backend = fs.readFileSync(path.join(root, 'lib/backend-agent.js'), 'utf8');
assert.ok(/const playbooks = require\('\.\/agent-playbooks'\)/.test(backend), 'playbooks must be required');
assert.ok(/buildTaskPlaybook/.test(backend), 'dynamic playbook call present');
assert.ok(/sharedBrowser/.test(backend) && /NEVER destroy the user session|sharedBrowser\)/.test(backend), 'shared release must not destroy user session');

const actions = fs.readFileSync(path.join(root, 'lib/agent-actions.js'), 'utf8');
assert.ok(/const SECRET = /.test(actions), 'SECRET must be defined in agent-actions');
assert.ok(/function isLiveEngine/.test(actions), 'isLiveEngine helper');
assert.ok(/function waitStable/.test(actions), 'waitStable helper');

// Runtime: SECRET usable
const { createExecuteAction } = require('../lib/agent-actions');
assert.ok(typeof createExecuteAction === 'function');

const playbooks = require('../lib/agent-playbooks');
assert.ok(typeof playbooks.buildTaskPlaybook === 'function');

console.log('[PASS] agent-bugfix-playbooks-secret');
