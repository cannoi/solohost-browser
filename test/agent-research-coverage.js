'use strict';
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const evidence = require('../lib/agent-evidence');

const tid = 'covtest_' + Date.now().toString(36);
try { evidence.clearTaskEvidence(tid); } catch (_) {}

assert.strictEqual(evidence.parseTargetSourceCount('Research with 30 sources on AI market'), 30);
assert.strictEqual(evidence.parseTargetSourceCount('Cần ít nhất 10 nguồn độc lập'), 10);
assert.strictEqual(evidence.parseTargetSourceCount('hello'), null);

const s1 = evidence.addEvidence(tid, {
  kind: 'serp',
  url: 'https://www.gartner.com/en/docs/soft?utm_source=x',
  title: 'Gartner Software',
  snippet: 'snippet only'
});
assert.strictEqual(s1.kind, 'serp');
assert.strictEqual(s1.verified, false);
assert.strictEqual(s1.sourceClass, 'search_snippet');

const p1 = evidence.addEvidence(tid, {
  kind: 'page',
  url: 'https://www.gartner.com/en/docs/soft',
  title: 'Gartner Software Full',
  text: 'Full page content about market forecast CAGR 12%.'
});
// upgraded from serp
assert.strictEqual(p1.kind, 'page');
assert.strictEqual(p1.verified, true);
assert.strictEqual(p1.sourceClass, 'research');

evidence.addEvidence(tid, {
  kind: 'page',
  url: 'https://www.idc.com/getdoc.jsp?containerId=1',
  title: 'IDC report',
  text: 'IDC worldwide software.'
});
evidence.addEvidence(tid, {
  kind: 'page',
  url: 'https://www.reddit.com/r/programming/comments/1',
  title: 'Forum post',
  text: 'opinion'
});

const cov = evidence.researchCoverage(tid, { target: 5 });
assert.ok(cov.verified >= 2);
assert.ok(cov.independentHosts >= 2);
assert.strictEqual(cov.targetMet, false);
assert.ok(cov.limitations);

const cov2 = evidence.researchCoverage(tid, { target: 2 });
assert.strictEqual(cov2.targetMet, true);

const block = evidence.ledgerPromptBlock(tid);
assert.ok(/RESEARCH_COVERAGE/.test(block));
assert.ok(/verified/.test(block));

// report includes coverage
const report = require('../lib/agent-report');
const task = {
  id: tid,
  lang: 'en',
  task: 'Need 5 sources on software market',
  researchTarget: 5,
  message: 'Partial findings.',
  history: [],
  workMemory: {},
  errors: []
};
const built = report.buildAgentReport(task);
assert.ok(/Research coverage/i.test(built.markdown));
assert.ok(/not met|Verified/i.test(built.markdown));

evidence.clearTaskEvidence(tid);
console.log('[PASS] agent-research-coverage');
console.log(cov);
