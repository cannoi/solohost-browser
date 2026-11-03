'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { contextOptions } = require('../lib/engine/playwright-engine');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server-app.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'lib', 'engine', 'dom-bridge.js'), 'utf8');

assert.ok(app.includes('mobile: window.innerWidth <= 700'), 'UI selects mobile profile from actual viewport width');
assert.ok(server.includes("typeof (req.body && req.body.mobile) === 'boolean'"), 'session API accepts an explicit profile');
assert.ok(bridge.includes('s0.mobile === mobile'), 'bridge does not reuse a session with the wrong profile');
assert.ok(bridge.includes('mobile: session.mobile != null ? !!session.mobile : true'), 'recovery preserves the session profile');

const mobile = contextOptions({ mobile: true, viewportWidth: 390, viewportHeight: 844 }, 'chromium');
const desktop = contextOptions({ mobile: false }, 'chromium');
assert.strictEqual(mobile.isMobile, true);
assert.strictEqual(mobile.hasTouch, true);
assert.strictEqual(mobile.viewport.width, 390);
assert.strictEqual(desktop.isMobile, false);
assert.strictEqual(desktop.hasTouch, false);
assert.ok(desktop.viewport.width > mobile.viewport.width, 'desktop gets a desktop-sized viewport');

console.log('[PASS] responsive desktop/mobile browser profiles');
