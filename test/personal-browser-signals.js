'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
function read(rel) { return fs.readFileSync(path.join(root, rel), 'utf8'); }

const eng = read('lib/engine/playwright-engine.js');
assert.ok(eng.includes("ignoreDefaultArgs: ['--enable-automation']"), 'must ignore --enable-automation');
assert.ok(eng.includes('--disable-blink-features=AutomationControlled'), 'must disable AutomationControlled');
assert.ok(eng.includes('applyPersonalBrowserHardening'), 'must apply personal browser hardening');
assert.ok(eng.includes("require('./stealth')"), 'stealth module must be wired');
assert.ok(!/SoloHostAgent\/\d/.test(eng), 'engine must not ship SoloHostAgent UA');

for (const f of ['lib/agent-web.js', 'lib/agent-tools-impl.js', 'lib/web-gateway.js']) {
  const t = read(f);
  assert.ok(!/SoloHostAgent\/\d/.test(t), f + ' must not use SoloHostAgent bot UA');
  assert.ok(!/compatible; SoloHostBrowser\//.test(t), f + ' must not use SoloHostBrowser compatible UA');
}
const health = read('lib/proxy/proxy-health.js');
assert.ok(!/SoloHostBrowser-ProxyCheck/.test(health), 'proxy health must not use bot UA');
assert.ok(/Chrome\/\d/.test(health), 'proxy health should use normal Chrome UA');

console.log('[PASS] personal-browser-signals');
