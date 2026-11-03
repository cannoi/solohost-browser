const { clip: utilClip } = require('./util');
const geoip = require('./geoip');
'use strict';
const netGuard = require('./net-guard');

/**
 * Server-owned browser agent (v10.26).
 * Live Chromium observation via observer.js; structured workMemory; SSRF-safe tools.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const domBridge = require('./engine/dom-bridge');
const agentProgress = require('./agent-progress');
const planner = require('./browser-agent');
const agentWeb = require('./agent-web');
const { createExecuteAction } = require('./agent-actions');
const { createRunCompareProductsParallel } = require('./agent-retail-parallel');
const agentTools = agentWeb;
const agentReport = require('./agent-report');
const agentEvidence = require('./agent-evidence');
const researchTools = agentWeb;
const agentSearch = require('./agent-search');
const agentRunner = require('./agent-runner');
const agentIntent = require('./agent-intent');
const agentLinks = require('./agent-links');
const playbooks = require('./agent-playbooks');
const newsDigest = playbooks.newsDigest || require('./agent-playbooks/news_digest');
const compareProducts = playbooks.compareProducts || require('./agent-playbooks/compare_products');
const taskAnalyzer = require('./agent-task-analyzer');
const agentPlanner = require('./agent-planner');
const appLog = require('./app-log');
const observer = require('./engine/observer');
const agentVision = require('./agent-vision-fallback');
const agentResource = require('./agent-resource');

const tasks = new Map();
const MAX_TASKS = 20;
const TASK_TTL_MS = 24 * 60 * 60 * 1000;
const TASK_DIR = path.join(process.env.SOLOHOST_DATA_DIR || path.join(__dirname, '..', 'data'), 'agent-tasks');
const AGENT_MAX_STEPS = Math.min(150, Math.max(10, Number(process.env.AGENT_MAX_STEPS) || 40));
const STUCK_N = 3;

const SECRET = /password|passcode|one[- ]?time|otp|cvv|cvc|credit.?card|mật khẩu|mat khau|mã xác minh/i;
const HIGH_RISK = /\b(buy|purchase|pay|payment|checkout|place.?order|delete|remove|unsubscribe|transfer|withdraw|wire)\b|thanh toán|đặt hàng|xóa tài khoản|chuyển khoản|rút tiền/i;
const MED_RISK = /\b(log ?out|sign ?out|publish|subscribe|donate)\b|đăng xuất|đăng bài|ủng hộ|đăng ký gói/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function clip(s, n) { return utilClip(s, n); }

function ensureTaskDir() {
  try { fs.mkdirSync(TASK_DIR, { recursive: true, mode: 0o700 }); } catch (_) {}
}

function persistTaskDisk(task) {
  try {
    ensureTaskDir();
    const safe = {
      id: task.id,
      sessionId: task.sessionId,
      task: task.task,
      brief: task.brief || task.task,
      spec: task.spec || null,
      clarifications: task.clarifications || [],
      checklist: task.checklist || null,
      sourcesStatus: task.sourcesStatus || {},
      errors: task.errors || [],
      browserSessionId: task.browserSessionId || null,
      sharedBrowser: !!task.sharedBrowser,
      lang: task.lang,
      status: task.status,
      message: task.message,
      report: task.report || null,
    researchCoverage: (function(){ try { return agentEvidence.researchCoverage(task.id, { target: task.researchTarget }); } catch(_) { return null; } })(),
      reportFiles: task.reportFiles || (task.report && task.report.files) || null,
      workMemory: task.workMemory,
      taskState: task.taskState ? { id: task.taskState.id, status: task.taskState.status, findingsCount: task.taskState.findingsCount, sourcesStatus: task.taskState.sourcesStatus, plan: task.taskState.plan } : null,
      plan: task.plan,
      maxSteps: task.maxSteps,
      maxMs: task.maxMs,
      history: (task.history || []).slice(-20),
      urlStack: task.urlStack,
      urlIndex: task.urlIndex,
      updatedAt: task.updatedAt,
      startedAt: task.startedAt
    };
    fs.writeFileSync(path.join(TASK_DIR, task.id + '.json'), JSON.stringify(safe), { mode: 0o600 });
  } catch (_) {}
}


function normalizeAskText(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);
}

function isSimilarAsk(a, b) {
  const x = normalizeAskText(a);
  const y = normalizeAskText(b);
  if (!x || !y) return false;
  if (x === y) return true;
  if (x.length >= 12 && y.includes(x)) return true;
  if (y.length >= 12 && x.includes(y)) return true;
  // token overlap
  const sx = new Set(x.split(' ').filter((w) => w.length > 2));
  const sy = new Set(y.split(' ').filter((w) => w.length > 2));
  if (sx.size < 3 || sy.size < 3) return false;
  let inter = 0;
  for (const w of sx) if (sy.has(w)) inter += 1;
  return inter / Math.min(sx.size, sy.size) >= 0.7;
}

function loadTaskDisk(id) {
  try {
    const p = path.join(TASK_DIR, String(id) + '.json');
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function summarizeWorkMemory(wm) {
  if (!wm || typeof wm !== 'object') return '';
  const findings = (wm.findings || []).slice(-8).map((f, i) => {
    if (typeof f === 'string') return (i + 1) + '. ' + clip(f, 220);
    return (i + 1) + '. ' + clip(f.fact || f.text || JSON.stringify(f), 500) + (f.url ? ' [' + f.url + ']' : '') + (f.evidenceId ? ' [' + f.evidenceId + ']' : '');
  });
  const lines = [];
  if (wm.todo && wm.todo.length) lines.push('TODO: ' + wm.todo.slice(0, 8).join('; '));
  if (wm.visited && wm.visited.length) lines.push('VISITED: ' + wm.visited.slice(-10).join(' | '));
  if (wm.searchCandidates && wm.searchCandidates.length) lines.push('SEARCH CANDIDATES (not evidence until opened):\n' + wm.searchCandidates.slice(0, 8).map((x) => '[' + x.rank + '] ' + clip(x.title, 120) + ' — ' + x.url + (x.snippet ? ' — ' + clip(x.snippet, 180) : '')).join('\n'));
  // Task errors are diagnostics, never findings. They are surfaced only in scope/limitations.
  if (findings.length) lines.push('FINDINGS:\n' + findings.join('\n'));
  if (wm.lastUrl) lines.push('LAST_URL: ' + wm.lastUrl);
  return lines.join('\n').slice(0, 3500);
}

function actionRisk(action, label) {
  const blob = [action && action.type, label, action && action.text, action && action.value].join(' ');
  if (SECRET.test(blob)) return 'high';
  if (HIGH_RISK.test(blob)) return 'high';
  if (MED_RISK.test(blob)) return 'medium';
  if (action && action.risk) return String(action.risk);
  return 'low';
}


/** Map legacy workMemory onto TaskState fields (single source of truth). */
function ensureTaskState(task) {
  if (!task.taskState) {
    task.taskState = {
      id: task.id,
      brief: task.task || task.brief || '',
      plan: task.plan || { jobs: [] },
      jobStates: task.jobStates || {},
      evidence: [],
      report: null,
      errors: task.errors || [],
      status: task.status || 'running',
      createdAt: task.startedAt || Date.now(),
      updatedAt: Date.now()
    };
  }
  // Bridge: workMemory is a view over taskState bag for older prompt code
  if (!task.workMemory) {
    task.workMemory = {
      findings: [],
      visited: [],
      notes: [],
      todo: [],
      searchCandidates: [],
      sources_status: {}
    };
  }
  task.sourcesStatus = task.sourcesStatus || task.workMemory.sources_status || {};
  task.taskState.updatedAt = Date.now();
  task.taskState.status = task.status || task.taskState.status;
  return task.taskState;
}

function syncTaskState(task) {
  const st = ensureTaskState(task);
  st.errors = (task.errors || []).slice(-30);
  st.status = task.status;
  st.report = task.message || st.report;
  // findings mirror into evidence ids only as counts for status API
  st.findingsCount = (task.workMemory && task.workMemory.findings || []).length;
  st.sourcesStatus = task.sourcesStatus || {};
  return st;
}

async function assertSafeUrl(url) {
  return netGuard.assertPublicHttpUrl(url);
}

function isLiveEngine(session) {
  return session && (session.backend === 'playwright' || session.backend === 'webkit') && session.pwSessionId;
}

/** Fallback HTML parse when live observe unavailable — does NOT swallow form children. */
function observeHtmlFallback(session, textOffset = 0) {
  const html = String(session.html || '');
  const body = (html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i) || [null, html])[1];
  const decode = (s) => String(s || '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"');
  const stripText = (s) => decode(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const fullText = stripText(body);
  const offset = Math.min(Math.max(0, Number(textOffset) || 0), Math.max(0, fullText.length - 1));
  const text = fullText.slice(offset, offset + 3500);
  const elements = [];
  const targets = {};
  // Only void/self-or-simple tags — never match <form>...</form> as one unit
  // Void tags (input) + paired tags — never match <form>...</form>
  const re = /<(input)\b([^>]*)\/?>|<(a|button|textarea|select|summary)\b([^>]*)>([\s\S]*?)<\/\3\s*>/gi;
  let m;
  while ((m = re.exec(body)) && elements.length < 100) {
    const tag = (m[1] || m[3] || '').toLowerCase();
    const attrStr = m[2] || m[4] || '';
    const inner = m[5] || '';
    const at = {};
    attrStr.replace(/([\w:-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g, (_, k, a, b, c) => {
      at[k.toLowerCase()] = decode(a ?? b ?? c ?? '');
      return '';
    });
    const targetId = at['data-sh-id'] || '';
    if (!targetId) continue;
    const type = String(at.type || (tag === 'input' ? 'text' : '')).toLowerCase();
    if (type === 'hidden') continue;
    let label = stripText(inner) || at['aria-label'] || at.title || at.placeholder || at.name || at.value || '';
    if (tag === 'input' && SECRET.test([type, at.name, at.id, at.placeholder].join(' '))) label += ' [secret field - never fill]';
    const id = elements.length + 1;
    const e = { id, tag, label: clip(label, 90) };
    if (tag === 'input') e.type = type;
    if ((tag === 'input' || tag === 'textarea') && !SECRET.test([type, at.name, at.id, at.placeholder].join(' '))) {
      e.value = clip(at.value || '', 60);
    }
    if (tag === 'a' && at.href) {
      try { e.href = new URL(at.href, session.url).href; } catch { e.href = at.href; }
    }
    elements.push(e);
    targets[id] = targetId;
  }
  return {
    readable: !!html,
    live: false,
    url: session.url || '',
    title: session.title || '',
    text,
    textOffset: offset,
    textTotal: fullText.length,
    elements,
    targets,
    scroll: { y: Number(session.scrollY) || 0, height: 0, viewport: 0 },
    pageState: [],
    audit: { textLength: text.length, controls: elements.length, media: 0 }
  };
}

function isBlankPage(session) {
  const u = String((session && session.url) || '').trim().toLowerCase();
  if (!u || u === 'about:blank' || u === 'about:newtab') return true;
  const html = String((session && session.html) || '');
  if (!html || html.length < 40) return true;
  return false;
}

function compositeObservation(session, task, base) {
  const last = (task && task.lastToolResult) || null;
  const candidates = (task && task.workMemory && task.workMemory.searchCandidates) || [];
  const attempts = (task && task.searchAttempts) || [];
  const lines = [];
  lines.push('PAGE: ' + (isBlankPage(session) ? 'none (no navigated document yet)' : ((session && session.url) || '')));
  if (last) {
    lines.push('LAST_TOOL: ' + JSON.stringify({
      action: last.action, query: last.query, outcome: last.outcome, reason: last.reason,
      engine: last.engine, durationMs: last.durationMs, resultCount: last.resultCount
    }));
  }
  if (attempts.length) {
    lines.push('SEARCH_ATTEMPTS:');
    for (const a of attempts.slice(-12)) {
      lines.push('- ' + [a.engine || a.provider || '?', a.outcome || '?', a.reason || '', a.query ? ('q=' + String(a.query).slice(0, 60)) : ''].filter(Boolean).join(' | '));
    }
  }
  if (candidates.length) {
    lines.push('SEARCH_CANDIDATES (ranked; not verified until opened):');
    candidates.slice(0, 10).forEach((c, i) => {
      lines.push((i + 1) + '. ' + clip(c.title, 100) + ' — ' + c.url + (c.snippet ? ' — ' + clip(c.snippet, 120) : ''));
    });
  }
  lines.push('NEXT_OPTIONS: open top candidate URLs; try query variants; use direct sources; ask_user if blocked.');
  const text = lines.join('\n');
  const obs = base && typeof base === 'object' ? Object.assign({}, base) : {};
  obs.url = (session && session.url) || 'about:blank';
  obs.title = (session && session.title) || (isBlankPage(session) ? 'No page loaded' : '');
  obs.page = isBlankPage(session) ? 'none' : 'document';
  obs.last_tool = last || null;
  obs.search_candidates = candidates.slice(0, 10);
  obs.attempts = attempts.slice(-12);
  obs.next_options = ['open_candidate', 'variant_query', 'direct_source', 'ask_user'];
  if (isBlankPage(session) || !(obs.text && String(obs.text).trim().length > 40)) {
    obs.text = text;
    obs.readable = true;
  } else {
    obs.text = String(obs.text || '') + '\n\n---\n' + text;
  }
  obs.elements = Array.isArray(obs.elements) ? obs.elements : [];
  obs.targets = obs.targets || {};
  return obs;
}

async function observeSession(session, textOffset = 0, task = null) {
  let base = null;
  if (isLiveEngine(session)) {
    try {
      const pw = require('./engine/playwright-engine');
      const live = await observer.observeLive(pw, session.pwSessionId, { textOffset });
      if (live && !live.error && live.elements) {
        try {
          const content = await pw.getContent(session.pwSessionId, { force: false });
          if (content) {
            session.html = content.html || session.html;
            session.title = content.title || session.title;
            session.url = content.url || session.url;
          }
        } catch (_) {}
        // Phase 3: gated visual fallback (DOM remains default)
        try {
          task = task || null;
          const vctx = {
            lastVisionAt: task && task._lastVisionAt,
            lastActionFailed: task && task._lastActionFailed,
            lastErrorCode: task && task._lastErrorCode,
            consecutiveNoEffect: task && task._consecutiveNoEffect
          };
          const vres = await agentVision.maybeAttachVision(live, session, vctx);
          if (vres.attached && task) task._lastVisionAt = Date.now();
          if (vres.attached) {
            try { appLog.log('info', 'agent.vision.attached', { reason: vres.reason, bytes: vres.bytes }); } catch (_) {}
          }
        } catch (_) {}
        base = live;
      }
    } catch (e) {
      appLog.log('warn', 'agent.observe_live_fail', { error: String(e.message || e).slice(0, 120) });
    }
  }
  if (!base) base = observeHtmlFallback(session, textOffset);
  if (task) return compositeObservation(session, task, base);
  return base;
}

function push(task, type, data = {}) {
  const event = { id: ++task.eventSeq, type, at: new Date().toISOString(), ...data };
  task.events.push(event);
  if (task.events.length > 120) task.events.shift();
  task.updatedAt = Date.now();
  try {
    const safe = Object.assign({}, data);
    delete safe.password;
    delete safe.secret;
    delete safe.value;
    agentProgress.push({
      taskId: task.id,
      sessionId: task.sessionId,
      type,
      status: task.status,
      message: task.message || safe.message || '',
      url: (task.session && task.session.url) || safe.url || '',
      n: safe.n,
      action: safe.action && safe.action.type,
      plan: task.plan
    });
  } catch (_) {}
  if (type === 'step') { appLog.log('info', 'agent.task.step', { taskId: task.id, n: data.n, action: data.action && data.action.type }); try { pinAndTouchAgentSession(task); } catch (_) {} }
  else if (type === 'error' || type === 'failed') appLog.log('warn', 'agent.task.' + type, { taskId: task.id, message: clip(data.message || task.error || task.message, 180) });
  else if (type === 'done') appLog.log('info', 'agent.task.done', { taskId: task.id });
  persistTaskDisk(task);
  return event;
}

function publicTask(task, after = 0) {
  let currentUrl = '';
  let currentTitle = '';
  try {
    currentUrl = (task.session && (task.session.url || task.session.lastUrl)) || '';
    currentTitle = (task.session && task.session.title) || '';
  } catch (_) {}
  return {
    ok: true,
    taskId: task.id,
    status: task.status,
    message: task.message || '',
    error: task.error || '',
    confirmation: task.confirmation ? { id: task.confirmation.id, text: task.confirmation.text } : null,
    events: (Array.isArray(task.events) ? task.events : []).filter((e) => e.id > after),
    cursor: Number(task.eventSeq) || 0,
    history: (Array.isArray(task.history) ? task.history : []).slice(-14),
    plan: task.plan || null,
    workMemory: task.workMemory ? { findings: (task.workMemory.findings || []).length, todo: task.workMemory.todo } : null,
    sourcesStatus: task.sourcesStatus || {}, checklist: task.checklist || null, errors: (task.errors || []).slice(-12),
    report: task.report || null,
    currentUrl,
    currentTitle,
    sharedBrowser: !!task.sharedBrowser,
    updatedAt: task.updatedAt
  };
}

/**
 * Resolve a task by id for this browser session.
 * Survives Chromium/session recovery: rebinds sessionId when the same task
 * still exists in memory or on disk (fixes task_not_found after refresh).
 */
function resolveTask(id, sessionId, opts) {
  const tid = String(id || '').trim();
  if (!tid) return null;
  const sid = sessionId != null ? String(sessionId) : '';
  let task = tasks.get(tid) || null;

  if (task) {
    if (sid && task.sessionId && task.sessionId !== sid) {
      // Session was recreated (shared browser recovery) — rebind ownership
      appLog.log('info', 'agent.task.session_rebind', {
        taskId: tid,
        from: String(task.sessionId).slice(0, 16),
        to: sid.slice(0, 16)
      });
      task.sessionId = sid;
      if (opts && opts.liveSession) {
        task.session = opts.liveSession;
        task.browserSessionId = opts.liveSession.id || sid;
        task.sharedBrowser = task.sharedBrowser !== false;
      }
      persistTaskDisk(task);
    } else if (sid && !task.sessionId) {
      task.sessionId = sid;
    }
    if (opts && opts.liveSession) {
      task.session = opts.liveSession;
      task.browserSessionId = opts.liveSession.id || task.browserSessionId || sid;
    }
    return task;
  }

  // Hydrate from disk after process restart / TTL eviction from Map
  const disk = loadTaskDisk(tid);
  if (!disk) return null;
  // Accept disk task: rebind to current session (user is authenticated via token)
  disk.sessionId = sid || disk.sessionId;
  disk.stop = false;
  if (opts && opts.liveSession) {
    disk.session = opts.liveSession;
    disk.browserSessionId = opts.liveSession.id || sid;
    disk.sharedBrowser = disk.sharedBrowser !== false;
  }
  // Normalize runtime fields missing on disk snapshots
  disk.events = Array.isArray(disk.events) ? disk.events : [];
  disk.eventSeq = Number(disk.eventSeq) || disk.events.length || 0;
  disk.history = Array.isArray(disk.history) ? disk.history : [];
  disk.errors = Array.isArray(disk.errors) ? disk.errors : [];
  disk.workMemory = disk.workMemory && typeof disk.workMemory === 'object'
    ? disk.workMemory
    : { findings: [], visited: [], notes: [], todo: [], searchCandidates: [] };
  disk.urlStack = Array.isArray(disk.urlStack) ? disk.urlStack : [];
  disk.urlIndex = Number(disk.urlIndex) || 0;
  disk.stop = false;
  disk.updatedAt = Date.now();
  // Restore into memory so subsequent polls find it
  tasks.set(tid, disk);
  try { appLog.log('info', 'agent.task.hydrated_from_disk', { taskId: tid, status: disk.status }); } catch (_) {}
  return disk;
}

function getTask(id, sessionId) {
  return resolveTask(id, sessionId, null);
}

async function waitStable(session) {
  await sleep(400);
  if (isLiveEngine(session)) {
    try {
      const pw = require('./engine/playwright-engine');
      await pw.evaluate(session.pwSessionId, 'new Promise(r => setTimeout(r, 200))');
    } catch (_) {}
  }
}

const _executeAction = createExecuteAction({
  get domBridge() { return domBridge; },
  get assertSafeUrl() { return assertSafeUrl; }
});
async function executeAction(task, session, action, obs) {
  return _executeAction(task, session, action, obs);
}




function pinAndTouchAgentSession(task) {
  try {
    const pe = require('./engine/playwright-engine');
    const isolated = task && task.session;
    if (!isolated) return;
    const pwId = isolated.pwSessionId || isolated.engineSessionId;
    if (!pwId || typeof pe.getSession !== 'function') return;
    const st = pe.getSession(pwId);
    if (!st) return;
    st.agentPinned = true;
    st.pinned = true;
    if (typeof pe.acquireLease === 'function') pe.acquireLease(st, 'agent');
    if (typeof pe.touchSession === 'function') pe.touchSession(st);
    else st.touched = Date.now();
  } catch (_) {}
}

async function ensureTaskBrowserSession(task) {
  if (task && task.session && task.browserSessionId) return task.session;
  const created = await domBridge.createSession({ tabKey: 'agent-' + task.id.slice(0, 48), clientKey: 'agent-profile', privateMode: false, persist: true, mobile: true, locale: task.lang === 'vi' ? 'vi-VN' : 'en-US', timezoneId: (geoip.getGeoProfileSync().timezone || process.env.TZ || 'UTC') });
  const isolated = domBridge.authSession(created.sessionId, created.token);
  if (!isolated) throw new Error('agent_bridge_session_auth_failed');
  task.session = isolated; task.browserSessionId = isolated.id; task.urlStack = []; task.urlIndex = -1;
  ensureTaskState(task);
  try {
    const pe = require('./engine/playwright-engine');
    const pwId = isolated.pwSessionId || isolated.engineSessionId;
    if (pwId && pe.sessions) {
      /* sessions map may not export — use acquireLease via get if available */
    }
    if (typeof pe.acquireLease === 'function' && isolated.pwSessionId) {
      const s = pe.sessions && pe.sessions.get && pe.sessions.get(isolated.pwSessionId);
      // fallback: mark via navigate touch by getState
    }
  } catch (_) {}
  pinAndTouchAgentSession(task);
  return isolated;
}

async function releaseAgentSession(task) {
  // Phase 5: drop transient vision buffers before unpin
  try { agentResource.hygieneOnRelease(task); } catch (_) {}
  // Always unpin agent lease so the page is not stuck pinned.
  try {
    const pe = require('./engine/playwright-engine');
    const sess = task && task.session;
    const pwId = sess && (sess.pwSessionId || sess.engineSessionId);
    if (pwId && pe.getSession) {
      const st = pe.getSession(pwId);
      if (st) {
        st.agentPinned = false;
        st.pinned = false;
        if (typeof pe.releaseLease === 'function') pe.releaseLease(st, 'agent');
        try { agentResource.clearSessionThumbs(st); } catch (_) {}
      }
    } else if (pwId && typeof pe.releaseLease === 'function') {
      try { pe.releaseLease({ id: pwId }, 'agent'); } catch (_) {}
    }
  } catch (_) {}

  // Shared browser: NEVER destroy the user session — UI must keep showing the page.
  if (task && task.sharedBrowser) {
    persistTaskDisk(task);
    return;
  }

  const id = task && task.browserSessionId;
  if (!id) return;
  task.browserSessionId = null;
  try { await domBridge.destroySession(id); } catch (_) {}
  task.session = null;
  persistTaskDisk(task);
}



const runCompareProductsParallel = createRunCompareProductsParallel({
  get push() { return push; },
  get persistTaskDisk() { return persistTaskDisk; },
  get assertSafeUrl() { return assertSafeUrl; },
  get agentEvidence() { return agentEvidence; }
});


async function runTask(ai, task) {
  // One LLM plan when rules left jobs empty
  try {
    if (task.plan && (!task.plan.jobs || !task.plan.jobs.length) && ai && agentPlanner.planWithLLM) {
      appLog.log('info', 'agent.plan.start', { taskId: task.id });
      const planned = await agentPlanner.planWithLLM(ai, task.brief || task.task, task.lang);
      if (planned && planned.jobs && planned.jobs.length) {
        task.plan.jobs = planned.jobs;
        task.plan.playbook = planned.playbook || task.plan.playbook || 'llm';
        task.plan.steps = planned.jobs.map((j, i) => ({ id: j.id || ('step-' + (i + 1)), title: j.label || j.kind, status: 'pending', evidence_count: 0 }));
        appLog.log('info', 'agent.plan.end', { taskId: task.id, jobs: planned.jobs.length });
      } else {
        appLog.log('info', 'agent.plan.end', { taskId: task.id, jobs: 0 });
      }
    }
  } catch (e) {
    appLog.log('warn', 'agent.plan.end', { taskId: task.id, error: clip(e.message || e, 120) });
  }
  ensureTaskState(task);
  pinAndTouchAgentSession(task);
  try {
    // Dynamic checklist already set at start. Always continue with planStep loop.
    task.workMemory = task.workMemory || { findings: [], todo: [], sources_status: {} };
    if (task.dynamicPlan && Array.isArray(task.dynamicPlan.steps) && !(task.workMemory.todo && task.workMemory.todo.length)) {
      task.workMemory.todo = task.dynamicPlan.steps.slice();
    }
  } catch (_) {}

  const recentHashes = [];
  const deadline = (task.startedAt || Date.now()) + (task.maxMs || 3600000);
  for (let i = 0; i < task.maxSteps; i++) {
    if (task.stop) {
      task.status = 'stopped';
      task.message = task.lang === 'vi' ? 'Đã dừng tác vụ.' : 'Task stopped.';
      push(task, 'status', { message: task.message });
      await releaseAgentSession(task);
      return;
    }
    if (Date.now() > deadline) {
      task.status = 'limit';
      task.message =
        task.lang === 'vi'
          ? 'Hết thời gian nhiệm vụ (~' + Math.round((task.maxMs || 0) / 60000) + ' phút). Bấm Tiếp tục để resume.'
          : 'Task time limit reached (~' + Math.round((task.maxMs || 0) / 60000) + ' min). Tap Continue to resume.';
      push(task, 'status', { message: task.message });
      persistTaskDisk(task);
      return;
    }

    const session = task.session;
    let obs = await observeSession(session, task.readOffset || 0, task);
    const obsHash = observer.hashObservation(obs);
    // Detect non-progressing loops (same search/navigate signature)
    task._actionSigs = task._actionSigs || [];
    if (task._actionSigs.length >= 6) {
      const last4 = task._actionSigs.slice(-6);
      const allSame = last4.every((s) => s === last4[0]);
      if (allSame) {
        appLog.log('warn', 'agent.loop_detected', { signature: last4[0], step: i + 1 });
        task.status = 'done';
        try {
          const fin = agentReport.finalizeDoneMessage(task, task.lang === 'vi'
            ? 'Dừng do vòng lặp không tiến triển. Báo cáo một phần với bằng chứng hiện có.'
            : 'Stopped: no-progress loop detected. Partial report with current evidence.');
          task.message = fin.message;
          task.report = fin.report;
          task.partial = true;
          push(task, 'partial_report', { message: task.message, reason: 'loop_detected' });
          push(task, 'done', { message: task.message, report: task.report, partial: true });
        } catch (_) {
          task.message = 'Stopped: loop detected';
          push(task, 'done', { message: task.message });
        }
        await releaseAgentSession(task);
        return;
      }
    }

    let plan = null;
    // Optional playbook seed for empty history only — LLM remains the default driver
    if (task._playbookSeed && task._playbookSeed.length && !(task.history && task.history.length)) {
      const seedAct = task._playbookSeed.shift();
      if (seedAct && seedAct.type) {
        plan = { thought: 'playbook_seed', action: seedAct, actions: [seedAct], plan: task.plan || null };
      }
    }
    try {
      if (!plan) plan = await planner.planNext({
        ai,
        task: task.brief || task.task,
        spec: task.spec,
        clarifications: task.clarifications || [],
        observation: obs,
        history: task.history,
        step: i + 1,
        maxSteps: task.maxSteps,
        workMemory: task.workMemory,
        workMemoryText: summarizeWorkMemory(task.workMemory) + '\n' + agentEvidence.ledgerPromptBlock(task.id),
        nowIso: new Date().toISOString(),
        plan: task.plan,
        stuckHint: (task._forceProgressHint
          ? (function () { const h = task._forceProgressHint; task._forceProgressHint = ''; return h; })()
          : (recentHashes.filter((h) => h === obsHash).length >= 2
            ? 'Previous actions did not change the page. Try a different element, scroll, search engine, or ask_user.'
            : ((task.workMemory && task.workMemory.searchCandidates && task.workMemory.searchCandidates.length)
              ? ('Search candidates are available (' + task.workMemory.searchCandidates.length + '). Do NOT search the same query again — navigate to the top candidate URLs and read them.')
              : ((task.clarifications && task.clarifications.length)
                ? ('User clarifications are available (' + task.clarifications.length + '). Do not re-ask; proceed with the latest answer.')
                : ''))))
      });
    } catch (e) {
      const errMsg = clip(e.message || e, 300);
      const isQuota = /\b429\b|quota|rate.?limit|resource.?exhausted|billing/i.test(errMsg);
      const isTransient = /timeout|ECONNRESET|ENOTFOUND|503|502|504|temporar/i.test(errMsg);
      if (isQuota) {
        task.aiQuotaExhausted = true;
        appLog.log('warn', 'agent.ai.quota_exhausted', { error: errMsg.slice(0, 180), step: i + 1 });
        // Prefer partial report from evidence rather than total failure
        try {
          const fin = agentReport.finalizeDoneMessage(task, task.lang === 'vi'
            ? 'AI hết hạn mức (quota). Báo cáo một phần từ bằng chứng đã thu thập.'
            : 'AI quota exhausted. Partial report from evidence already collected.');
          task.status = 'done';
          task.message = fin.message;
          task.report = fin.report;
          task.partial = true;
          push(task, 'partial_report', { message: task.message, reason: 'ai_quota' });
          push(task, 'done', { message: task.message, report: task.report, partial: true });
          await releaseAgentSession(task);
          return;
        } catch (_) {}
      }
      if (isTransient && (task.aiTransientRetries || 0) < 2) {
        task.aiTransientRetries = (task.aiTransientRetries || 0) + 1;
        appLog.log('warn', 'agent.ai.transient_retry', { error: errMsg.slice(0, 160), retry: task.aiTransientRetries });
        await sleep(800 * task.aiTransientRetries);
        i -= 1; // retry this step index
        continue;
      }
      task.status = 'failed';
      task.error = errMsg;
      task.message = task.error;
      push(task, 'failed', { message: task.message });
      await releaseAgentSession(task);
      return;
    }

    if (plan.plan) task.plan = plan.plan;
    try {
      const act0 = (plan.actions && plan.actions[0]) || plan.action;
      push(task, 'step', {
        message: clip(plan.thought || plan.next_goal || (act0 && act0.type) || 'step', 200),
        thought: clip(plan.thought || '', 240),
        next_goal: clip(plan.next_goal || '', 200),
        action: act0 || null,
        url: (task.session && (task.session.url || task.session.lastUrl)) || ''
      });
    } catch (_) {}
    if (plan.thought) task.history.push({ step: i + 1, thought: clip(plan.thought, 400) });

    // Record coarse action signature for loop detector
    try {
      const primary = (Array.isArray(plan.actions) && plan.actions[0]) || plan.action || {};
      const sig = String(primary.type || '') + ':' + String(primary.query || primary.url || primary.id || '').slice(0, 80) + ':' + String((task.lastToolResult && task.lastToolResult.outcome) || '');
      task._actionSigs = (task._actionSigs || []).concat([sig]).slice(-8);
    } catch (_) {}
    // Multi-action: up to 4 safe actions; terminal actions (done/ask/fail) must stand alone
    let actions = Array.isArray(plan.actions) && plan.actions.length
      ? plan.actions.slice(0, 4)
      : plan.action
        ? [plan.action]
        : [];
    actions = actions.map((a) => { if (!a || !['error','exception','unknown'].includes(String(a.type || '').toLowerCase())) return a; task.errors = task.errors || []; task.errors.push({ at: new Date().toISOString(), step: i + 1, message: clip(a.message || a.reason || ('Planner returned ' + a.type), 180) }); return { type: 'wait', ms: 700, _recoveredFrom: a.type }; });
    // Auto-adjust planner search query when previous search was low quality
    try {
      const primary0 = (actions[0] || plan.action || null);
      if (primary0 && primary0.type === 'search' && Array.isArray(task._suggestedQueries) && task._suggestedQueries.length) {
        const nextQ = task._suggestedQueries.shift();
        if (nextQ && String(nextQ).trim()) {
          appLog.log('info', 'agent.search.planner_query_rewritten', {
            from: String(primary0.query || '').slice(0, 100),
            to: String(nextQ).slice(0, 100)
          });
          primary0.query = nextQ;
          if (plan.action && plan.action.type === 'search') plan.action.query = nextQ;
          plan.thought = (plan.thought || '') + ' | auto_query_adjust';
        }
      }
    } catch (_) {}

    // If the planner repeats a search that already returned candidates, open the
    // *best relevant* candidate — never a random first SERP hit (forums/Q&A).
    try {
      const cands = (task.workMemory && task.workMemory.searchCandidates) || [];
      const primary = (actions[0] || plan.action || null);
      if (primary && primary.type === 'search' && cands.length) {
        const q = String(primary.query || '').trim().toLowerCase();
        const recentSearch = (task.history || []).filter((h) => h && h.action && h.action.type === 'search').slice(-6);
        const sameQ = recentSearch.filter((h) => String((h.action && h.action.query) || '').trim().toLowerCase() === q).length;
        // Only force-open when THIS query already produced structured results once
        const sameQOk = recentSearch.some((h) => {
          const hq = String((h.action && h.action.query) || '').trim().toLowerCase();
          return hq === q && /candidates|Structured search/i.test(String(h.result || ''));
        });
        if (sameQ >= 1 && sameQOk) {
          task._openedCandidateUrls = task._openedCandidateUrls || new Set();
          // Also skip URLs already visited in this task
          const visited = new Set([...(task.workMemory.visited || []), ...task._openedCandidateUrls]);
          const pick = (agentSearch.pickBestCandidate
            ? agentSearch.pickBestCandidate(cands, q, { excludeUrls: visited, minScore: -10 })
            : null);
          if (pick && pick.url) {
            task._openedCandidateUrls.add(pick.url);
            appLog.log('info', 'agent.search.force_open_candidate', {
              query: q.slice(0, 120),
              url: String(pick.url).slice(0, 180),
              score: pick.relevanceScore,
              priorSearches: sameQ
            });
            plan.thought = (plan.thought || '') + ' | force_open_search_candidate score=' + (pick.relevanceScore || 0);
            plan.action = { type: 'navigate', url: pick.url };
            plan.actions = [plan.action];
            actions = plan.actions;
          } else {
            appLog.log('warn', 'agent.search.no_quality_candidate', {
              query: q.slice(0, 120),
              candCount: cands.length
            });
            try {
              const ranked = agentSearch.rankCandidates ? agentSearch.rankCandidates(cands, q) : cands;
              task.workMemory.searchCandidates = ranked.filter((c) => (c.relevanceScore || 0) > -20).slice(0, 8);
            } catch (_) {}
            // Auto-suggest adjusted queries for the next planner step
            try {
              const tried = (task.searchAttempts || []).map((a) => a.query).concat([q]);
              const nexts = agentSearch.buildQueryVariants
                ? agentSearch.buildQueryVariants(q, { tried, locale: task.lang || 'en', limit: 4 })
                : [];
              if (nexts.length) {
                task._suggestedQueries = nexts;
                task._forceProgressHint =
                  (task.lang === 'vi'
                    ? 'Kết quả search chất lượng thấp. Hãy search với query đã điều chỉnh: '
                    : 'Low-quality search results. Search again using adjusted query: ') + nexts[0];
                appLog.log('info', 'agent.search.suggest_adjusted_queries', { next: nexts[0].slice(0, 120), n: nexts.length });
              }
            } catch (_) {}
          }
        }
      }
    } catch (_) {}

    const terminal = actions.filter((a) => a && ['done', 'ask_user', 'fail'].includes(a.type));
    const nonTerm = actions.filter((a) => a && !['done', 'ask_user', 'fail'].includes(a.type));
    if (terminal.length && nonTerm.length) {
      // Prefer doing real work first; defer done to next loop after observation
      actions = nonTerm;
    } else if (terminal.length) {
      actions = [terminal[0]];
    }

    if (!actions.length) {
      if (plan.done) {
        task.status = 'done';
        const fin = agentReport.finalizeDoneMessage(task, plan.message || plan.summary || '');
        task.message = fin.message;
        task.report = fin.report;
        push(task, 'done', { message: task.message, report: task.report });
        await releaseAgentSession(task);
        return;
      }
      if (plan.ask_user) {
        task.status = 'waiting_user';
        task.message = plan.message || plan.ask_user;
        push(task, 'ask_user', { message: task.message });
        return;
      }
      task.status = 'failed';
      task.message = 'No action planned';
      task.errors = task.errors || []; task.errors.push({ at: new Date().toISOString(), step: i + 1, message: task.message });
      push(task, 'failed', { message: task.message });
      await releaseAgentSession(task);
      return;
    }

    for (const action of actions) {
      if (!action || !action.type) continue;
      if (action.type === 'done') {
        let rawSummary = action.summary || action.message || plan.message || plan.thought || '';
        const checklist = task.checklist || null;
        const visitedDomains = new Set((task.workMemory && task.workMemory.visited || []).map((u) => {
          try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; }
        }).filter(Boolean));
        const ledgerCount = agentEvidence.loadLedger(task.id).length;
        const stepsLeft = (task.maxSteps || 40) - (i + 1);
        if (checklist && Array.isArray(checklist.sources) && checklist.sources.length && stepsLeft > 0) {
          const sourceStatus = task.sourcesStatus || {};
          const missing = checklist.sources.filter((s) => {
            const d = String(s).toLowerCase().replace(/^www\./, '');
            const visited = [...visitedDomains].some((v) => v === d || v.endsWith('.' + d) || d.endsWith('.' + v));
            const statusKey = Object.keys(sourceStatus).find(h => h === d || h.endsWith('.' + d) || d.endsWith('.' + h));
            const status = statusKey && sourceStatus[statusKey];
            return !visited && !(status && ['failed','blocked'].includes(status.status) && String(status.reason || '').trim());
          });
          if (missing.length) {
            task.workMemory = task.workMemory || {};
            task.workMemory.todo = (task.workMemory.todo || []).concat(missing.map((m) => 'cover source ' + m)).slice(-20);
            task.noProgressDoneAttempts = (task.noProgressDoneAttempts || 0) + 1;
            if (task.noProgressDoneAttempts < 2 && stepsLeft > 1) {
              task.message = task.lang === 'vi'
                ? 'Còn thiếu nguồn bắt buộc: ' + missing.slice(0, 5).join(', ') + '. Đang thử lại bằng công cụ đọc nguồn.'
                : 'Required sources still missing: ' + missing.slice(0, 5).join(', ') + '. Retrying with source-reading tools.';
              push(task, 'status', { message: task.message, missingSources: missing.slice(0, 10), retry: task.noProgressDoneAttempts });
              continue;
            }
            // Never loop forever on unavailable sources: mark them blocked with a reason and finalize a partial report.
            task.sourcesStatus = task.sourcesStatus || {};
            for (const source of missing) {
              const d = String(source).toLowerCase().replace(/^www\./, '');
              const k = Object.keys(task.sourcesStatus).find(h => h === d || h.endsWith('.' + d) || d.endsWith('.' + h));
              if (!k || !['failed','blocked'].includes(task.sourcesStatus[k].status)) {
                task.sourcesStatus[d] = { status: 'blocked', reason: 'Source was not successfully reached within the task step budget.', at: new Date().toISOString() };
              }
            }
            push(task, 'status', { message: task.lang === 'vi'
              ? 'Một số nguồn chưa truy cập được sau khi thử lại. Đang hoàn tất báo cáo một phần và ghi rõ hạn chế.'
              : 'Some sources remained unavailable after retry. Finalizing a partial report with explicit limitations.', missingSources: missing.slice(0, 10) });
          }
        }
        // Phase 4/7: research coverage gate — never done on 0 verified for research-like tasks
        try {
          if (task.researchTarget == null) {
            task.researchTarget = agentEvidence.parseTargetSourceCount(task.task || task.brief || '');
            const blob = String(task.task || task.brief || '');
            if (task.researchTarget == null && /\b(research|report|forecast|trends?|phân tích|báo cáo|nghiên cứu|gartner|mckinsey|forrester|industry)\b/i.test(blob)) {
              task.researchTarget = 2;
            }
          }
          const cov = agentEvidence.researchCoverage(task.id, { target: task.researchTarget });
          task.researchCoverage = cov;
          const stepsLeft2 = (task.maxSteps || 40) - (i + 1);
          const needMore = (cov.target && cov.targetMet === false) || (cov.verified === 0 && task.researchTarget);
          if (needMore && stepsLeft2 > 2 && (task._coverageRetry || 0) < 3) {
            task._coverageRetry = (task._coverageRetry || 0) + 1;
            task.message = task.lang === 'vi'
              ? ('Chưa đủ nguồn đã xác minh: verified=' + cov.verified + ', hosts=' + cov.independentHosts + (cov.target != null ? ('/' + cov.target) : '') + '. Tiếp tục navigate + extract trang gốc — không done trên snippet.')
              : ('Verified sources insufficient: verified=' + cov.verified + ', hosts=' + cov.independentHosts + (cov.target != null ? ('/' + cov.target) : '') + '. Continue navigate+extract primary pages — do not done on snippets alone.');
            push(task, 'status', { message: task.message, researchCoverage: cov });
            task.workMemory = task.workMemory || {};
            task.workMemory.todo = (task.workMemory.todo || []).concat(['navigate candidate then extract']).slice(-20);
            const cands = (task.workMemory.searchCandidates || []).filter((c) => c && c.url);
            const next = cands.find((c) => !(task.workMemory.visited || []).includes(c.url));
            task._forceProgressHint = task.message + (next ? (' Next URL: ' + next.url) : '');
            continue;
          }
          if (cov.limitations) {
            rawSummary = String(rawSummary || '') + '\n\n## ' + (task.lang === 'vi' ? 'Phạm vi & hạn chế nghiên cứu' : 'Research scope & limitations') + '\n' + cov.limitations;
          }
        } catch (_) {}
        task.status = 'done';
        const fin = agentReport.finalizeDoneMessage(task, rawSummary);
        task.message = fin.message;
        task.report = fin.report;
        if (task.researchCoverage && task.report) task.report.researchCoverage = task.researchCoverage;
        task.lastDoneSummary = rawSummary;
        push(task, 'done', { message: task.message, report: task.report, researchCoverage: task.researchCoverage || null });
        await releaseAgentSession(task);
        return;
      }
      if (action.type === 'ask_user' || action.type === 'fail') {
        const qText = String(action.question || action.message || plan.message || '').trim();
        // Anti-repeat: if user already clarified and AI asks the same question again, skip ask_user
        if (action.type === 'ask_user' && (task.clarifications || []).length) {
          const prevAsks = (task.history || [])
            .filter((h) => h && h.action && h.action.type === 'ask_user')
            .map((h) => h.action.question || h.result || '');
          const clarifiedAfter = (task.clarifications || []).slice(-3).map((c) => (typeof c === 'string' ? c : c.text) || '');
          const sameAsBefore = prevAsks.some((pq) => isSimilarAsk(pq, qText));
          if (sameAsBefore && clarifiedAfter.length) {
            appLog.log('warn', 'agent.ask_user_suppressed_repeat', { question: qText.slice(0, 120) });
            task.history.push({
              step: i + 1,
              thought: plan.thought || '',
              action: { type: 'note', text: 'repeat_ask_suppressed' },
              result: 'used_prior_clarification',
              url: session.url || '',
              at: new Date().toISOString()
            });
            // Inject a stuck hint for next loop: force progress with last answer
            task._forceProgressHint = (task.lang === 'vi'
              ? 'Người dùng đã trả lời: «' + String(clarifiedAfter[clarifiedAfter.length - 1]).slice(0, 200) + '». Không hỏi lại. Hãy dùng câu trả lời này và tiếp tục nhiệm vụ đến done.'
              : 'User already answered: «' + String(clarifiedAfter[clarifiedAfter.length - 1]).slice(0, 200) + '». Do not re-ask. Use this answer and continue to done.');
            continue;
          }
        }
        task.status = action.type === 'fail' ? 'failed' : 'waiting_user';
        task.message = terminalMessage(action, plan);
        if (action.type === 'ask_user') {
          task.pendingAsk = true;
          task.lastAskQuestion = qText;
        }
        if (action.type === 'fail') { task.errors = task.errors || []; task.errors.push({ at: new Date().toISOString(), step: i + 1, message: task.message }); }
        push(task, action.type === 'fail' ? 'failed' : 'ask_user', { message: task.message, question: qText, options: Array.isArray(action.options) ? action.options : [], kind: action.kind || 'clarify' });
        if (action.type === 'fail') await releaseAgentSession(task);
        return;
      }

      const el = obs.elements && action.id != null ? obs.elements.find((e) => e.id === Number(action.id)) : null;
      const risk = actionRisk(action, el && el.label);
      if (risk === 'high' && !task.trustLowRisk) {
        task.status = 'waiting_confirmation';
        task.confirmation = {
          id: crypto.randomBytes(8).toString('hex'),
          text:
            (task.lang === 'vi' ? 'Xác nhận hành động rủi ro: ' : 'Confirm risky action: ') +
            action.type +
            (el ? ' — ' + clip(el.label, 80) : '')
        };
        task.pendingAction = action;
        task.message = task.confirmation.text;
        push(task, 'confirm', { message: task.message, risk });
        return;
      }

      push(task, 'step', { n: i + 1, action: { type: action.type, id: action.id } });
      const preUrl = session.url || (obs && obs.url) || '';
      let out;
      try {
        out = await executeAction(task, session, action, obs);
      } catch (e) {
        out = { ok: false, result: clip(e.message || e, 200) };
      }

      await waitStable(session);
      const obs2 = await observeSession(session, task.readOffset || 0, task);
      const hash2 = observer.hashObservation(obs2);
      const noEffect = hash2 === obsHash && action.type !== 'wait' && action.type !== 'note' && action.type !== 'read';
      task.history.push({
        step: i + 1,
        thought: plan.thought ? clip(plan.thought, 400) : undefined,
        action: {
          type: action.type,
          id: action.id,
          url: action.url,
          query: action.query,
          text: action.text ? String(action.text).slice(0, 80) : undefined,
          key: action.key,
          engine: action.engine
        },
        result: clip(out.result, 1200),
        ok: !!out.ok,
        no_effect: noEffect,
        url: obs2.url
      });
      // Phase 3: track DOM action health for next vision gate
      try {
        task._lastActionFailed = !out.ok || noEffect;
        task._lastErrorCode = (out && out.code) || (noEffect ? 'NO_EFFECT' : '') || '';
        if (noEffect || !out.ok) task._consecutiveNoEffect = (task._consecutiveNoEffect || 0) + 1;
        else task._consecutiveNoEffect = 0;
      } catch (_) {}
      try {
        if (!out.ok && (out.code === 'NAV_CHROME_ERROR' || out.code === 'NAV_FAILED' || /chrome_error|navigation_failed/i.test(String(out.result || '')))) {
          const cands = (task.workMemory && task.workMemory.searchCandidates) || [];
          const next = cands.find((c) => c && c.url && !(task.workMemory.visited || []).includes(c.url));
          task._forceProgressHint = (task.lang === 'vi'
            ? 'Trang vừa mở lỗi (chrome-error/network). KHÔNG done. Hãy navigate URL ứng viên khác từ SEARCH_CANDIDATES'
            : 'Last navigation failed (chrome-error/network). Do NOT done. Navigate another SEARCH_CANDIDATES URL')
            + (next ? (': ' + next.url) : '')
            + '. Then extract. Search snippets alone are not verified evidence.';
        }
        if (out.ok && action.type === 'navigate' && out.evidenceId) {
          task._forceProgressHint = null;
        }
        if (out.ok && action.type === 'navigate' && !out.evidenceId) {
          task._forceProgressHint = task.lang === 'vi'
            ? 'Đã mở trang nhưng chưa có evidence — bước tiếp theo phải extract.'
            : 'Page opened but no evidence yet — next action must be extract.';
        }
      } catch (_) {}
      try {
        task._lastObservation = obs2;
        // Free screenshot bytes after the step — next observe may re-capture if needed
        agentResource.clearObsVision(obs2);
        agentResource.hygieneAfterStep(task, { force: false });
      } catch (_) {}
      // Live DOM Bridge mirror for the user UI (shared browser)
      try {
        if (obs2 && obs2.url) {
          session.url = obs2.url;
          session.title = obs2.title || session.title;
          session.lastUrl = obs2.url;
        }
        push(task, 'action_result', {
          message: clip((plan.thought || action.type) + (out.ok ? '' : ' · ' + out.result), 220),
          result: clip(out.result, 400),
          ok: !!out.ok,
          action: action.type,
          url: (obs2 && obs2.url) || session.url || '',
          title: (obs2 && obs2.title) || session.title || '',
          n: i + 1,
          thought: clip(plan.thought || '', 240)
        });
      } catch (_) {}
      if (task.history.length > 40) task.history = task.history.slice(-30);

      recentHashes.push(obsHash + '|' + action.type);
      if (recentHashes.length > 12) recentHashes.shift();
      // Stuck: same observation hash + same action type N times
      const stuckKey = hash2 + '|' + action.type;
      const stuckCount = recentHashes.filter((h) => h.endsWith('|' + action.type) && h.startsWith(hash2)).length;
      // simpler: count consecutive identical state hashes after actions
      const lastStates = task.history.slice(-STUCK_N).map((h) => h.url + (h.no_effect ? ':ne' : ''));
      if (noEffect) {
        push(task, 'status', { message: task.lang === 'vi'
          ? ('Đang xử lý nền (bước ' + (i + 1) + ')… thao tác chưa đổi trang, thử cách khác.')
          : ('Background progress (step ' + (i + 1) + ')… page unchanged, trying another approach.'), n: i + 1 });
      }

      obs = obs2;
      if (out.ok === false && /login_requires_engine|blocked_secret/.test(String(out.result))) {
        task.status = 'waiting_user';
        task.message =
          task.lang === 'vi'
            ? 'Cần thao tác thủ công (engine/noVNC hoặc Open ↗). Không gửi mật khẩu cho AI.'
            : 'Manual action needed (engine/noVNC or Open ↗). Never send passwords to AI.';
        push(task, 'ask_user', { message: task.message });
        return;
      }
      // Early stop multi-action if URL changed by this action (compare pre/post)
      const urlBefore = preUrl || session.url || obs.url;
      if (obs2.url && urlBefore && obs2.url !== urlBefore && actions.indexOf(action) < actions.length - 1) {
        session.url = obs2.url;
        break;
      }
      session.url = obs2.url || session.url;
    }
  }
  task.status = 'limit';
  task.message =
    task.lang === 'vi'
      ? 'Hết số bước. Bấm Tiếp tục để resume (bộ nhớ nhiệm vụ được giữ).'
      : 'Step limit reached. Tap Continue to resume (task memory kept).';
  push(task, 'status', { message: task.message });
  persistTaskDisk(task);
}

function terminalMessage(action, plan) {
  const a = action || {}; const p = plan || {};
  return String(a.question || a.message || a.text || a.reason || p.question || p.message || p.text || (a.type === 'fail' ? 'Agent could not complete the task.' : 'Please clarify the next step.')).trim();
}

async function start({ ai, session, task: taskText, lang, history, maxSteps, maxMs, workMemory, resumeTaskId }) {
  for (const [id, old] of tasks) if (Date.now() - old.updatedAt > TASK_TTL_MS) {
    tasks.delete(id);
    try { fs.unlinkSync(path.join(TASK_DIR, id + '.json')); } catch (_) {}
  }
  // A client cannot inject history or work memory into another task. Resume only a task
  // already owned by this authenticated browser session (memory/disk state is server-owned).
  let restored = null;
  if (resumeTaskId) {
    restored = resolveTask(String(resumeTaskId), session.id, { liveSession: session });
    if (!restored) {
      // Stale client taskId after restart — fall through to a fresh task instead of hard fail
      appLog.log('warn', 'agent.resume_miss_start_fresh', { resumeTaskId: String(resumeTaskId).slice(0, 32) });
      restored = null;
    }
  }

  const taskTextClean = String(taskText || (restored && (restored.brief || restored.task)) || '').slice(0, 20000).trim();
  if (!taskTextClean) throw new Error('task_required');
  while (tasks.size >= MAX_TASKS) tasks.delete(tasks.keys().next().value);

  const steps = Math.min(AGENT_MAX_STEPS, Math.max(1, Number(maxSteps) || Number(restored && restored.maxSteps) || 40));
  const ms = Math.min(3 * 3600000, Math.max(60000, Number(maxMs) || Number(restored && restored.maxMs) || 3600000));

  const task = {
    id: (restored && restored.id) || crypto.randomBytes(16).toString('hex'),
    sessionId: session.id,
    session,
    task: taskTextClean,
    brief: taskTextClean,
    spec: (restored && restored.spec) || taskAnalyzer.analyzeTask(taskTextClean, lang),
    clarifications: (restored && restored.clarifications) || [],
    checklist: (restored && restored.checklist) || null,
    sourcesStatus: (restored && restored.sourcesStatus) || {},
    lang: lang === 'vi' ? 'vi' : 'en',
    history: (restored && Array.isArray(restored.history) ? restored.history : []),
    maxSteps: steps,
    maxMs: ms,
    workMemory: (restored && restored.workMemory && typeof restored.workMemory === 'object') ? restored.workMemory : { findings: [], visited: [], notes: [], todo: [], searchCandidates: [] },
    errors: (restored && Array.isArray(restored.errors)) ? restored.errors : [],
    plan: (restored && restored.plan) || null,
    status: 'running',
    message: '',
    error: '',
    events: [],
    eventSeq: 0,
    updatedAt: Date.now(),
    startedAt: Date.now(),
    stop: false,
    confirmation: null,
    urlStack: session.url ? [session.url] : (restored && restored.urlStack) || [],
    urlIndex: 0,
    readOffset: 0
  };
  ensureTaskState(task);
  syncTaskState(task);
  // Shared Chromium: Agent uses the same browser session as the user so live pages
  // appear in the UI. While the agent runs, the client locks interactive controls.
  const share = String(process.env.SOLOHOST_AGENT_SHARED_BROWSER == null ? '1' : process.env.SOLOHOST_AGENT_SHARED_BROWSER).trim() !== '0';
  try {
    if (share && session && session.id) {
      task.session = session;
      task.browserSessionId = session.id;
      task.sharedBrowser = true;
      pinAndTouchAgentSession(task);
    } else {
      await ensureTaskBrowserSession(task);
      task.sharedBrowser = false;
    }
  } catch (e) {
    task.errors = task.errors || [];
    task.errors.push({ at: new Date().toISOString(), message: 'Could not attach browser session: ' + clip(e.message || e, 180) });
    throw new Error('agent_browser_session_create_failed: ' + clip(e.message || e, 120));
  }
  // AI-first dynamic playbook (no static sample required)
  if (!task.checklist || !(restored && restored.checklist)) {
    try {
      const built = await playbooks.buildTaskPlaybook(ai, task.brief || task.task, task.lang);
      if (built && built.checklist) {
        task.checklist = built.checklist;
        task.playbook = 'dynamic';
        task.dynamicPlan = built.plan || null;
        task.plan = task.plan || {
          playbook: 'dynamic',
          goal: (built.plan && built.plan.goal) || task.brief,
          steps: (built.plan && built.plan.steps) || [],
          jobs: ((built.plan && built.plan.steps) || []).map((s, i) => ({ id: 'd' + (i + 1), label: s, kind: 'step' }))
        };
        push(task, 'status', {
          message: task.lang === 'vi'
            ? ('Kế hoạch Agent: ' + ((built.plan && built.plan.goal) || task.brief || '').slice(0, 160))
            : ('Agent plan: ' + ((built.plan && built.plan.goal) || task.brief || '').slice(0, 160)),
          plan: task.plan,
          checklist: task.checklist
        });
      }
    } catch (e) {
      appLog.log('warn', 'agent.dynamic_playbook_fail', { error: String(e.message || e).slice(0, 160) });
    }
  }
  if (!task.checklist) {
    task.checklist = taskAnalyzer.buildChecklist(task.spec || {});
  }
  if (!task.plan) {
    try {
      let planned = agentPlanner.planFromRules(task.brief, task.lang);
      if ((!planned.jobs || !planned.jobs.length) && /giá|bán|nơi bán|rao|cũ|quảng trị|chợ tốt|xe điện|thuê|mua bán/i.test(task.brief || '')) {
        const q = String(task.brief || '').slice(0, 120);
        planned = {
          intent: 'TASK',
          playbook: 'research_listings',
          goal: q,
          jobs: [
            { id: 's1', label: 'Search primary', kind: 'search', params: { query: q }, depends_on: [], fallbacks: [] },
            { id: 's2', label: 'Search Chotot', kind: 'search', params: { query: q + ' chotot' }, depends_on: [], fallbacks: ['s1'] },
            { id: 's3', label: 'Search local', kind: 'search', params: { query: q + ' mua bán' }, depends_on: [], fallbacks: ['s1'] },
            { id: 'syn', label: 'Synthesize', kind: 'synthesize', params: {}, depends_on: ['s1', 's2', 's3'], fallbacks: [] }
          ]
        };
      }
      task.plan = {
        title: planned.goal || (task.spec && task.spec.goal ? clip(task.spec.goal, 160) : (task.lang === 'vi' ? 'Kế hoạch nhiệm vụ' : 'Task plan')),
        playbook: planned.playbook || null,
        jobs: planned.jobs || [],
        steps: (planned.jobs || []).map((j, i) => ({ id: j.id || ('step-' + (i + 1)), title: j.label || j.kind, status: 'pending', evidence_count: 0 })),
        sources: (task.spec && task.spec.sources) || [],
        status: 'ready',
        intent: planned.intent
      };
      ensureTaskState(task);
      task.taskState.plan = task.plan;
    } catch (_) {
      task.plan = { title: task.lang === 'vi' ? 'Kế hoạch nhiệm vụ' : 'Task plan', steps: [], sources: [], status: 'ready' };
    }
  }
  task.ai = ai;
  tasks.set(task.id, task);
  persistTaskDisk(task);
  push(task, 'status', { message: task.lang === 'vi' ? 'Bắt đầu nhiệm vụ…' : 'Starting task…' });
  setImmediate(() => {
    runTask(ai, task).catch((e) => {
      task.status = 'failed';
      task.error = clip(e.message || e, 200);
      task.message = task.error;
      task.errors = task.errors || []; task.errors.push({ at: new Date().toISOString(), message: task.error });
      push(task, 'failed', { message: task.message });
      releaseAgentSession(task).catch(() => {});
    });
  });
  return publicTask(task);
}

async function confirm(taskId, sessionId, confirmationId, accepted) {
  const task = getTask(taskId, sessionId);
  if (!task) return null;
  if (!task.confirmation || task.confirmation.id !== confirmationId) return publicTask(task);
  task.confirmation = null;
  if (!accepted) {
    task.status = 'stopped';
    task.message = task.lang === 'vi' ? 'Đã từ chối hành động.' : 'Action declined.';
    push(task, 'status', { message: task.message });
    releaseAgentSession(task).catch(() => {});
    return publicTask(task);
  }
  task.status = 'running';
  const action = task.pendingAction;
  task.pendingAction = null;
  setImmediate(async () => {
    try {
      if (action) {
        const obs = await observeSession(task.session, task.readOffset || 0);
        await executeAction(task, task.session, action, obs);
      }
      await runTask(task.ai, task);
    } catch (e) {
      task.status = 'failed';
      task.message = clip(e.message || e, 200);
      push(task, 'failed', { message: task.message });
    }
  });
  // Re-run needs ai — store on task
  return publicTask(task);
}

async function continueTask(taskId, sessionId, liveSession, ai) {
  let task = resolveTask(taskId, sessionId, { liveSession });
  if (!task) return null;
  if (ai) task.ai = ai;
  if (liveSession) {
    task.session = liveSession;
    task.sessionId = sessionId || liveSession.id;
    task.browserSessionId = liveSession.id;
    task.sharedBrowser = task.sharedBrowser !== false;
    try { pinAndTouchAgentSession(task); } catch (_) {}
  }
  // Already running: do NOT restart — return live progress snapshot
  if (['running', 'waiting_confirmation', 'stopping'].includes(task.status)) {
    push(task, 'status', {
      message: task.lang === 'vi'
        ? ('Nhiệm vụ vẫn đang chạy · bước ' + ((task.history && task.history.length) || 0) + ' · không bắt đầu lại.')
        : ('Task still running · step ' + ((task.history && task.history.length) || 0) + ' · not restarting.')
    });
    return publicTask(task);
  }
  // waiting_user: Continue without a new answer only re-prompts — do not fake progress
  if (task.status === 'waiting_user') {
    push(task, 'ask_user', {
      message: task.message || (task.lang === 'vi'
        ? 'Agent đang chờ câu trả lời của bạn. Hãy gõ trả lời trong Chat (không bấm Tiếp tục trống).'
        : 'Agent is waiting for your reply. Type the answer in Chat (do not press Continue empty).'),
      question: task.lastAskQuestion || task.message || ''
    });
    return publicTask(task);
  }
  // Resume from limit / stopped / failed / done (Continue after partial or completed)
  if (!['limit', 'stopped', 'failed', 'done', 'cancelled'].includes(task.status)) {
    // waiting_user: treat answer path instead; still allow soft continue
    if (task.status !== 'waiting_user') return null;
  }
  try {
    if (task.sharedBrowser && task.session) {
      pinAndTouchAgentSession(task);
    } else {
      await ensureTaskBrowserSession(task);
    }
  } catch (e) {
    task.status = 'failed';
    task.message = clip(e.message || e, 200);
    task.errors = (task.errors || []).concat([{ at: new Date().toISOString(), message: task.message }]);
    push(task, 'failed', { message: task.message });
    return publicTask(task);
  }
  const prevSteps = (task.history && task.history.length) || 0;
  task.status = 'running';
  task.stop = false;
  task.error = '';
  task.message = '';
  task.startedAt = Date.now();
  task.updatedAt = Date.now();
  // Keep history / workMemory / evidence — only extend maxSteps budget
  task.maxSteps = Math.max(task.maxSteps || 40, prevSteps + 40);
  push(task, 'status', {
    message: task.lang === 'vi'
      ? ('Tiếp tục nhiệm vụ cũ từ bước ' + prevSteps + ' (giữ bằng chứng, không chạy lại từ đầu)…')
      : ('Resuming same task from step ' + prevSteps + ' (evidence kept, not restarting)…')
  });
  setImmediate(() => runTask(task.ai, task).catch(async (e) => {
    task.status = 'failed';
    task.message = clip(e.message || e, 200);
    task.errors = (task.errors || []).concat([{ at: new Date().toISOString(), message: task.message }]);
    push(task, 'failed', { message: task.message });
    await releaseAgentSession(task);
  }));
  return publicTask(task);
}

async function answer(taskId, sessionId, text, liveSession, ai) {
  const task = resolveTask(taskId, sessionId, liveSession ? { liveSession } : null);
  if (!task) return null;
  const value = String(text || '').trim().slice(0, 10000);
  if (!value) return publicTask(task);
  if (ai) task.ai = ai;
  // Re-bind live session so shared browser keeps showing Agent activity
  if (liveSession) {
    task.session = liveSession;
    task.sessionId = liveSession.id || sessionId;
    task.browserSessionId = liveSession.id || task.browserSessionId;
    task.sharedBrowser = task.sharedBrowser !== false;
    try { pinAndTouchAgentSession(task); } catch (_) {}
  }
  task.clarifications = task.clarifications || [];
  const lastQ = task.lastAskQuestion || '';
  task.clarifications.push({
    text: value,
    at: new Date().toISOString(),
    answeredQuestion: lastQ || undefined
  });
  // Also mirror into work memory so planStep always sees the answer
  task.workMemory = task.workMemory || { findings: [], notes: [], visited: [], todo: [] };
  task.workMemory.notes = task.workMemory.notes || [];
  task.workMemory.notes.push({
    at: new Date().toISOString(),
    text: (lastQ ? ('Q: ' + String(lastQ).slice(0, 160) + ' | A: ') : 'User answer: ') + value.slice(0, 400)
  });
  if (task.workMemory.notes.length > 30) task.workMemory.notes = task.workMemory.notes.slice(-24);
  task.pendingAsk = false;
  task.lastUserAnswer = value;
  task.status = 'running';
  task.message = '';
  task.stop = false;
  task.updatedAt = Date.now();
  // Extend step budget so resume is not immediately limited
  const prevSteps = (task.history && task.history.length) || 0;
  task.maxSteps = Math.max(task.maxSteps || 40, prevSteps + 30);
  task.startedAt = Date.now();
  try { persistTaskDisk(task); } catch (_) {}
  push(task, 'status', {
    message: task.lang === 'vi'
      ? ('Đã nhận câu trả lời: «' + value.slice(0, 80) + '». Tiếp tục nhiệm vụ…')
      : ('Answer received: «' + value.slice(0, 80) + '». Resuming task…')
  });
  const runner = task.ai;
  setImmediate(() => runTask(runner, task).catch((e) => {
    task.status = 'failed';
    task.message = clip(e.message || e, 200);
    task.errors = (task.errors || []).concat([{ at: new Date().toISOString(), message: task.message }]);
    push(task, 'failed', { message: task.message });
  }));
  return publicTask(task);
}

function stop(taskId, sessionId) {
  const task = resolveTask(taskId, sessionId, null);
  if (!task) return { ok: false, error: 'task_not_found' };
  task.stop = true;
  task.status = 'stopping';
  return publicTask(task);
}

/** API: GET task progress (events after cursor). */
function status(taskId, sessionId, after) {
  const task = resolveTask(taskId, sessionId, null);
  if (!task) return { ok: false, error: 'task_not_found' };
  return publicTask(task, Number(after) || 0);
}

module.exports = {
  start,
  status,
  getTask,
  resolveTask,
  publicTask,
  stop,
  confirm,
  answer,
  continueTask,
  observeSession,
  observeHtmlFallback,
  summarizeWorkMemory,
  actionRisk,
  AGENT_MAX_STEPS
};
