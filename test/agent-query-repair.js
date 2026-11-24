'use strict';
const assert = require('assert');
const { repairSearchQuery } = require('../lib/agent-search');

let r = repairSearchQuery('  site : gartner.com   software   market  ');
assert.ok(r.repaired);
assert.ok(r.query.includes('site:gartner.com'));
assert.ok(r.fixes.includes('site_operator') || r.fixes.includes('whitespace'));

r = repairSearchQuery('garner software forecast');
assert.ok(r.query.includes('Gartner'));
assert.ok(r.fixes.some((f) => /typo/i.test(f)));

r = repairSearchQuery('mckensie report "unclosed');
assert.ok(r.query.includes('McKinsey'));
assert.ok(!r.query.includes('"') || r.fixes.includes('unbalanced_quotes'));

r = repairSearchQuery('thitruong ungdung');
assert.ok(/thị trường|ứng dụng/.test(r.query));

r = repairSearchQuery('market market forecast');
assert.ok(!/market market/i.test(r.query));

r = repairSearchQuery('clean query Gartner');
assert.strictEqual(r.repaired, false);

console.log('[PASS] agent-query-repair');
console.log(repairSearchQuery('site : idc.com  garner OR  OR mckensie'));
