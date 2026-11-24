'use strict';
const assert = require('assert');
const playbooks = require('../lib/agent-playbooks');
const dynamic = require('../lib/agent-playbooks/dynamic-plan');

async function main() {
  // Static selectPlaybook no longer gates tasks
  assert.strictEqual(playbooks.selectPlaybook('compare iphone prices', 'en'), null);

  // Offline dynamic plan still returns a usable checklist
  const off = await playbooks.buildTaskPlaybook(null, 'Find weather in Da Nang', 'en');
  assert.ok(off.checklist);
  assert.strictEqual(off.checklist.kind, 'dynamic');
  assert.ok(Array.isArray(off.plan.steps) && off.plan.steps.length >= 1);

  // Mock AI creates structured playbook
  const ai = {
    configured: () => true,
    complete: async () => ({
      text: JSON.stringify({
        goal: 'Compare two products',
        steps: ['Search A', 'Search B', 'Summarize with citations'],
        sources: ['example.com'],
        success_criteria: 'Table with prices',
        citation_required: true
      }),
      provider: 'mock',
      model: 'm'
    })
  };
  const on = await playbooks.buildTaskPlaybook(ai, 'Compare price of X and Y', 'en');
  assert.ok(on.aiOk);
  assert.strictEqual(on.plan.steps.length, 3);
  assert.ok(on.checklist.citation_required);

  const parsed = dynamic.parseJsonObject('```json\n{"goal":"g","steps":["a"]}\n```');
  assert.strictEqual(parsed.goal, 'g');

  console.log('[PASS] agent-dynamic-playbook');
}
main().catch((e) => { console.error(e); process.exit(1); });
