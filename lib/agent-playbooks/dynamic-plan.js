'use strict';
/**
 * First-call AI playbook: one structured plan tailored to the user task.
 * Static sample playbooks are no longer required to run a task.
 */
const MAX_TASK = 4000;

function clip(s, n) {
  const t = String(s == null ? '' : s);
  return t.length > n ? t.slice(0, n) + '…' : t;
}

function parseJsonObject(text) {
  const s = String(text || '').trim();
  const tries = [s];
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) tries.push(fence[1]);
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(s.slice(a, b + 1));
  for (const t of tries) {
    try {
      const j = JSON.parse(t);
      if (j && typeof j === 'object' && !Array.isArray(j)) return j;
    } catch (_) {}
  }
  return null;
}

function normalizePlan(raw, task, lang) {
  const j = raw && typeof raw === 'object' ? raw : {};
  const steps = Array.isArray(j.steps)
    ? j.steps.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 16)
    : [];
  return {
    kind: 'dynamic',
    goal: clip(j.goal || task, 500),
    steps: steps.length ? steps : [lang === 'vi' ? 'Quan sát và hoàn thành nhiệm vụ từng bước' : 'Observe and complete the task step by step'],
    sources: Array.isArray(j.sources) ? j.sources.map((x) => String(x).slice(0, 120)).filter(Boolean).slice(0, 12) : [],
    success_criteria: clip(j.success_criteria || j.done_when || '', 400),
    risks: Array.isArray(j.risks) ? j.risks.map((x) => String(x).slice(0, 120)).slice(0, 8) : [],
    output_language: lang === 'vi' ? 'vi' : 'en',
    citation_required: j.citation_required !== false,
    created_by: 'ai_first_call'
  };
}

/**
 * Ask the model once for a task-specific playbook.
 * On failure returns a minimal generic plan (never blocks the task).
 */
async function createPlaybookWithAi(ai, task, lang) {
  const t = clip(task, MAX_TASK).trim();
  const fallback = normalizePlan(null, t, lang);
  if (!ai || typeof ai.configured !== 'function' || !ai.configured() || typeof ai.complete !== 'function') {
    return { ok: false, offline: true, plan: fallback };
  }
  const sys = [
    'You design a short browser-agent playbook for ONE user task.',
    'Return ONLY JSON (no markdown):',
    '{"goal":"...","steps":["..."],"sources":["optional domains or sites"],"success_criteria":"...","risks":["..."],"citation_required":true}',
    'Rules: steps must be concrete browser actions (search, open, read, compare, fill non-secret fields, summarize).',
    'Never instruct filling password/OTP/payment fields. Never claim you can bypass CAPTCHA.',
    'Write goal/steps/success_criteria in ' + (lang === 'vi' ? 'Vietnamese' : 'the user language') + '.'
  ].join('\n');
  try {
    const out = await ai.complete({
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: 'Task:\n' + t }
      ],
      temperature: 0.2,
      max_tokens: 900
    });
    const parsed = parseJsonObject(out && out.text);
    if (!parsed) return { ok: false, plan: fallback, error: 'bad_json' };
    return { ok: true, plan: normalizePlan(parsed, t, lang), provider: out.provider, model: out.model };
  } catch (e) {
    return { ok: false, plan: fallback, error: String(e.message || e).slice(0, 160) };
  }
}

function planToChecklist(plan) {
  if (!plan) return null;
  return {
    kind: 'dynamic',
    sources: plan.sources || [],
    steps: plan.steps || [],
    goal: plan.goal,
    success_criteria: plan.success_criteria,
    risks: plan.risks || [],
    citation_required: !!plan.citation_required,
    output_language: plan.output_language || 'en',
    created_by: plan.created_by || 'ai_first_call'
  };
}

module.exports = { createPlaybookWithAi, normalizePlan, planToChecklist, parseJsonObject };
