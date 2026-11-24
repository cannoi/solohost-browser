'use strict';
/**
 * Disk media cache with Range download, LRU, size cap, TTL, SSRF guard.
 * Never caches blocked hosts or DRM content.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { isBlockedHost } = require('./blocked-hosts');
const { looksLikeMedia, detectDrmHints } = require('./media-sniffer');

const DATA = process.env.SOLOHOST_DATA_DIR || path.join(process.cwd(), 'data');
const CACHE_DIR = path.join(DATA, 'media-cache');
const INDEX_FILE = path.join(CACHE_DIR, 'index.json');
const MAX_MB = Math.max(64, Math.min(4096, parseInt(process.env.SOLOHOST_MEDIA_CACHE_MAX_MB || '512', 10) || 512));
const MAX_BYTES = MAX_MB * 1024 * 1024;
const TTL_MS = Math.max(3600e3, parseInt(process.env.SOLOHOST_MEDIA_CACHE_TTL_HOURS || '48', 10) * 3600e3 || 48 * 3600e3);
const MAX_FILE_MB = Math.max(16, Math.min(1024, parseInt(process.env.SOLOHOST_MEDIA_MAX_FILE_MB || '256', 10) || 256));
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

let index = { entries: {}, order: [] }; // id -> meta; order = LRU ids
let ready = false;

function ensureDir() {
  try { fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 }); } catch (_) {}
}

function loadIndex() {
  ensureDir();
  try {
    if (fs.existsSync(INDEX_FILE)) {
      index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
      if (!index.entries) index.entries = {};
      if (!Array.isArray(index.order)) index.order = Object.keys(index.entries);
    }
  } catch (_) {
    index = { entries: {}, order: [] };
  }
  ready = true;
  pruneExpired();
  pruneToBudget();
}

function saveIndex() {
  ensureDir();
  try {
    fs.writeFileSync(INDEX_FILE, JSON.stringify(index), { mode: 0o600 });
  } catch (_) {}
}

function idForUrl(url) {
  return crypto.createHash('sha256').update(String(url)).digest('hex').slice(0, 32);
}

function filePath(id, ext) {
  return path.join(CACHE_DIR, id + (ext || '.bin'));
}

function totalBytes() {
  let n = 0;
  for (const id of Object.keys(index.entries)) {
    n += Number(index.entries[id].size || 0);
  }
  return n;
}

function touch(id) {
  const i = index.order.indexOf(id);
  if (i >= 0) index.order.splice(i, 1);
  index.order.push(id);
}

function pruneExpired() {
  const now = Date.now();
  for (const id of Object.keys(index.entries)) {
    const e = index.entries[id];
    if (!e || (e.cachedAt && now - e.cachedAt > TTL_MS)) {
      removeEntry(id);
    }
  }
}

function pruneToBudget() {
  while (totalBytes() > MAX_BYTES && index.order.length) {
    const oldest = index.order.shift();
    removeEntry(oldest, true);
  }
  saveIndex();
}

function removeEntry(id, skipSave) {
  const e = index.entries[id];
  if (e && e.file) {
    try { fs.unlinkSync(e.file); } catch (_) {}
  }
  delete index.entries[id];
  index.order = index.order.filter((x) => x !== id);
  if (!skipSave) saveIndex();
}

async function assertPublicUrl(url) {
  // Prefer project net-guard when available
  try {
    const { assertPublicHttpUrl } = require('../net-guard');
    await assertPublicHttpUrl(url);
    return;
  } catch (e) {
    if (e && e.code) throw e;
  }
  const u = new URL(url);
  if (!/^https?:$/i.test(u.protocol)) throw Object.assign(new Error('scheme'), { code: 'bad_scheme' });
  if (u.username || u.password) throw Object.assign(new Error('credentials'), { code: 'credentials' });
}

function fetchToFile(url, dest, opts = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      await assertPublicUrl(url);
    } catch (e) {
      return reject(e);
    }
    if (isBlockedHost(url)) {
      return reject(Object.assign(new Error('host_blocked'), { code: 'host_blocked' }));
    }
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': opts.userAgent || 'Mozilla/5.0 SoloHostBrowser/11',
        Accept: '*/*',
        ...(opts.headers || {})
      },
      timeout: 60000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return fetchToFile(new URL(res.headers.location, url).href, dest, opts).then(resolve, reject);
      }
      if (res.statusCode !== 200 && res.statusCode !== 206) {
        res.resume();
        return reject(Object.assign(new Error('http_' + res.statusCode), { code: 'http_status' }));
      }
      const ct = res.headers['content-type'] || '';
      const len = parseInt(res.headers['content-length'] || '0', 10) || 0;
      if (len > MAX_FILE_BYTES) {
        res.resume();
        return reject(Object.assign(new Error('too_large'), { code: 'too_large' }));
      }
      const look = looksLikeMedia(url, ct, res.headers);
      if (!look.media) {
        res.resume();
        return reject(Object.assign(new Error('not_media'), { code: 'not_media' }));
      }
      ensureDir();
      const out = fs.createWriteStream(dest, { mode: 0o600 });
      let written = 0;
      res.on('data', (chunk) => {
        written += chunk.length;
        if (written > MAX_FILE_BYTES) {
          try { out.destroy(); fs.unlinkSync(dest); } catch (_) {}
          req.destroy();
          reject(Object.assign(new Error('too_large'), { code: 'too_large' }));
        }
      });
      res.pipe(out);
      out.on('finish', () => resolve({ size: written, contentType: look.contentType || ct }));
      out.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(Object.assign(new Error('timeout'), { code: 'timeout' })); });
  });
}

/**
 * Cache a direct media URL after policy checks.
 * requires: userConfirmed === true
 */
async function cacheUrl(url, opts = {}) {
  if (!ready) loadIndex();
  if (opts.privateMode) return { ok: false, error: 'private_mode' };
  if (!opts.userConfirmed) return { ok: false, error: 'confirmation_required' };
  if (isBlockedHost(url)) return { ok: false, error: 'host_blocked', blocked: true };
  if (opts.drm) return { ok: false, error: 'drm', drm: true };

  const id = idForUrl(url);
  if (index.entries[id] && fs.existsSync(index.entries[id].file)) {
    touch(id);
    saveIndex();
    return { ok: true, id, cached: true, meta: publicMeta(index.entries[id]) };
  }

  const extMatch = String(url).match(/\.(mp4|webm|mp3|m4a|aac|ogg|opus|wav|flac)(?:\?|$)/i);
  const ext = extMatch ? '.' + extMatch[1].toLowerCase() : '.bin';
  const dest = filePath(id, ext);
  try {
    const result = await fetchToFile(url, dest, opts);
    index.entries[id] = {
      id,
      url: String(url).slice(0, 2000),
      file: dest,
      size: result.size,
      contentType: result.contentType,
      cachedAt: Date.now()
    };
    touch(id);
    pruneToBudget();
    saveIndex();
    return { ok: true, id, cached: false, meta: publicMeta(index.entries[id]) };
  } catch (e) {
    try { fs.unlinkSync(dest); } catch (_) {}
    return { ok: false, error: e.code || String(e.message || e).slice(0, 80) };
  }
}

function publicMeta(e) {
  if (!e) return null;
  return {
    id: e.id,
    contentType: e.contentType,
    size: e.size,
    cachedAt: e.cachedAt
  };
}

function getEntry(id) {
  if (!ready) loadIndex();
  const e = index.entries[id];
  if (!e || !e.file || !fs.existsSync(e.file)) return null;
  touch(id);
  saveIndex();
  return e;
}

function listEntries() {
  if (!ready) loadIndex();
  return index.order.map((id) => publicMeta(index.entries[id])).filter(Boolean);
}

function clearCache() {
  if (!ready) loadIndex();
  for (const id of Object.keys(index.entries)) removeEntry(id, true);
  index = { entries: {}, order: [] };
  saveIndex();
  return { ok: true };
}

// boot
try { loadIndex(); } catch (_) {}

module.exports = {
  cacheUrl,
  getEntry,
  listEntries,
  clearCache,
  CACHE_DIR,
  MAX_MB,
  loadIndex
};
