'use strict';

const assert = require('assert');
const bridgeViewContentSecurityPolicy = require('../lib/engine/bridge-csp');

const reactPolicy = bridgeViewContentSecurityPolicy('https://react.dev/learn?source=docs');
assert(reactPolicy.includes("base-uri 'self' https://react.dev;"),
  'Bridge CSP allows the current site origin for the injected base URL');
assert(reactPolicy.includes("script-src 'none';"),
  'Bridge CSP continues to block page scripts');

const portPolicy = bridgeViewContentSecurityPolicy('http://127.0.0.1:8080/path');
assert(portPolicy.includes("base-uri 'self' http://127.0.0.1:8080;"),
  'Bridge CSP preserves the current origin port');

const invalidPolicy = bridgeViewContentSecurityPolicy('javascript:alert(1)');
assert(invalidPolicy.includes("base-uri 'self';"),
  'non-HTTP page URLs cannot add a base source');
console.log('[PASS] Bridge base URL CSP');
