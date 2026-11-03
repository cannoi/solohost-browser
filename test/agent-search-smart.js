'use strict';
const assert = require('assert');
const {
  detectSearchIntent,
  mergeSearchResults,
  buildQueryVariants,
  scoreCandidate,
  rankCandidates
} = require('../lib/agent-search');

assert.strictEqual(detectSearchIntent('Gartner software market forecast 2025'), 'research');
assert.strictEqual(detectSearchIntent('mua iphone giá shopee'), 'commerce');
assert.strictEqual(detectSearchIntent('tin tức hôm nay'), 'news');
assert.strictEqual(detectSearchIntent('weather'), 'general');

const merged = mergeSearchResults([
  {
    engine: 'bing',
    results: [
      { title: 'Forum post', url: 'https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q1', rank: 1 },
      { title: 'Gartner Software Forecast', url: 'https://www.gartner.com/en/docs/software-forecast', rank: 2, snippet: 'market outlook report' }
    ]
  },
  {
    engine: 'brave',
    results: [
      { title: 'Gartner Software Forecast', url: 'https://www.gartner.com/en/docs/software-forecast', rank: 1, snippet: 'market outlook report' },
      { title: 'IDC Worldwide Software', url: 'https://www.idc.com/getdoc.jsp?containerId=1', rank: 2, snippet: 'software market' }
    ]
  }
], 'software market forecast Gartner IDC', 10);

assert.ok(merged.length >= 1);
assert.ok(!/chiebukuro/i.test(merged[0].url), 'top should not be forum');
assert.ok(/gartner|idc/i.test(merged[0].url), 'top should be authoritative');
// multi-engine agreement boosts gartner
const g = merged.find((x) => /gartner/i.test(x.url));
assert.ok(g && (g.engines || []).length >= 2);

const vars = buildQueryVariants('site:gartner.com OR site:idc.com software forecast 2025-2035', { limit: 10 });
assert.ok(vars.some((v) => /site:gartner\.com/i.test(v) && !/OR site:idc/i.test(v)));
assert.ok(vars.some((v) => /filetype:pdf/i.test(v) || /outlook|report/i.test(v)));

console.log('[PASS] agent-search-smart');
console.log(' top:', merged[0].url, 'score', merged[0].relevanceScore);
