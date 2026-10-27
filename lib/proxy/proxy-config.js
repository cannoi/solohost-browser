'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATES = Object.freeze({
  DISCONNECTED: 'DISCONNECTED', CONNECTING: 'CONNECTING', CONNECTED: 'CONNECTED',
  CONNECTION_FAILED: 'CONNECTION_FAILED', AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  PROXY_UNAVAILABLE: 'PROXY_UNAVAILABLE', TIMEOUT: 'TIMEOUT',
  INVALID_CONFIGURATION: 'INVALID_CONFIGURATION', LOCATION_UNAVAILABLE: 'LOCATION_UNAVAILABLE'
});
const PROTOCOLS = Object.freeze(['http', 'https', 'socks5']);

function dataDir() { return process.env.SOLOHOST_DATA_DIR || path.join(__dirname, '..', '..', 'data'); }
function configPath() { return path.join(dataDir(), 'proxy-config.json'); }
function newId() { return 'px_' + crypto.randomBytes(6).toString('hex'); }

function emptyStore() {
  return {
    version: 1, enabled: false, activeId: null, mode: 'direct', profiles: {}, entries: [],
    lastStatus: { state: STATES.DISCONNECTED, publicIp: null, directIp: null, location: null, latencyMs: null, checkedAt: null, message: null, errorCode: null },
    updatedAt: null
  };
}

function loadStore() {
  try {
    if (!fs.existsSync(configPath())) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(configPath(), 'utf8'));
    const store = { ...emptyStore(), ...raw };
    if (!Array.isArray(store.entries)) store.entries = [];
    if (!store.profiles || typeof store.profiles !== 'object') store.profiles = {};
    if (!store.lastStatus) store.lastStatus = emptyStore().lastStatus;
    return store;
  } catch (_) { return emptyStore(); }
}

function saveStore(store) {
  const dir = dataDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(dir, 0o700); } catch (_) {}
  store.updatedAt = new Date().toISOString();
  const file = configPath();
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  try { fs.chmodSync(tmp, 0o600); } catch (_) {}
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, 0o600); } catch (_) {}
  return store;
}

function normalizeEntry(input, existing) {
  const src = input || {};
  const prev = existing || {};
  const protocol = String(src.protocol || prev.protocol || 'http').toLowerCase();
  if (!PROTOCOLS.includes(protocol)) { const e = new Error('Unsupported protocol'); e.code = 'INVALID_CONFIGURATION'; throw e; }
  const host = String(src.host || prev.host || '').trim().toLowerCase();
  const port = Number(src.port != null ? src.port : prev.port);
  if (!host || !Number.isFinite(port) || port < 1 || port > 65535) { const e = new Error('Host and port are required'); e.code = 'INVALID_CONFIGURATION'; throw e; }
  const entry = {
    id: prev.id || src.id || newId(),
    name: String(src.name || prev.name || host).slice(0, 80),
    protocol, host, port,
    username: src.username != null ? String(src.username).slice(0, 256) : (prev.username || ''),
    password: prev.password || '',
    location: src.location != null ? String(src.location).slice(0, 64) : (prev.location || ''),
    provider: String(src.provider || prev.provider || 'custom').slice(0, 64),
    bypass: String(src.bypass != null ? src.bypass : (prev.bypass || 'localhost,127.0.0.1,::1,.local,.lan')).slice(0, 500),
    enabled: src.enabled != null ? !!src.enabled : (prev.enabled !== false),
    createdAt: prev.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  if (src.password != null && String(src.password).length > 0) entry.password = String(src.password).slice(0, 256);
  else if (src.clearPassword === true || src.password === '') entry.password = '';
  return entry;
}

function redactEntry(entry) {
  if (!entry) return null;
  return {
    id: entry.id, name: entry.name, protocol: entry.protocol, host: entry.host, port: entry.port,
    username: entry.username ? String(entry.username).slice(0, 3) + '***' : '',
    hasAuth: !!(entry.username || entry.password), hasPassword: !!entry.password,
    location: entry.location || '', provider: entry.provider || 'custom', bypass: entry.bypass || '',
    enabled: entry.enabled !== false, createdAt: entry.createdAt, updatedAt: entry.updatedAt
  };
}

function redactStore(store) {
  return {
    version: store.version, enabled: !!store.enabled, activeId: store.activeId, mode: store.mode || 'direct',
    profiles: store.profiles || {}, entries: (store.entries || []).map(redactEntry),
    lastStatus: store.lastStatus || emptyStore().lastStatus, updatedAt: store.updatedAt
  };
}

function toPlaywrightProxy(entry) {
  if (!entry) return undefined;
  const scheme = entry.protocol === 'socks5' ? 'socks5' : 'http';
  const out = { server: scheme + '://' + entry.host + ':' + entry.port };
  if (entry.username) out.username = entry.username;
  if (entry.password) out.password = entry.password;
  if (entry.bypass) out.bypass = entry.bypass;
  return out;
}

function redactErrorMessage(msg) {
  return String(msg || '')
    .replace(/\/\/[^:]+:[^@]+@/g, '//***:***@')
    .replace(/(password|passwd|pwd|token|secret|api[_-]?key)\s*[=:]\s*["']?[^"'&\s]+/gi, '$1=***')
    .slice(0, 400);
}

module.exports = {
  STATES, PROTOCOLS, dataDir, configPath, newId, emptyStore, loadStore, saveStore,
  normalizeEntry, redactEntry, redactStore, toPlaywrightProxy, redactErrorMessage
};
