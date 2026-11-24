'use strict';
/**
 * Hosts that must never be media-cached (ToS / DRM / intentional embed blocks).
 * Configurable via SOLOHOST_MEDIA_BLOCKED_HOSTS (comma-separated).
 */
const DEFAULT_BLOCKED = [
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'googlevideo.com',
  'netflix.com',
  'www.netflix.com',
  'disneyplus.com',
  'www.disneyplus.com',
  'hulu.com',
  'www.hulu.com',
  'primevideo.com',
  'www.primevideo.com',
  'play.max.com',
  'www.max.com',
  'spotify.com',
  'www.spotify.com',
  'open.spotify.com'
];

function loadBlocked() {
  const extra = String(process.env.SOLOHOST_MEDIA_BLOCKED_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_BLOCKED, ...extra]);
}

function isBlockedHost(urlOrHost) {
  let host = String(urlOrHost || '').toLowerCase();
  try {
    if (host.includes('://')) host = new URL(host).hostname;
  } catch (_) {}
  host = host.replace(/^www\./, '');
  const set = loadBlocked();
  if (set.has(host) || set.has('www.' + host)) return true;
  for (const b of set) {
    const bb = b.replace(/^www\./, '');
    if (host === bb || host.endsWith('.' + bb)) return true;
  }
  return false;
}

module.exports = { isBlockedHost, loadBlocked, DEFAULT_BLOCKED };
