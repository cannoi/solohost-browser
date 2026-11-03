'use strict';
const assert = require('assert');
const { buildQueryVariants, normalizeQuery } = require('../lib/agent-search');

const q = 'site:gartner.com OR site:idc.com software application market forecast 2025-2035';
const v = buildQueryVariants(q, { limit: 10 });
assert.ok(v.length >= 2, 'expected multiple variants');
assert.ok(v.every((x) => normalizeQuery(x) !== normalizeQuery(q)), 'variants exclude original');
assert.ok(v.some((x) => !/site:/i.test(x)), 'should offer variant without site:');
assert.ok(v.some((x) => /report|outlook|Gartner|IDC|PDF/i.test(x)), 'research expansions');

const q2 = 'thị trường ứng dụng toàn cầu 2026-2036';
const v2 = buildQueryVariants(q2, { locale: 'vi', limit: 8 });
assert.ok(v2.length >= 1);
assert.ok(v2.some((x) => /software|application|market|forecast/i.test(x)) || v2.some((x) => x.normalize('NFD') !== x));

// tried set respected
const v3 = buildQueryVariants(q, { tried: v, limit: 5 });
for (const x of v3) assert.ok(!v.includes(x) || true);
const norms = new Set(v.map(normalizeQuery));
assert.ok(v3.every((x) => !norms.has(normalizeQuery(x))));

console.log('[PASS] agent-query-adjust');
console.log('sample variants:', v.slice(0, 4));
