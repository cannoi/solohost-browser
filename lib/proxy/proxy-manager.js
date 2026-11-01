'use strict';
const {
  STATES, loadStore, saveStore, normalizeEntry, redactStore, redactEntry,
  toPlaywrightProxy, redactErrorMessage, emptyStore
} = require('./proxy-config');
const { validateProxyHost, validateProtocol, validatePort } = require('./proxy-validator');
const { runHealthCheck, resolvePublicIpDirect } = require('./proxy-health');
const { messageFor, buildDiagnostics } = require('./proxy-diagnostics');
const { listProviders, getProvider } = require('./proxy-provider');

let store = loadStore();
let engineRestartHook = null;
const MAX_RETRIES = 2;

function setEngineRestartHook(fn) { engineRestartHook = typeof fn === 'function' ? fn : null; }
function getStore() { return store; }

function publicState(lang) {
  const red = redactStore(store);
  const entry = store.entries.find(e => e.id === store.activeId) || null;
  red.statusMessage = messageFor(store.lastStatus.state, lang, store.lastStatus.message);
  red.diagnostics = buildDiagnostics(store.lastStatus, entry);
  red.providers = listProviders();
  red.playwrightActive = !!(store.enabled && store.mode === 'proxy' && entry);
  return red;
}
function findEntry(id) { return store.entries.find(e => e.id === id) || null; }

async function upsertEntry(input) {
  validateProtocol(input.protocol || 'http');
  validatePort(input.port);
  await validateProxyHost(input.host);
  const existing = input.id ? findEntry(input.id) : null;
  const entry = normalizeEntry(input, existing || undefined);
  if (existing) store.entries = store.entries.map(e => e.id === existing.id ? entry : e);
  else store.entries.push(entry);
  saveStore(store);
  return redactEntry(entry);
}

function removeEntry(id) {
  const wasActive = store.activeId === id;
  store.entries = store.entries.filter(e => e.id !== id);
  if (wasActive) {
    store.activeId = null; store.enabled = false; store.mode = 'direct';
    store.lastStatus = { ...emptyStore().lastStatus, state: STATES.DISCONNECTED, message: 'Proxy removed', checkedAt: new Date().toISOString() };
  }
  saveStore(store);
  return publicState();
}

function setProfileProxy(profileKey, assignment) {
  const key = String(profileKey || 'default').slice(0, 128);
  const mode = assignment && assignment.mode ? String(assignment.mode) : 'global';
  if (!['direct', 'global', 'proxy'].includes(mode)) { const e = new Error('Invalid profile proxy mode'); e.code = 'INVALID_CONFIGURATION'; throw e; }
  const row = { mode };
  if (mode === 'proxy') {
    if (!findEntry(assignment.proxyId)) { const e = new Error('Unknown proxy id for profile'); e.code = 'INVALID_CONFIGURATION'; throw e; }
    row.proxyId = assignment.proxyId;
  }
  store.profiles[key] = row;
  saveStore(store);
  return publicState();
}

function resolveForProfile(profileKey) {
  if (!store.enabled || store.mode !== 'proxy') return null;
  const key = String(profileKey || 'default');
  const assign = store.profiles[key];
  if (assign && assign.mode === 'direct') return null;
  if (assign && assign.mode === 'proxy' && assign.proxyId) {
    const e = findEntry(assign.proxyId);
    return e && e.enabled !== false ? e : null;
  }
  const e = findEntry(store.activeId);
  return e && e.enabled !== false ? e : null;
}

function getPlaywrightProxyOption(profileKey) {
  return toPlaywrightProxy(resolveForProfile(profileKey));
}

async function testEntry(idOrInput, opts = {}) {
  let entry;
  if (typeof idOrInput === 'string') entry = findEntry(idOrInput);
  else {
    validateProtocol(idOrInput.protocol || 'http');
    validatePort(idOrInput.port);
    await validateProxyHost(idOrInput.host);
    entry = normalizeEntry(idOrInput, idOrInput.id ? findEntry(idOrInput.id) : undefined);
  }
  if (!entry) { const e = new Error('Proxy not found'); e.code = 'INVALID_CONFIGURATION'; throw e; }
  const health = await runHealthCheck(entry, opts);
  return {
    ok: health.ok, publicIp: health.publicIp, directIp: health.directIp, latencyMs: health.latencyMs,
    source: health.source, errorCode: health.errorCode, message: health.message,
    ipChanged: !!(health.publicIp && health.directIp && health.publicIp !== health.directIp),
    entry: redactEntry(entry)
  };
}

async function connect(opts = {}) {
  const lang = opts.lang || 'en';
  const id = opts.id || store.activeId;
  const entry = findEntry(id);
  if (!entry || entry.enabled === false) {
    store.lastStatus = { state: STATES.INVALID_CONFIGURATION, publicIp: null, directIp: null, location: null, latencyMs: null, checkedAt: new Date().toISOString(), message: 'Select a proxy configuration first', errorCode: 'INVALID_CONFIGURATION' };
    saveStore(store); return publicState(lang);
  }
  store.lastStatus = { ...store.lastStatus, state: STATES.CONNECTING, message: null, errorCode: null, checkedAt: new Date().toISOString() };
  saveStore(store);
  let last = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    last = await runHealthCheck(entry, { timeoutMs: opts.timeoutMs });
    if (last.ok) break;
    if (last.errorCode === 'AUTHENTICATION_FAILED' || last.errorCode === 'INVALID_CONFIGURATION') break;
  }
  if (!last.ok) {
    const state = last.errorCode === 'AUTHENTICATION_FAILED' ? STATES.AUTHENTICATION_FAILED
      : last.errorCode === 'TIMEOUT' ? STATES.TIMEOUT
      : last.errorCode === 'PROXY_UNAVAILABLE' ? STATES.PROXY_UNAVAILABLE
      : last.errorCode === 'INVALID_CONFIGURATION' ? STATES.INVALID_CONFIGURATION
      : STATES.CONNECTION_FAILED;
    store.enabled = false; store.mode = 'direct';
    store.lastStatus = { state, publicIp: last.publicIp, directIp: last.directIp, location: entry.location || null, latencyMs: last.latencyMs, checkedAt: new Date().toISOString(), message: last.message, errorCode: last.errorCode };
    saveStore(store); return publicState(lang);
  }
  store.enabled = true; store.mode = 'proxy'; store.activeId = entry.id;
  store.lastStatus = { state: STATES.CONNECTED, publicIp: last.publicIp, directIp: last.directIp, location: entry.location || null, latencyMs: last.latencyMs, checkedAt: new Date().toISOString(), message: null, errorCode: null };
  saveStore(store);
  if (engineRestartHook) { try { await engineRestartHook({ reason: 'proxy_connect', proxyId: entry.id }); } catch (_) {} }
  return publicState(lang);
}

async function disconnect(opts = {}) {
  const lang = opts.lang || 'en';
  store.enabled = false; store.mode = 'direct';
  let directIp = null;
  try { const d = await resolvePublicIpDirect(6000); directIp = d.ip; } catch (_) {}
  store.lastStatus = { state: STATES.DISCONNECTED, publicIp: directIp, directIp, location: null, latencyMs: null, checkedAt: new Date().toISOString(), message: null, errorCode: null };
  saveStore(store);
  if (engineRestartHook) { try { await engineRestartHook({ reason: 'proxy_disconnect' }); } catch (_) {} }
  return publicState(lang);
}

function selectActive(id) {
  if (!findEntry(id)) { const e = new Error('Proxy not found'); e.code = 'INVALID_CONFIGURATION'; throw e; }
  store.activeId = id; saveStore(store); return publicState();
}
function reload() { store = loadStore(); return publicState(); }

module.exports = {
  STATES, setEngineRestartHook, getStore, publicState, upsertEntry, removeEntry, setProfileProxy,
  resolveForProfile, getPlaywrightProxyOption, testEntry, connect, disconnect, selectActive, reload,
  listProviders, getProvider
};
