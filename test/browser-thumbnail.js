'use strict';

const assert = require('assert');
const engine = require('../lib/engine/playwright-engine');

assert.strictEqual(typeof engine.captureThumbnail, 'function',
  'session thumbnail route can call the Playwright engine thumbnail implementation');
console.log('[PASS] Playwright thumbnail export');
