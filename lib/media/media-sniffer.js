'use strict';
/**
 * Detect media responses from Playwright network events.
 * Does not download — only records candidates for optional cache.
 */
const { isBlockedHost } = require('./blocked-hosts');

const MEDIA_EXT = /\.(mp4|webm|mp3|m4a|aac|ogg|opus|wav|flac|m3u8|mpd)(?:\?|$)/i;
const MEDIA_CT = /^(video|audio)\//i;
const HLS_CT = /application\/vnd\.apple\.mpegurl|application\/x-mpegurl/i;
const DASH_CT = /application\/dash\+xml/i;

function looksLikeMedia(url, contentType, headers) {
  const ct = String(contentType || (headers && (headers['content-type'] || headers['Content-Type'])) || '').split(';')[0].trim();
  const u = String(url || '');
  if (MEDIA_CT.test(ct) || HLS_CT.test(ct) || DASH_CT.test(ct)) return { media: true, contentType: ct };
  if (MEDIA_EXT.test(u)) return { media: true, contentType: ct || guessType(u) };
  return { media: false };
}

function guessType(url) {
  const m = String(url).toLowerCase().match(/\.(mp4|webm|mp3|m4a|aac|ogg|opus|wav|flac|m3u8|mpd)/);
  if (!m) return 'application/octet-stream';
  const map = {
    mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', m4a: 'audio/mp4',
    aac: 'audio/aac', ogg: 'audio/ogg', opus: 'audio/opus', wav: 'audio/wav',
    flac: 'audio/flac', m3u8: 'application/vnd.apple.mpegurl', mpd: 'application/dash+xml'
  };
  return map[m[1]] || 'application/octet-stream';
}

function detectDrmHints(url, headers, bodySample) {
  const h = headers || {};
  const ct = String(h['content-type'] || h['Content-Type'] || '');
  if (/eme|widevine|playready|fairplay/i.test(ct)) return true;
  const sample = String(bodySample || '').slice(0, 4000);
  if (/#EXT-X-KEY:.*METHOD=(?!NONE)/i.test(sample)) return true;
  if (/ContentProtection|cenc:default_KID|Widevine|PlayReady/i.test(sample)) return true;
  return false;
}

/**
 * Attach response listener to a Playwright page. Returns unsubscribe.
 * onCandidate({ url, contentType, contentLength, blocked, drm, sessionId })
 */
function attachMediaSniffer(page, sessionId, onCandidate) {
  if (!page || typeof onCandidate !== 'function') return () => {};
  const handler = async (response) => {
    try {
      const url = response.url();
      if (!url || !/^https?:/i.test(url)) return;
      const headers = response.headers();
      const ct = headers['content-type'] || headers['Content-Type'] || '';
      const look = looksLikeMedia(url, ct, headers);
      if (!look.media) return;
      const blocked = isBlockedHost(url);
      let drm = false;
      // Only peek body for small HLS/DASH manifests
      if (!blocked && (/\.m3u8|\.mpd/i.test(url) || HLS_CT.test(ct) || DASH_CT.test(ct))) {
        try {
          const buf = await response.body();
          const sample = buf && buf.slice ? buf.slice(0, 4000).toString('utf8') : '';
          drm = detectDrmHints(url, headers, sample);
        } catch (_) {}
      }
      const len = parseInt(headers['content-length'] || headers['Content-Length'] || '0', 10) || 0;
      onCandidate({
        url,
        contentType: look.contentType || ct,
        contentLength: len,
        blocked,
        drm,
        sessionId,
        status: response.status()
      });
    } catch (_) {}
  };
  page.on('response', handler);
  return () => {
    try { page.off('response', handler); } catch (_) {}
  };
}

module.exports = {
  looksLikeMedia,
  guessType,
  detectDrmHints,
  attachMediaSniffer,
  MEDIA_EXT
};
