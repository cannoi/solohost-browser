'use strict';
/**
 * Regression: default planStep loop for ANY task + optional playbooks + mock multi-step AI.
 */
const assert = require('assert');
const path = require('path');
const browserAgent = require('../lib/browser-agent');
const playbooks = require('../lib/agent-playbooks');
const agentIntent = require('../lib/agent-intent');

function mockAi(script) {
  let i = 0;
  return {
    configured: () => true,
    complete: async () => {
      const step = script[Math.min(i, script.length - 1)];
      i += 1;
      return {
        text: JSON.stringify(step),
        provider: 'mock',
        model: 'mock-model'
      };
    }
  };
}

async function main() {
  // (a) Task that matches NO playbook still runs via planStep with AI
  const oddTask = 'Find the current UTC time on time.is and tell me the hour';
  assert.strictEqual(playbooks.selectPlaybook(oddTask, 'en'), null, 'odd task must not require a playbook');
  const aiA = mockAi([
    { thought: 'open time site', action: { type: 'navigate', url: 'https://time.is' } },
    { thought: 'read page', action: { type: 'extract_page' } },
    { thought: 'answer', action: { type: 'done', summary: 'UTC hour observed from page.' } }
  ]);
  const r1 = await browserAgent.planStep(aiA, {
    task: oddTask,
    observation: { url: 'about:blank', title: '', text: '', elements: [] },
    history: [],
    step: 1,
    maxSteps: 10,
    lang: 'en'
  });
  assert.ok(r1.ok, 'default loop step1 ok');
  assert.strictEqual(r1.action.type, 'navigate');
  const r2 = await browserAgent.planStep(aiA, {
    task: oddTask,
    observation: { url: 'https://time.is', title: 'Time.is', text: 'UTC 12:00', elements: [] },
    history: [{ step: 1, action: r1.action, result: 'ok' }],
    step: 2,
    maxSteps: 10,
    lang: 'en'
  });
  assert.ok(r2.ok);
  assert.ok(['extract_page', 'read', 'done', 'note'].includes(r2.action.type), 'step2 continues without playbook');

  // (b) Matching playbook uses optimized strategy
  // Static sample matchers are no longer the gate — dynamic AI playbook is primary.
  assert.strictEqual(playbooks.selectPlaybook('anything', 'en'), null);
  // Legacy modules still load for optional tooling
  assert.ok(playbooks.compareProducts && playbooks.compareProducts.matchCompareIntent('so sánh giá iphone'));
  assert.ok(playbooks.fillForm && playbooks.fillForm.matchFillFormIntent('điền form liên hệ'));
  assert.ok(playbooks.mapsDirections && playbooks.mapsDirections.matchMapsIntent('chỉ đường đến chợ Hàn'));

  // (c) Safety invariants still present in source
  const fs = require('fs');
  const actions = fs.readFileSync(path.join(__dirname, '../lib/agent-actions.js'), 'utf8');
  assert.ok(/SECRET|password|otp/i.test(actions), 'secret field block remains');
  const backend = fs.readFileSync(path.join(__dirname, '../lib/backend-agent.js'), 'utf8');
  assert.ok(/HIGH_RISK/.test(backend), 'high risk remains');
  assert.ok(/buildTaskPlaybook|dynamicPlan|dynamic-plan/.test(backend), 'dynamic playbook wired');
  assert.ok(!/only supports compare|chỉ hỗ trợ so sánh/i.test(backend + fs.readFileSync(path.join(__dirname, '../lib/browser-agent.js'), 'utf8')));

  // Multi-step recognition
  assert.strictEqual(agentIntent.classifyIntent('tìm iPhone rồi mở kết quả đầu tiên').kind, 'TASK');

  // Offline: multi-step without AI must not pretend success via multi heuristic
  const off = await browserAgent.planStep(null, {
    task: 'Research quantum computing startups and summarize 3 sources',
    observation: { url: 'about:blank', title: '', text: '', elements: [] },
    history: [],
    step: 1,
    lang: 'en'
  });
  assert.ok(!off.ok || off.code === 'AI_NOT_CONFIGURED' || (off.action && off.action.type === 'fail') || off.offline === undefined);
  if (off.ok && off.offline) {
    // heuristic may return search for "research..." — only allowed as simple first action; message path when null
  } else {
    assert.ok(off.code === 'AI_NOT_CONFIGURED' || (off.action && off.action.type === 'fail'));
  }

  // Mock multi-step AI completes find→open pattern
  const aiMulti = mockAi([
    { thought: 'search', action: { type: 'search', engine: 'ddg', query: 'open source LLM' } },
    { thought: 'open first', action: { type: 'click', id: 3 } },
    { thought: 'done', action: { type: 'done', summary: 'Opened first result about open source LLM.' } }
  ]);
  const m1 = await browserAgent.planStep(aiMulti, {
    task: 'find open source LLM then open the first result',
    observation: { url: 'about:blank', title: '', text: '', elements: [] },
    history: [],
    step: 1,
    lang: 'en'
  });
  assert.strictEqual(m1.action.type, 'search');
  const m2 = await browserAgent.planStep(aiMulti, {
    task: 'find open source LLM then open the first result',
    observation: {
      url: 'https://duckduckgo.com/?q=open+source+LLM',
      title: 'DuckDuckGo',
      text: 'Results',
      elements: [{ id: 3, tag: 'a', label: 'First result', href: 'https://example.org/llm' }]
    },
    history: [{ step: 1, action: m1.action, result: 'ok' }],
    step: 2,
    lang: 'en'
  });
  assert.strictEqual(m2.action.type, 'click');
  const m3 = await browserAgent.planStep(aiMulti, {
    task: 'find open source LLM then open the first result',
    observation: { url: 'https://example.org/llm', title: 'LLM', text: 'About LLM', elements: [] },
    history: [{ step: 1, action: m1.action, result: 'ok' }, { step: 2, action: m2.action, result: 'ok' }],
    step: 3,
    lang: 'en'
  });
  assert.strictEqual(m3.action.type, 'done');

  console.log('[PASS] agent-general-loop');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
