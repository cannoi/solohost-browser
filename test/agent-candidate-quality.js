'use strict';
const assert = require('assert');
const {
  scoreCandidate,
  rankCandidates,
  pickBestCandidate,
  pushResult
} = require('../lib/agent-search');

const query = 'global software application market forecast 2025-2035 Gartner IDC McKinsey Deloitte report';

const junk = {
  title: 'Yahoo Chiebukuro question',
  url: 'https://detail.chiebukuro.yahoo.co.jp/qa/question_detail/q11247202096',
  snippet: 'help me please',
  rank: 1
};
const good = {
  title: 'Gartner Software Market Forecast 2025-2035',
  url: 'https://www.gartner.com/en/documents/software-forecast-2025',
  snippet: 'application market outlook report',
  rank: 2
};
const mid = {
  title: 'Software market trends article',
  url: 'https://www.reuters.com/technology/software-market-2026',
  snippet: 'forecast analysis',
  rank: 3
};

assert.ok(scoreCandidate(junk, query) < scoreCandidate(good, query), 'junk must score below gartner');
assert.ok(scoreCandidate(junk, query) < -20, 'chiebukuro heavily penalized: ' + scoreCandidate(junk, query));
assert.ok(scoreCandidate(good, query) > 20, 'gartner high score: ' + scoreCandidate(good, query));

const ranked = rankCandidates([junk, mid, good], query);
assert.strictEqual(ranked[0].url, good.url, 'gartner first');
assert.ok(!ranked.some((c) => /chiebukuro/i.test(c.url)) || ranked[0].url !== junk.url);

const pick = pickBestCandidate([junk, mid, good], query, { minScore: -10 });
assert.ok(pick);
assert.ok(!/chiebukuro/i.test(pick.url), 'must not pick chiebukuro');
assert.strictEqual(pick.url, good.url);

const pick2 = pickBestCandidate([junk], query, { minScore: -10 });
assert.ok(!pick2 || pick2.relevanceScore < -10 || /chiebukuro/i.test(pick2.url) === false || pick2 === null);
// With only junk below threshold, pickBestCandidate returns null
assert.strictEqual(pickBestCandidate([junk], query, { minScore: -10 }), null);

console.log('[PASS] agent-candidate-quality');
console.log(' scores', {
  junk: scoreCandidate(junk, query),
  good: scoreCandidate(good, query),
  mid: scoreCandidate(mid, query)
});
