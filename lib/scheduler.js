'use strict';
/**
 * Phase 6 — In-process workflow scheduler.
 * Schedules persist in /app/data/schedules.json. Only runs while the app process is alive.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_SCHEDULES = Math.max(5, Math.min(50, parseInt(process.env.SOLOHOST_SCHEDULER_MAX || '20', 10) || 20));
const MAX_CONCURRENT = Math.max(1, Math.min(3, parseInt(process.env.SOLOHOST_SCHEDULER_CONCURRENT || '1', 10) || 1));
const MAX_RETRIES = 2;
const FAIL_DISABLE_AFTER = 5;

let store = { schedules: [], history: [] };
let timer = null;
let running = new Set();
let onRun = null; // async (schedule) => result
let started = false;

function dataDir() {
  return process.env.SOLOHOST_DATA_DIR || path.join(__dirname, '..', 'data');
}
function storePath() {
  return path.join(dataDir(), 'schedules.json');
}
function load() {
  try {
    fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    if (fs.existsSync(storePath())) {
      store = JSON.parse(fs.readFileSync(storePath(), 'utf8'));
      if (!Array.isArray(store.schedules)) store.schedules = [];
      if (!Array.isArray(store.history)) store.history = [];
    }
  } catch (_) {
    store = { schedules: [], history: [] };
  }
}
function save() {
  try {
    fs.mkdirSync(dataDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(storePath(), JSON.stringify(store, null, 2), { mode: 0o600 });
  } catch (_) {}
}
function id() {
  return crypto.randomBytes(6).toString('hex');
}

function listSchedules() {
  return store.schedules.map(publicSchedule);
}
function publicSchedule(s) {
  return {
    id: s.id,
    workflowId: s.workflowId,
    name: s.name,
    type: s.type,
    time: s.time,
    days: s.days || [],
    timezone: s.timezone || 'UTC',
    enabled: !!s.enabled,
    nextRunAt: s.nextRunAt || null,
    lastRunAt: s.lastRunAt || null,
    lastStatus: s.lastStatus || null,
    failCount: s.failCount || 0,
    catchUp: s.catchUp || 'skip'
  };
}

function computeNextRun(s, fromDate) {
  const now = fromDate || new Date();
  const tz = s.timezone || 'UTC';
  const [hh, mm] = String(s.time || '09:00').split(':').map((x) => parseInt(x, 10) || 0);
  if (s.type === 'once') {
    const at = s.runAt ? new Date(s.runAt) : null;
    if (at && at > now) return at.toISOString();
    return null;
  }
  // daily / weekly — approximate with local interpretation of hh:mm in given tz via ISO offset naive
  const candidate = new Date(now.getTime());
  candidate.setSeconds(0, 0);
  // Use UTC fields as stable baseline; UI should pass timezone label for display
  candidate.setUTCHours(hh, mm, 0, 0);
  if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 1);
  if (s.type === 'weekly' && Array.isArray(s.days) && s.days.length) {
    for (let i = 0; i < 8; i++) {
      const d = new Date(candidate.getTime() + i * 86400000);
      const dow = d.getUTCDay(); // 0=Sun
      if (s.days.map(Number).includes(dow) && d > now) return d.toISOString();
    }
  }
  return candidate.toISOString();
}

function addSchedule(input) {
  load();
  if (store.schedules.length >= MAX_SCHEDULES) return { ok: false, error: 'max_schedules' };
  const s = {
    id: id(),
    workflowId: String(input.workflowId || ''),
    name: String(input.name || 'Scheduled job').slice(0, 80),
    type: ['once', 'daily', 'weekly'].includes(input.type) ? input.type : 'daily',
    time: String(input.time || '09:00').slice(0, 5),
    days: Array.isArray(input.days) ? input.days.map(Number).slice(0, 7) : [],
    timezone: String(input.timezone || 'UTC').slice(0, 64),
    runAt: input.runAt || null,
    enabled: input.enabled !== false,
    catchUp: input.catchUp === 'run' ? 'run' : 'skip',
    failCount: 0,
    lastRunAt: null,
    lastStatus: null,
    nextRunAt: null,
    createdAt: new Date().toISOString()
  };
  if (!s.workflowId) return { ok: false, error: 'workflowId_required' };
  s.nextRunAt = computeNextRun(s);
  store.schedules.push(s);
  save();
  return { ok: true, schedule: publicSchedule(s) };
}

function updateSchedule(sid, patch) {
  load();
  const s = store.schedules.find((x) => x.id === sid);
  if (!s) return { ok: false, error: 'not_found' };
  if (patch.name != null) s.name = String(patch.name).slice(0, 80);
  if (patch.enabled != null) s.enabled = !!patch.enabled;
  if (patch.time != null) s.time = String(patch.time).slice(0, 5);
  if (patch.days != null) s.days = [].concat(patch.days).map(Number).slice(0, 7);
  if (patch.catchUp != null) s.catchUp = patch.catchUp === 'run' ? 'run' : 'skip';
  if (patch.timezone != null) s.timezone = String(patch.timezone).slice(0, 64);
  s.nextRunAt = computeNextRun(s);
  save();
  return { ok: true, schedule: publicSchedule(s) };
}

function removeSchedule(sid) {
  load();
  const n = store.schedules.length;
  store.schedules = store.schedules.filter((x) => x.id !== sid);
  save();
  return { ok: store.schedules.length < n };
}

function history(limit) {
  return (store.history || []).slice(0, Math.min(100, limit || 30));
}

function pushHistory(entry) {
  store.history = [entry].concat(store.history || []).slice(0, 100);
  save();
}

async function tick() {
  if (!onRun) return;
  load();
  const now = Date.now();
  for (const s of store.schedules) {
    if (!s.enabled) continue;
    if (running.size >= MAX_CONCURRENT) break;
    if (running.has(s.id)) continue;
    if (!s.nextRunAt) continue;
    const due = new Date(s.nextRunAt).getTime();
    if (due > now) continue;
    // catch-up policy
    const lateMs = now - due;
    if (lateMs > 2 * 3600 * 1000 && s.catchUp !== 'run') {
      s.nextRunAt = computeNextRun(s, new Date());
      s.lastStatus = 'skipped_late';
      save();
      continue;
    }
    running.add(s.id);
    try {
      const result = await onRun(s);
      s.lastRunAt = new Date().toISOString();
      s.lastStatus = (result && result.ok) ? 'ok' : 'fail';
      if (result && result.ok) s.failCount = 0;
      else {
        s.failCount = (s.failCount || 0) + 1;
        if (s.failCount >= FAIL_DISABLE_AFTER) s.enabled = false;
      }
      pushHistory({
        id: id(),
        scheduleId: s.id,
        workflowId: s.workflowId,
        at: s.lastRunAt,
        status: s.lastStatus,
        message: (result && result.message) || ''
      });
    } catch (e) {
      s.lastRunAt = new Date().toISOString();
      s.lastStatus = 'error';
      s.failCount = (s.failCount || 0) + 1;
      if (s.failCount >= FAIL_DISABLE_AFTER) s.enabled = false;
      pushHistory({ id: id(), scheduleId: s.id, at: s.lastRunAt, status: 'error', message: String(e.message || e).slice(0, 160) });
    }
    s.nextRunAt = s.type === 'once' ? null : computeNextRun(s, new Date());
    if (s.type === 'once') s.enabled = false;
    running.delete(s.id);
    save();
  }
}

function start(runner) {
  onRun = typeof runner === 'function' ? runner : null;
  load();
  // startup catch-up scan
  const now = Date.now();
  for (const s of store.schedules) {
    if (!s.enabled || !s.nextRunAt) continue;
    const due = new Date(s.nextRunAt).getTime();
    if (due < now - 2 * 3600 * 1000 && s.catchUp !== 'run') {
      s.nextRunAt = computeNextRun(s, new Date());
      s.lastStatus = 'skipped_late_startup';
    }
  }
  save();
  if (timer) clearInterval(timer);
  timer = setInterval(() => { tick().catch(() => {}); }, 30000);
  if (timer.unref) timer.unref();
  started = true;
  // one immediate tick
  setTimeout(() => { tick().catch(() => {}); }, 2000);
  return { ok: true, schedules: store.schedules.length };
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

function status() {
  return {
    started,
    schedules: store.schedules.length,
    running: running.size,
    maxConcurrent: MAX_CONCURRENT,
    note: 'Schedules only run while SoloHost Browser is active.'
  };
}

// Test helpers
function _testComputeNextRun(s, from) { return computeNextRun(s, from); }
function _testSetStore(s) { store = s; }

module.exports = {
  listSchedules,
  addSchedule,
  updateSchedule,
  removeSchedule,
  history,
  start,
  stop,
  status,
  tick,
  computeNextRun,
  MAX_SCHEDULES,
  _testComputeNextRun,
  _testSetStore,
  load,
  save
};
