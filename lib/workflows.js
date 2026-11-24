'use strict';
/**
 * Phase 5 — Workflow store + recorder model + deterministic replay helpers.
 * Sensitive fields never store values; steps keep multiple locators for self-heal.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SCHEMA = 1;
const SENSITIVE_TYPES = /password|otp|one.?time|card|cvv|ssn|pin/i;

function dataDir() {
  return process.env.SOLOHOST_DATA_DIR || path.join(__dirname, '..', 'data');
}
function workflowsDir() {
  const d = path.join(dataDir(), 'workflows');
  try { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); } catch (_) {}
  return d;
}
function id() {
  return crypto.randomBytes(8).toString('hex');
}
function nowIso() {
  return new Date().toISOString();
}

function isSensitiveField(meta) {
  const s = JSON.stringify(meta || {}).toLowerCase();
  return SENSITIVE_TYPES.test(s);
}

/** Normalize a recorded browser event into a semantic step */
function eventToStep(ev) {
  if (!ev || typeof ev !== 'object') return null;
  const type = String(ev.type || ev.kind || '').toLowerCase();
  const step = {
    id: id(),
    action: 'wait',
    locators: [],
    urlPattern: '',
    wait: { type: 'load', timeoutMs: 8000 },
    params: {},
    sensitive: false,
    allowAuto: false
  };
  if (type === 'navigate' || type === 'navigation') {
    step.action = 'navigate';
    step.params.url = String(ev.url || '').slice(0, 2000);
    step.urlPattern = hostPattern(ev.url);
  } else if (type === 'click') {
    step.action = 'click';
    step.locators = buildLocators(ev);
    step.sensitive = isSensitiveField(ev);
  } else if (type === 'input' || type === 'type' || type === 'change') {
    step.action = 'type';
    step.locators = buildLocators(ev);
    step.sensitive = isSensitiveField(ev) || isSensitiveField({ name: ev.name, type: ev.inputType, autocomplete: ev.autocomplete });
    if (step.sensitive) {
      step.params.text = '';
      step.params.waitUser = true;
      step.allowAuto = false;
    } else {
      step.params.text = String(ev.value || ev.text || '').slice(0, 500);
      // Parameterize long/variable values
      if (step.params.text.length > 40) {
        step.params.paramKey = 'input_' + (step.locators[0] && step.locators[0].name || 'field');
        step.params.textDefault = step.params.text;
      }
    }
  } else if (type === 'select') {
    step.action = 'select';
    step.locators = buildLocators(ev);
    step.params.value = String(ev.value || '').slice(0, 500);
  } else if (type === 'scroll') {
    step.action = 'scroll';
    step.params.direction = Number(ev.scrollY) > Number(ev.prevScrollY || 0) ? 'down' : 'up';
  } else if (type === 'keydown' || type === 'key') {
    step.action = 'press_key';
    step.params.key = String(ev.key || 'Enter').slice(0, 40);
  } else {
    return null;
  }
  return step;
}

function hostPattern(url) {
  try {
    const u = new URL(url);
    return u.origin + '/*';
  } catch (_) {
    return '';
  }
}

function buildLocators(ev) {
  const locs = [];
  if (ev.role && ev.name) locs.push({ by: 'role', role: String(ev.role).slice(0, 40), name: String(ev.name).slice(0, 120) });
  if (ev.label) locs.push({ by: 'label', label: String(ev.label).slice(0, 120) });
  if (ev.placeholder) locs.push({ by: 'placeholder', placeholder: String(ev.placeholder).slice(0, 120) });
  if (ev.text) locs.push({ by: 'text', text: String(ev.text).slice(0, 120) });
  if (ev.css) locs.push({ by: 'css', css: String(ev.css).slice(0, 300) });
  if (ev.aria) locs.push({ by: 'aria', aria: String(ev.aria).slice(0, 120) });
  if (ev.name) locs.push({ by: 'name', name: String(ev.name).slice(0, 80) });
  if (ev.idAttr) locs.push({ by: 'id', id: String(ev.idAttr).slice(0, 80) });
  if (ev.x != null && ev.y != null) locs.push({ by: 'relative', x: Number(ev.x), y: Number(ev.y) });
  return locs.slice(0, 8);
}

function summarizeWorkflow(steps, meta) {
  const name = String((meta && meta.name) || 'Workflow').slice(0, 80);
  const goal = String((meta && meta.goal) || 'Replay recorded browser steps').slice(0, 300);
  const params = [];
  for (const s of steps) {
    if (s.params && s.params.paramKey) params.push(s.params.paramKey);
    if (s.params && s.params.waitUser) params.push('(user secret)');
  }
  return {
    name,
    goal,
    stepCount: steps.length,
    parameters: [...new Set(params)],
    summary: steps.map((s, i) => (i + 1) + '. ' + s.action + (s.sensitive ? ' [user input]' : '')).join('\n')
  };
}

function listWorkflows() {
  const dir = workflowsDir();
  const out = [];
  try {
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (j && j.id) {
          out.push({
            id: j.id,
            name: j.name,
            goal: j.goal,
            stepCount: Array.isArray(j.steps) ? j.steps.length : 0,
            updatedAt: j.updatedAt,
            icon: j.icon || '⚙️'
          });
        }
      } catch (_) {}
    }
  } catch (_) {}
  return out.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
}

function loadWorkflow(wid) {
  const file = path.join(workflowsDir(), String(wid).replace(/[^\w-]/g, '') + '.json');
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function saveWorkflow(doc) {
  if (!doc || !doc.id) return { ok: false, error: 'id_required' };
  // Scrub any accidental secrets
  const steps = Array.isArray(doc.steps) ? doc.steps.map(scrubStep) : [];
  const body = {
    schema: SCHEMA,
    id: doc.id,
    name: String(doc.name || 'Workflow').slice(0, 80),
    goal: String(doc.goal || '').slice(0, 500),
    icon: String(doc.icon || '⚙️').slice(0, 8),
    steps,
    parameters: Array.isArray(doc.parameters) ? doc.parameters.slice(0, 20) : [],
    createdAt: doc.createdAt || nowIso(),
    updatedAt: nowIso()
  };
  const file = path.join(workflowsDir(), body.id + '.json');
  fs.writeFileSync(file, JSON.stringify(body, null, 2), { mode: 0o600 });
  return { ok: true, workflow: { id: body.id, name: body.name, stepCount: steps.length } };
}

function scrubStep(s) {
  const step = Object.assign({}, s);
  step.params = Object.assign({}, s.params || {});
  if (step.sensitive || step.params.waitUser) {
    step.params.text = '';
    step.params.value = step.params.value && !SENSITIVE_TYPES.test(String(step.params.value)) ? step.params.value : '';
    step.params.waitUser = true;
    step.allowAuto = false;
  }
  // never keep password-looking keys
  for (const k of Object.keys(step.params)) {
    if (SENSITIVE_TYPES.test(k)) delete step.params[k];
  }
  return step;
}

function deleteWorkflow(wid) {
  const file = path.join(workflowsDir(), String(wid).replace(/[^\w-]/g, '') + '.json');
  try {
    fs.unlinkSync(file);
    return { ok: true };
  } catch (_) {
    return { ok: false, error: 'not_found' };
  }
}

/** In-memory recording sessions */
const recorders = new Map();

function startRecording(sessionKey, meta) {
  const rid = id();
  recorders.set(rid, {
    id: rid,
    sessionKey: String(sessionKey || ''),
    startedAt: Date.now(),
    events: [],
    meta: meta || {}
  });
  return { ok: true, recordingId: rid };
}

function appendRecordingEvent(recordingId, ev) {
  const r = recorders.get(recordingId);
  if (!r) return { ok: false, error: 'not_found' };
  if (r.events.length >= 500) return { ok: false, error: 'too_many_events' };
  const step = eventToStep(ev);
  if (step) r.events.push(step);
  return { ok: true, steps: r.events.length };
}

function stopRecording(recordingId, opts) {
  const r = recorders.get(recordingId);
  if (!r) return { ok: false, error: 'not_found' };
  recorders.delete(recordingId);
  const summary = summarizeWorkflow(r.events, Object.assign({}, r.meta, opts || {}));
  const wid = id();
  const doc = {
    id: wid,
    name: summary.name,
    goal: summary.goal,
    icon: (opts && opts.icon) || '⚙️',
    steps: r.events,
    parameters: summary.parameters,
    createdAt: nowIso()
  };
  const saved = saveWorkflow(doc);
  return {
    ok: saved.ok,
    workflowId: wid,
    summary: summary.summary,
    stepCount: r.events.length,
    parameters: summary.parameters
  };
}

/**
 * Deterministic step runner interface — returns plan of agent tool actions.
 * Actual execution uses agent-actions / playwright.
 */
function workflowToActions(workflow, paramValues) {
  const vals = paramValues || {};
  const steps = Array.isArray(workflow.steps) ? workflow.steps : [];
  const actions = [];
  for (const s of steps) {
    if (s.sensitive || (s.params && s.params.waitUser)) {
      actions.push({
        type: 'ask_user',
        question: 'Please complete the sensitive field, then continue.',
        kind: 'sensitive_step',
        stepId: s.id
      });
      continue;
    }
    if (!s.allowAuto && s.action === 'click' && /submit|pay|delete|purchase|buy|đặt hàng|thanh toán/i.test(JSON.stringify(s.locators || {}))) {
      actions.push({ type: 'ask_user', question: 'Allow sensitive click?', kind: 'confirm_sensitive', stepId: s.id });
    }
    const act = { type: s.action };
    if (s.action === 'navigate') act.url = s.params.url;
    if (s.action === 'type') {
      act.text = (s.params.paramKey && vals[s.params.paramKey] != null)
        ? String(vals[s.params.paramKey])
        : (s.params.text || s.params.textDefault || '');
    }
    if (s.action === 'select') act.value = s.params.value;
    if (s.action === 'scroll') act.direction = s.params.direction || 'down';
    if (s.action === 'press_key') act.key = s.params.key || 'Enter';
    if (s.locators && s.locators[0]) {
      act._locators = s.locators;
      if (s.locators[0].by === 'text') act.name = s.locators[0].text;
    }
    actions.push(act);
  }
  return actions;
}

function containsSecretLeak(workflow) {
  const raw = JSON.stringify(workflow || {});
  // heuristic: password-like values longer than 0 next to password keys
  if (/"type"\s*:\s*"password"\s*,\s*"text"\s*:\s*"[^"]+"/i.test(raw)) return true;
  if (/password["']?\s*:\s*["'][^"']{3,}/i.test(raw)) return true;
  return false;
}

module.exports = {
  SCHEMA,
  eventToStep,
  summarizeWorkflow,
  listWorkflows,
  loadWorkflow,
  saveWorkflow,
  deleteWorkflow,
  startRecording,
  appendRecordingEvent,
  stopRecording,
  workflowToActions,
  containsSecretLeak,
  isSensitiveField,
  buildLocators
};
