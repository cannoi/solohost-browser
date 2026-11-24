'use strict';
const { detectChallenge } = require('./challenge');
const { safeFetch } = require('./agent-web');
const links = require('./agent-links');

function decode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function hostBare(h) {
  return String(h || '').toLowerCase().replace(/^www\./, '');
}

const ENGINE_HOSTS = new Set(['bing.com', 'duckduckgo.com', 'google.com', 'search.brave.com', 'brave.com', 'yahoo.com', 'yandex.com', 'coccoc.com']);
const NAV_TITLE_RE = /^(images?|videos?|maps?|news|shopping|privacy|terms|help|settings|sign in|log in|trợ giúp|đăng nhập|hình ảnh|video|bản đồ|tin tức)$/i;

/** Domains that are rarely useful as primary research evidence. */
const LOW_QUALITY_HOST_RE = /(^|\.)((chiebukuro\.)?yahoo\.|answers\.yahoo\.|quora\.|reddit\.|stackexchange\.|stackoverflow\.|facebook\.|twitter\.|x\.com|tiktok\.|instagram\.|pinterest\.|tumblr\.|medium\.com$)/i;
const FORUM_PATH_RE = /\/(qa|question|questions|answers?|forum|threads?|topic|community)\b/i;
/** Prefer these for professional/market research. */
const HIGH_QUALITY_HOST_RE = /(^|\.)(gartner\.|idc\.|mckinsey\.|deloitte\.|forrester\.|statista\.|bloomberg\.|reuters\.|ft\.com|wsj\.|harvard\.|mit\.edu|oecd\.|worldbank\.|imf\.|mckinsey|accenture\.|pwc\.|ey\.com|kpmg\.|bcg\.|bain\.|mckinsey)/i;

function scoreCandidate(item, query) {
  if (!item || !item.url) return -999;
  let score = 0;
  let host = '';
  let path = '';
  try {
    const u = new URL(item.url);
    host = hostBare(u.hostname);
    path = u.pathname || '';
  } catch (_) {
    return -999;
  }
  const title = String(item.title || '');
  const snippet = String(item.snippet || '');
  const blob = (title + ' ' + snippet + ' ' + host).toLowerCase();
  const q = String(query || '').toLowerCase();
  const qTokens = q.split(/[^a-z0-9\u00c0-\u024f]+/i).filter((w) => w.length > 2).slice(0, 16);

  if (HIGH_QUALITY_HOST_RE.test(host)) score += 40;
  if (/\.(edu|gov)$/i.test(host) || /\.edu\./i.test(host)) score += 15;
  if (LOW_QUALITY_HOST_RE.test(host) || FORUM_PATH_RE.test(path)) score -= 50;
  if (/chiebukuro|yahoo\.co\.jp|answers\.yahoo/i.test(host)) score -= 80;
  if (/forum|community|question_detail/i.test(path)) score -= 30;

  // Query token overlap in title/snippet/host
  let hits = 0;
  for (const tok of qTokens) {
    if (blob.includes(tok)) hits += 1;
  }
  score += Math.min(25, hits * 3);

  // Prefer reports/research keywords when query asks for them
  if (/\b(report|forecast|market|gartner|idc|mckinsey|deloitte)\b/i.test(q)) {
    if (/\b(report|forecast|outlook|analysis|research|whitepaper)\b/i.test(blob)) score += 12;
    if (/\b(forum|question|answer|help me)\b/i.test(blob)) score -= 20;
  }

  if (item.linkCheck && item.linkCheck.ok === false) score -= 25;
  if (item.linkCheck && item.linkCheck.ok === true) score += 5;

  // Slight preference for earlier SERP rank
  if (item.rank) score += Math.max(0, 8 - Number(item.rank));

  return score;
}

function rankCandidates(list, query) {
  const arr = Array.isArray(list) ? list.slice() : [];
  for (const c of arr) {
    c.relevanceScore = scoreCandidate(c, query);
  }
  arr.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  // Drop clearly junk scores unless nothing left
  const good = arr.filter((c) => (c.relevanceScore || 0) > -20);
  return good.length ? good : arr.slice(0, 3);
}

function pickBestCandidate(list, query, opts) {
  const exclude = (opts && opts.excludeUrls) || new Set();
  const ranked = rankCandidates(list, query).filter((c) => c && c.url && !exclude.has(c.url));
  const minScore = opts && opts.minScore != null ? opts.minScore : -15;
  const pick = ranked.find((c) => (c.relevanceScore || 0) >= minScore);
  return pick || null;
}


function pushResult(out, seen, item, limit) {
  if (!item || !item.url || out.length >= limit) return;
  let url = String(item.url || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').trim();
  try { url = links.unwrapSearchRedirect(url) || url; } catch (_) {}
  try { url = links.canonicalizeUrl(url) || url; } catch (_) {}
  if (!url || !/^https?:/i.test(url) || seen.has(url)) return;
  if (['search_results', 'captcha', 'redirector', 'invalid'].includes(links.classifyUrl(url))) return;
  let host = '';
  let path = '';
  try {
    const u = new URL(url);
    host = hostBare(u.hostname);
    path = u.pathname || '';
  } catch (_) { return; }
  // Drop SERP chrome / legal / account chrome that engines inject into HTML
  if (/^(bing|google|duckduckgo|brave|yahoo|yandex)\./.test(host) || host.endsWith('.bing.com') || host === 'bing.com') {
    if (/\/(search|images|videos|maps|news|copilotsearch|account|settings)/i.test(path)) return;
  }
  if (/fwlink/i.test(path) || /microsoft\.com$/i.test(host) && /fwlink|privacy|legal/i.test(path + host)) return;
  if (/go\.microsoft\.com$/i.test(host)) return;
  if (LOW_QUALITY_HOST_RE.test(host) || FORUM_PATH_RE.test(path)) return;
  if (/chiebukuro|question_detail/i.test(host + path)) return;
  if (ENGINE_HOSTS.has(host) || ENGINE_HOSTS.has(host.replace(/^[\w-]+\./, ''))) {
    try {
      if (/\/(search|images|videos|maps|news|copilot)/i.test(path)) return;
    } catch (_) { return; }
  }
  const title = String(item.title || '').replace(/\s+/g, ' ').trim();
  if (!title || title.length < 3 || NAV_TITLE_RE.test(title)) return;
  if (/^(chế độ ai|quyền riêng tư|điều khoản|pháp lý|quảng cáo|privacy|terms|legal|advertising)$/i.test(title)) return;
  seen.add(url);
  out.push({
    title: title.slice(0, 240),
    url,
    snippet: String(item.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 280),
    site: host,
    date: item.date || null,
    rank: out.length + 1
  });
}

function parseBing(html, limit) {
  const out = [], seen = new Set();
  const blocks = String(html || '').match(/<li[^>]*class="[^"]*\bb_algo\b[^"]*"[\s\S]*?<\/li>/gi) || [];
  for (const b of blocks) {
    const hm = b.match(/<h2[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!hm) continue;
    const cap = (b.match(/<div[^>]*class="[^"]*\bb_caption\b[^"]*"[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '';
    pushResult(out, seen, { url: hm[1], title: decode(hm[2]), snippet: decode(cap) }, limit);
  }
  return out;
}

function parseDdg(html, limit) {
  const out = [], seen = new Set();
  const blocks = String(html || '').match(/<div[^>]*class="[^"]*\bresult\b[^"]*"[\s\S]*?(?=<div[^>]*class="[^"]*\bresult\b|<\/body>|$)/gi) || [];
  for (const b of blocks) {
    const am = b.match(/<a[^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i)
      || b.match(/<a[^>]*href=["']([^"']+)["'][^>]*class="[^"]*\bresult__a\b[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (!am) continue;
    let href = am[1];
    try {
      const u = new URL(href, 'https://duckduckgo.com');
      if (u.searchParams.get('uddg')) href = u.searchParams.get('uddg');
    } catch (_) {}
    const sn = (b.match(/class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\//i) || [])[1] || '';
    pushResult(out, seen, { url: href, title: decode(am[2]), snippet: decode(sn) }, limit);
  }
  return out;
}

function parseBrave(html, limit) {
  const out = [], seen = new Set();
  const blocks = String(html || '').match(/<div[^>]*class="[^"]*\bsnippet\b[^"]*"[\s\S]*?(?=<div[^>]*class="[^"]*\bsnippet\b|<\/main>|$)/gi) || [];
  for (const b of blocks) {
    const am = b.match(/<a[^>]*href=["'](https?:[^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!am) continue;
    const sn = (b.match(/class="[^"]*\bsnippet-description\b[^"]*"[^>]*>([\s\S]*?)<\//i) || b.match(/<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1] || '';
    pushResult(out, seen, { url: am[1], title: decode(am[2]), snippet: decode(sn) }, limit);
  }
  return out;
}

function parseResultsGeneric(html, baseUrl, limit = 10) {
  const out = [], seen = new Set();
  const source = String(html || '');
  const anchors = /<a\b([^>]*href=["']([^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = anchors.exec(source)) && out.length < limit * 4) {
    let url;
    try { url = new URL(m[2], baseUrl).href; } catch (_) { continue; }
    pushResult(out, seen, { url, title: decode(m[3]), snippet: '' }, limit);
  }
  return out;
}

function parseResults(html, baseUrl, limit = 10) {
  let host = '';
  try { host = hostBare(new URL(baseUrl || 'https://example.com').hostname); } catch (_) {}
  let out = [];
  if (host.includes('bing.')) out = parseBing(html, limit);
  else if (host.includes('duckduckgo')) out = parseDdg(html, limit);
  else if (host.includes('brave')) out = parseBrave(html, limit);
  if (!out.length) out = parseResultsGeneric(html, baseUrl, limit);
  return out.slice(0, limit);
}

function visibleTextForBlockCheck(html) {
  return String(html || '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 12000)
    .toLowerCase();
}

function isBlockedHtml(html, url) {
  if (links.classifyUrl(url) === 'captcha') return true;
  const text = visibleTextForBlockCheck(html);
  const title = ((String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').toLowerCase();
  const blob = title + ' ' + text.slice(0, 4000);
  return /unusual traffic from your computer network|are you a robot|verify you are human|complete the captcha|please solve this puzzle|enable javascript and cookies to continue|one more step|attention required|sorry, you have been blocked|access denied.*cloudflare/i.test(blob);
}




const ENGINE_URLS = {
  bing: (q) => 'https://www.bing.com/search?q=' + encodeURIComponent(q) + '&setlang=vi-vn&cc=VN',
  ddg: (q) => 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q) + '&kl=vn-vi',
  brave: (q) => 'https://search.brave.com/search?q=' + encodeURIComponent(q)
};



/**
 * Repair common query mistakes before search.
 * Returns { query, original, repaired: boolean, fixes: string[] }.
 */
function repairSearchQuery(raw) {
  const original = String(raw || '');
  let q = original;
  const fixes = [];

  // Unicode / whitespace
  try {
    const nfc = q.normalize('NFC');
    if (nfc !== q) { q = nfc; fixes.push('unicode_nfc'); }
  } catch (_) {}
  const collapsed = q.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  if (collapsed !== q) { q = collapsed; fixes.push('whitespace'); }

  // HTML entities that leak into queries
  const unent = q
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  if (unent !== q) { q = unent; fixes.push('html_entities'); }

  // Smart quotes → ASCII
  const quotes = q.replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'");
  if (quotes !== q) { q = quotes; fixes.push('smart_quotes'); }

  // Broken site: operators (site : x → site:x, site;/ → site:)
  let q2 = q
    .replace(/\bsite\s*:\s*/gi, 'site:')
    .replace(/\bsite;+/gi, 'site:')
    .replace(/\bsite\s*=\s*/gi, 'site:');
  if (q2 !== q) { q = q2; fixes.push('site_operator'); }

  // filetype: spacing
  q2 = q.replace(/\bfiletype\s*:\s*/gi, 'filetype:');
  if (q2 !== q) { q = q2; fixes.push('filetype_operator'); }

  // Fix doubled operators / empty OR
  q2 = q
    .replace(/\s+OR\s+OR\s+/gi, ' OR ')
    .replace(/^\s*OR\s+/i, '')
    .replace(/\s+OR\s*$/i, '')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (q2 !== q) { q = q2; fixes.push('empty_or'); }

  // Unbalanced quotes — drop trailing lone quote or close pair loosely
  const dq = (q.match(/"/g) || []).length;
  if (dq % 2 === 1) {
    q = q.replace(/"/g, ' ').replace(/\s+/g, ' ').trim();
    fixes.push('unbalanced_quotes');
  }

  // Common Vietnamese / research typo folds (lightweight, high-precision only)
  const typoMap = [
    [/garner\b/gi, 'Gartner'],
    [/gertner\b/gi, 'Gartner'],
    [/mckensie\b/gi, 'McKinsey'],
    [/mckensey\b/gi, 'McKinsey'],
    [/deloit+e\b/gi, 'Deloitte'],
    [/forrester\b/gi, 'Forrester'], // keep correct
    [/statistica\b/gi, 'Statista'],
    [/thitruong/gi, 'thị trường'],
    [/ungdung/gi, 'ứng dụng'],
    [/phanmem/gi, 'phần mềm'],
    [/baocao/gi, 'báo cáo']
  ];
  for (const [re, to] of typoMap) {
    if (re.test(q)) {
      q = q.replace(re, to);
      fixes.push('typo:' + to);
    }
  }

  // Collapse duplicate consecutive words (market market → market)
  q2 = q.replace(/\b(\w{3,})(\s+\1\b)+/gi, '$1');
  if (q2 !== q) { q = q2; fixes.push('dup_words'); }

  // Strip control chars
  q2 = q.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');
  if (q2 !== q) { q = q2; fixes.push('control_chars'); }

  // If query is extremely long, soft-trim while keeping head + key tail years
  if (q.length > 220) {
    const years = (q.match(/\b20\d{2}\b/g) || []).slice(-2).join(' ');
    q = q.slice(0, 180).trim() + (years ? ' ' + years : '');
    fixes.push('trimmed_long');
  }

  q = q.replace(/\s+/g, ' ').trim();
  return {
    query: q || original.trim(),
    original,
    repaired: q !== original.trim() && fixes.length > 0,
    fixes
  };
}

function normalizeQuery(q) {
  return String(q || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

/** In-process SERP cache: key → { at, result }. TTL default 10 min. */
const SEARCH_CACHE = new Map();
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 80;

function cacheKey(query, engines) {
  return normalizeQuery(query) + '|' + (engines || []).join(',');
}

function getCachedSearch(query, engines) {
  const k = cacheKey(query, engines);
  const hit = SEARCH_CACHE.get(k);
  if (!hit) return null;
  if (Date.now() - hit.at > SEARCH_CACHE_TTL_MS) {
    SEARCH_CACHE.delete(k);
    return null;
  }
  return hit.result;
}

function setCachedSearch(query, engines, result) {
  if (SEARCH_CACHE.size >= SEARCH_CACHE_MAX) {
    const first = SEARCH_CACHE.keys().next().value;
    SEARCH_CACHE.delete(first);
  }
  SEARCH_CACHE.set(cacheKey(query, engines), { at: Date.now(), result });
}

function isEngineBlocked(blockedMap, engine) {
  if (!blockedMap) return false;
  const until = blockedMap[engine];
  return typeof until === 'number' && Date.now() < until;
}

function markBlocked(blockedMap, engine, minutes) {
  if (!blockedMap) return;
  blockedMap[engine] = Date.now() + (minutes || 15) * 60 * 1000;
}

function detectSearchIntent(query) {
  const q = String(query || '').toLowerCase();
  if (/\b(forecast|market size|cagr|outlook|white\s*paper|gartner|idc|mckinsey|deloitte|forrester|research report|báo cáo|thị trường)\b/i.test(q)) {
    return 'research';
  }
  if (/\b(news|today|breaking|tin tức|hôm nay|mới nhất)\b/i.test(q)) return 'news';
  if (/\b(mua|bán|giá|shopee|lazada|tiki|amazon|chotot|ecommerce|e-commerce|thương mại)\b/i.test(q)) return 'commerce';
  if (/\b(near me|gần đây|chỉ đường|map|đà nẵng|hà nội|tp\.?\s*hcm)\b/i.test(q)) return 'local';
  return 'general';
}

function enginesForIntent(intent, requested) {
  const req = Array.isArray(requested) && requested.length ? requested.slice() : null;
  if (req) return req;
  if (intent === 'research') return ['bing', 'brave', 'ddg'];
  if (intent === 'news') return ['bing', 'ddg', 'brave'];
  if (intent === 'commerce') return ['bing', 'ddg', 'brave'];
  return ['bing', 'ddg', 'brave'];
}

/** Merge multi-engine SERP hits: score, domain diversity (max 2/host), stable order. */
function mergeSearchResults(batches, query, limit) {
  const lim = Math.max(3, Number(limit) || 10);
  const byUrl = new Map();
  for (const batch of batches || []) {
    const engine = batch.engine || '';
    for (const r of batch.results || []) {
      if (!r || !r.url) continue;
      let url = r.url;
      try { url = links.canonicalizeUrl(url) || url; } catch (_) {}
      const prev = byUrl.get(url);
      const row = Object.assign({}, r, { url, engines: prev ? prev.engines : [] });
      if (!row.engines.includes(engine) && engine) row.engines.push(engine);
      // Multi-engine agreement bonus later via engines.length
      if (!prev || (r.rank || 99) < (prev.rank || 99)) byUrl.set(url, row);
      else byUrl.set(url, Object.assign({}, prev, { engines: row.engines }));
    }
  }
  let list = [...byUrl.values()];
  for (const item of list) {
    item.relevanceScore = scoreCandidate(item, query) + Math.min(12, (item.engines || []).length * 4);
  }
  list.sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0));
  // Domain diversity
  const hostCount = new Map();
  const diverse = [];
  for (const item of list) {
    let host = item.site || '';
    try { host = hostBare(new URL(item.url).hostname); } catch (_) {}
    const n = hostCount.get(host) || 0;
    if (n >= 2) continue;
    hostCount.set(host, n + 1);
    item.site = host;
    item.rank = diverse.length + 1;
    diverse.push(item);
    if (diverse.length >= lim) break;
  }
  return diverse;
}



/**
 * Auto-adjust search queries when results are empty, blocked, or low-quality.
 * Returns ordered unique variants (does not include the original query).
 */
function buildQueryVariants(query, opts) {
  const o = opts || {};
  const base = String(query || '').replace(/\s+/g, ' ').trim();
  if (!base) return [];
  const tried = new Set((o.tried || []).map((x) => normalizeQuery(String(x || ''))));
  tried.add(normalizeQuery(base));
  const out = [];
  const push = (q) => {
    const s = String(q || '').replace(/\s+/g, ' ').trim();
    if (!s || s.length < 4) return;
    const n = normalizeQuery(s);
    if (tried.has(n)) return;
    tried.add(n);
    out.push(s);
  };

  const lower = base.toLowerCase();
  const isResearch = /\b(forecast|market|report|outlook|gartner|idc|mckinsey|deloitte|trends?|analysis|research|white\s*paper|ứng dụng|thị trường|báo cáo)\b/i.test(base);
  const isCommerce = /\b(mua|bán|giá|chotot|shopee|amazon|lazada|tiki|thương mại điện tử|ecommerce|e-commerce)\b/i.test(base);
  const hasSite = /\bsite:\S+/i.test(base);

  // 1) Strip failing site: filters and simplify
  if (hasSite) {
    push(base.replace(/\bsite:\S+/gi, ' ').replace(/\s+OR\s+/gi, ' ').replace(/\s+/g, ' ').trim());
  }

  // 2) Research-oriented expansions
  if (isResearch) {
    const core = base.replace(/\bsite:\S+/gi, ' ').replace(/\s+OR\s+/gi, ' ').replace(/\s+/g, ' ').trim();
    push(core + ' report');
    push(core + ' market outlook');
    push(core + ' filetype:pdf');
    // Single-vendor focused (better than giant OR site: chains)
    push('software application market forecast site:gartner.com');
    push('worldwide software market forecast site:idc.com');
    push('software market trends site:mckinsey.com');
    push('technology outlook software site:deloitte.com');
    push(core + ' Gartner');
    push(core + ' IDC research');
    push(base.replace(/2025\s*[-–—]\s*2035/g, '2026 2030').replace(/2026\s*[-–—]\s*2036/g, '2025 2030'));
    push('global enterprise software market size CAGR 2025 2030');
  }

  // 3) Commerce / local marketplace
  if (isCommerce || (!isResearch && o.locale === 'vi')) {
    push(base + ' official');
    if (!/shopee|lazada|tiki|amazon/i.test(base)) push(base + ' Shopee OR Lazada OR Amazon');
  }

  // 4) Diacritics fold for Vietnamese
  try {
    const nodia = base.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (nodia !== base) push(nodia);
  } catch (_) {}

  // 5) Shorten very long queries (take key tokens)
  if (base.length > 100) {
    const tokens = base.split(/\s+/).filter(Boolean);
    push(tokens.slice(0, 12).join(' '));
    push(tokens.filter((w) => w.length > 3).slice(0, 10).join(' '));
  }

  // 6) English pivot for mixed queries
  if (/[àáạảãăằắặẳẵâầấậẩẫèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(base)) {
    if (/thị trường|ứng dụng|phần mềm/i.test(base)) {
      push('global application software market forecast 2025 2035');
    }
  }

  return out.slice(0, o.limit != null ? o.limit : 8);
}

async function searchWithAutoAdjust(query, opts) {
  const o = opts || {};
  const repair = repairSearchQuery(query);
  const workQuery = repair.query || query;
  const intent = detectSearchIntent(workQuery);
  const tried = [];
  const attempts = [];
  const minScore = o.minScore != null ? o.minScore : -10;
  const engines = enginesForIntent(intent, o.engines);

  const qualityScore = (found, qForScore) => {
    if (!found || !found.results || !found.results.length) return -999;
    const ranked = rankCandidates(found.results, qForScore || workQuery);
    if (!ranked.length) return -999;
    return ranked[0].relevanceScore || 0;
  };
  const qualityOk = (found, qForScore) => qualityScore(found, qForScore) >= minScore;

  if (repair.repaired) {
    attempts.push({
      query: workQuery,
      outcome: 'repaired',
      engine: null,
      n: 0,
      score: null,
      intent,
      fixes: repair.fixes
    });
  }

  let primary = await searchWeb(workQuery, Object.assign({}, o, { engines }));
  tried.push(workQuery);
  attempts.push({
    query: workQuery, outcome: primary.outcome, engine: primary.engine,
    n: (primary.results || []).length, score: qualityScore(primary, workQuery), intent
  });

  // Strong enough — stop
  if (qualityScore(primary, workQuery) >= 25 || (qualityOk(primary, workQuery) && (primary.results || []).length >= 4)) {
    return Object.assign({}, primary, {
      adjustedQuery: repair.repaired ? workQuery : null,
      originalQuery: query,
      repairedQuery: repair.repaired ? workQuery : null,
      repairFixes: repair.fixes,
      attempts,
      autoAdjusted: !!repair.repaired,
      intent,
      bestScore: qualityScore(primary, workQuery)
    });
  }

  const variants = buildQueryVariants(workQuery, { tried, locale: o.locale, limit: o.variantLimit || 7 });
  let best = primary;
  let bestQ = workQuery;
  let bestScore = qualityScore(primary, workQuery);

  for (const v of variants) {
    const found = await searchWeb(v, Object.assign({}, o, { engines }));
    tried.push(v);
    const sc = qualityScore(found, v);
    attempts.push({
      query: v, outcome: found.outcome, engine: found.engine,
      n: (found.results || []).length, score: sc, intent
    });
    if (sc > bestScore) {
      best = found;
      bestQ = v;
      bestScore = sc;
    }
    // Early stop on strong authoritative hit
    if (sc >= 30 || (sc >= minScore && (found.results || []).length >= 5)) {
      return Object.assign({}, found, {
        adjustedQuery: v,
        originalQuery: query,
        repairedQuery: repair.repaired ? workQuery : null,
        repairFixes: repair.fixes,
        attempts,
        autoAdjusted: true,
        intent,
        bestScore: sc
      });
    }
  }

  const adjusted = bestQ !== workQuery && bestScore > qualityScore(primary, workQuery);
  return Object.assign({}, best, {
    adjustedQuery: adjusted ? bestQ : (repair.repaired ? workQuery : null),
    originalQuery: query,
    repairedQuery: repair.repaired ? workQuery : null,
    repairFixes: repair.fixes,
    attempts,
    autoAdjusted: !!adjusted || !!repair.repaired,
    intent,
    bestScore
  });
}

async function searchWeb(query, { engines, timeoutMs = 3200, limit = 10, blockedMap = null, skipCache = false } = {}) {
  const q = String(query || '').trim();
  if (!q) return { outcome: 'error', results: [], engine: null, blocked: [], blockedEngines: [], error: 'query_required', durationMs: 0, ms: 0 };
  const t0 = Date.now();
  const order = (engines && engines.length ? engines : ['bing', 'ddg', 'brave']).filter((x) => ['bing', 'ddg', 'brave'].includes(x));
  const active = order.filter((e) => !isEngineBlocked(blockedMap, e));
  if (!active.length) {
    return { outcome: 'blocked', results: [], engine: null, blocked: order.slice(), blockedEngines: order.slice(), error: 'all_engines_circuit_open', durationMs: Date.now() - t0, ms: Date.now() - t0 };
  }
  if (!skipCache) {
    const cached = getCachedSearch(q, active);
    if (cached && cached.outcome === 'ok' && (cached.results || []).length) {
      return Object.assign({}, cached, { cached: true, durationMs: Date.now() - t0, ms: Date.now() - t0 });
    }
  }

  if (process.env.BRAVE_SEARCH_API_KEY && active.includes('brave')) {
    try {
      const url = 'https://api.search.brave.com/res/v1/web/search?q=' + encodeURIComponent(q) + '&count=' + limit;
      const res = await safeFetch(url, {
        timeoutMs,
        headers: { 'X-Subscription-Token': process.env.BRAVE_SEARCH_API_KEY, Accept: 'application/json' }
      });
      if (res.ok && res.body) {
        let j; try { j = JSON.parse(res.body); } catch (_) { j = null; }
        const web = (j && j.web && j.web.results) || [];
        const results = web.slice(0, limit).map((r, i) => ({
          title: String(r.title || '').slice(0, 240),
          url: r.url,
          snippet: String(r.description || '').slice(0, 400),
          site: (() => { try { return new URL(r.url).hostname.replace(/^www\./, ''); } catch { return ''; } })(),
          rank: i + 1
        })).filter((r) => r.url);
        if (results.length) {
          return { outcome: 'ok', results, engine: 'brave_api', blocked: [], error: null, ms: Date.now() - t0 };
        }
      }
    } catch (_) {}
  }

  const jobs = active.map(async (engine) => {
    const url = ENGINE_URLS[engine](q);
    try {
      const res = await safeFetch(url, { timeoutMs });
      if (isBlockedHtml(res.body, res.url || url)) {
        markBlocked(blockedMap, engine, 20);
        return { engine, outcome: 'blocked', results: [] };
      }
      const results = parseResults(res.body, res.url || url, limit);
      if (results.length) return { engine, outcome: 'ok', results };
      return { engine, outcome: 'empty', results: [] };
    } catch (e) {
      return { engine, outcome: 'error', results: [], error: String(e.message || e).slice(0, 80) };
    }
  });

  const settled = await Promise.all(jobs);
  const okBatches = settled.filter((x) => x.outcome === 'ok' && x.results && x.results.length);
  if (okBatches.length) {
    const merged = mergeSearchResults(okBatches, q, limit);
    const enginesUsed = okBatches.map((x) => x.engine);
    return {
      outcome: merged.length ? 'ok' : 'empty',
      results: merged,
      engine: enginesUsed.join('+') || okBatches[0].engine,
      engines: enginesUsed,
      intent: detectSearchIntent(q),
      blocked: settled.filter((x) => x.outcome === 'blocked').map((x) => x.engine),
      error: null,
      ms: Date.now() - t0
    };
  }
  const onlyBlocked = settled.every((x) => x.outcome === 'blocked' || x.outcome === 'error');
  if (onlyBlocked) {
    return {
      outcome: 'blocked',
      results: [],
      engine: null,
      engines: [],
      intent: detectSearchIntent(q),
      blocked: settled.filter((x) => x.outcome === 'blocked').map((x) => x.engine),
      error: 'search_blocked',
      ms: Date.now() - t0
    };
  }
  return {
    outcome: 'empty',
    results: [],
    engine: null,
    engines: [],
    intent: detectSearchIntent(q),
    blocked: settled.filter((x) => x.outcome === 'blocked').map((x) => x.engine),
    error: null,
    ms: Date.now() - t0
  };
}

// Stamp durationMs + blockedEngines aliases on every return path via thin wrapper
const _searchWebImpl = searchWeb;
async function searchWebWrapped(query, opts) {
  const r = await _searchWebImpl(query, opts || {});
  const durationMs = r.durationMs != null ? r.durationMs : (r.ms || 0);
  const blockedEngines = Array.isArray(r.blocked) ? r.blocked : (r.blockedEngines || []);
  const out = Object.assign({}, r, { durationMs, ms: durationMs, blockedEngines, blocked: blockedEngines });
  if (out.outcome === 'ok' && (out.results || []).length && !(opts && opts.skipCache)) {
    try { setCachedSearch(query, (opts && opts.engines) || ['bing', 'ddg', 'brave'], out); } catch (_) {}
  }
  return out;
}

module.exports = {
  repairSearchQuery,
  detectSearchIntent,
  mergeSearchResults,
  enginesForIntent,
  searchWithAutoAdjust,
  buildQueryVariants,
  scoreCandidate,
  rankCandidates,
  pickBestCandidate,
  searchWeb: searchWebWrapped,
  parseResults,
  parseBing,
  parseDdg,
  parseBrave,
  isBlockedHtml,
  isEngineBlocked,
  markBlocked,
  normalizeQuery,
  getCachedSearch,
  setCachedSearch
};

