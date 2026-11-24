'use strict';
/**
 * Playbook layer: AI-generated dynamic plan is primary.
 * Legacy static matchers remain exported for tests but are NOT required to run tasks.
 */
const dynamicPlan = require('./dynamic-plan');
const compareProducts = require('./compare_products');
const newsDigest = require('./news_digest');
const fillForm = require('./fill_form');
const mapsDirections = require('./maps_directions');

async function buildTaskPlaybook(ai, task, lang) {
  const dyn = await dynamicPlan.createPlaybookWithAi(ai, task, lang);
  return {
    id: 'dynamic',
    checklist: dynamicPlan.planToChecklist(dyn.plan),
    plan: dyn.plan,
    aiOk: !!dyn.ok,
    offline: !!dyn.offline,
    error: dyn.error || null
  };
}

module.exports = {
  buildTaskPlaybook,
  dynamicPlan,
  compareProducts,
  newsDigest,
  fillForm,
  mapsDirections,
  // Deprecated: kept so old tests requiring selectPlaybook do not crash
  selectPlaybook() { return null; },
  listPlaybookIds() { return ['dynamic']; }
};
