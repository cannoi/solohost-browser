'use strict';
/**
 * Evidence ledger for Browser Agent — stores fetched page/article/feed snippets
 * with stable [E#] ids so reports can cite sources without hallucinating.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_ROOT = process.env.SOLOHOST_DATA_DIR || path.join(__dirname, '..', 'data');
const LEDGER_ROOT = path.join(DATA_ROOT, 'agent-tasks');
const MAX_ENTRIES = 120;
const MAX_TEXT = 20000;
const MAX_SNIPPET = 600;

function ensureDir(d) {
  try { fs.mkdirSync(d, { recursive: true }); } catch (_) {}
}

function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

function clip(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function taskDir(taskId) {
  ensureDir(LEDGER_ROOT);
  const d = path.join(LEDGER_ROOT, String(taskId || 'unknown'));
  ensureDir(d);
  return d;
}

function loadLedger(taskId) {
  const file = path.join(taskDir(taskId), 'ledger.json');
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(j.entries) ? j.entries : [];
  } catch {
    return [];
  }
}

function saveLedger(taskId, entries) {
  const file = path.join(taskDir(taskId), 'ledger.json');
  const trimmed = entries.slice(-MAX_ENTRIES);
  fs.writeFileSync(file, JSON.stringify({ entries: trimmed, updatedAt: new Date().toISOString() }, null, 0), { mode: 0o600 });
  return trimmed;
}

function classifySourceClass(url, kind, title) {
  const host = domainOf(url).toLowerCase();
  const blob = (host + ' ' + String(title || '') + ' ' + String(kind || '')).toLowerCase();
  if (kind === 'serp') return 'search_snippet';
  if (/\b(gartner|idc\.com|mckinsey|deloitte|forrester|statista|oecd|worldbank|imf\.org|nist\.gov|europa\.eu)\b/.test(blob)) return 'research';
  if (/\b(gov|gob\.|\.go\.)\b/.test(host) || /\.gov(\.|$)/.test(host)) return 'official';
  if (/\b(reuters|apnews|bbc\.|nytimes|wsj\.|ft\.com|bloomberg|thanhnien|vnexpress|tuoitre)\b/.test(blob)) return 'news';
  if (/\b(reddit|quora|yahoo\.|chiebukuro|forum|stackexchange|medium\.com)\b/.test(blob)) return 'community';
  if (/\b(arxiv|acm\.org|ieee|nature\.com|science\.org|ssrn)\b/.test(blob)) return 'research';
  return 'web';
}

function canonicalizeEvidenceUrl(url) {
  try {
    const u = new URL(String(url || ''));
    u.hash = '';
    // drop common tracking params
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid','gclid'].forEach((k) => u.searchParams.delete(k));
    let out = u.toString();
    if (out.endsWith('/')) out = out.slice(0, -1);
    return out;
  } catch {
    return String(url || '').trim();
  }
}

function addEvidence(taskId, item) {
  const entries = loadLedger(taskId);
  const url = canonicalizeEvidenceUrl(item.url);
  const kind = item.kind || 'page';
  // Dedupe: same canonical URL + kind — upgrade snippet→page instead of duplicating
  const existing = entries.find((e) => canonicalizeEvidenceUrl(e.url) === url && (e.kind === kind || (kind === 'page' && e.kind === 'serp')));
  if (existing && kind === 'page' && existing.kind === 'serp') {
    existing.kind = 'page';
    existing.verified = true;
    existing.title = clip(item.title || existing.title, 300);
    existing.snippet = clip(item.snippet || item.text || existing.snippet, MAX_SNIPPET);
    existing.publishedAt = item.publishedAt || existing.publishedAt || null;
    existing.fetchedAt = new Date().toISOString();
    existing.sourceClass = classifySourceClass(url, 'page', existing.title);
    existing.source = item.source || existing.source || domainOf(url);
    try {
      const textPath = path.join(taskDir(taskId), existing.id + '.txt');
      fs.writeFileSync(textPath, clip(item.text || item.snippet || '', MAX_TEXT), { mode: 0o600 });
      existing.textFile = existing.id + '.txt';
    } catch (_) {}
    saveLedger(taskId, entries);
    return existing;
  }
  if (existing && kind === existing.kind) {
    // refresh fetchedAt only
    existing.fetchedAt = new Date().toISOString();
    if (item.snippet || item.text) existing.snippet = clip(item.snippet || item.text, MAX_SNIPPET);
    saveLedger(taskId, entries);
    return existing;
  }

  const id = 'E' + (entries.length + 1);
  const verified = kind === 'page' || kind === 'article' || kind === 'doc' || item.verified === true;
  const entry = {
    id,
    url: String(url || '').slice(0, 2000),
    title: clip(item.title, 300),
    source: item.source || domainOf(url),
    sourceClass: classifySourceClass(url, kind, item.title),
    publishedAt: item.publishedAt || null,
    fetchedAt: new Date().toISOString(),
    section: item.section || null,
    snippet: clip(item.snippet || item.text, MAX_SNIPPET),
    kind,
    verified: !!verified,
    independent: true
  };
  try {
    const textPath = path.join(taskDir(taskId), id + '.txt');
    fs.writeFileSync(textPath, clip(item.text || item.snippet || '', MAX_TEXT), { mode: 0o600 });
    entry.textFile = id + '.txt';
  } catch (_) {}
  entries.push(entry);
  saveLedger(taskId, entries);
  return entry;
}

/** Research coverage metrics for a task */
function researchCoverage(taskId, opts) {
  const o = opts || {};
  const entries = loadLedger(taskId);
  const serp = entries.filter((e) => e.kind === 'serp');
  const pages = entries.filter((e) => e.kind !== 'serp');
  const verified = entries.filter((e) => e.verified && e.kind !== 'serp');
  const hosts = new Set();
  for (const e of verified) {
    const h = domainOf(e.url);
    if (h) hosts.add(h);
  }
  const target = o.target != null ? Number(o.target) : null;
  const independent = hosts.size;
  const met = target != null && target > 0 ? independent >= target && verified.length >= Math.min(target, verified.length) && independent >= target : null;
  return {
    found: serp.length + pages.length,
    serp: serp.length,
    opened: pages.length,
    read: pages.filter((e) => e.textFile).length,
    verified: verified.length,
    independentHosts: independent,
    byClass: pages.reduce((acc, e) => {
      const c = e.sourceClass || 'web';
      acc[c] = (acc[c] || 0) + 1;
      return acc;
    }, {}),
    target: target,
    targetMet: met,
    limitations: met === false
      ? ('Independent verified sources: ' + independent + '/' + target)
      : (verified.length === 0 ? 'No page-level evidence verified yet (search snippets alone are not verification).' : null)
  };
}

function parseTargetSourceCount(taskText) {
  const t = String(taskText || '');
  let m = t.match(/(\d+)\s*(?:\+|plus)?\s*(?:independent\s+)?(?:sources?|nguồn|nguon)/i);
  if (m) return Math.min(80, Math.max(1, parseInt(m[1], 10)));
  m = t.match(/(?:at least|ít nhất|toi thieu|tối thiểu)\s+(\d+)/i);
  if (m) return Math.min(80, Math.max(1, parseInt(m[1], 10)));
  return null;
}


function getEvidence(taskId, id) {
  const entries = loadLedger(taskId);
  const e = entries.find((x) => x.id === String(id) || x.id === 'E' + String(id).replace(/^E/i, ''));
  if (!e) return null;
  let text = e.snippet;
  try {
    if (e.textFile) text = fs.readFileSync(path.join(taskDir(taskId), e.textFile), 'utf8');
  } catch (_) {}
  return Object.assign({}, e, { text: clip(text, MAX_TEXT) });
}

function recall(taskId, { query, id, url } = {}) {
  if (id) {
    const e = getEvidence(taskId, id);
    return e ? [summarizeEntry(e)] : [];
  }
  const entries = loadLedger(taskId);
  if (url) {
    const u = String(url).toLowerCase();
    return entries.filter((e) => String(e.url).toLowerCase().includes(u)).slice(0, 8).map(summarizeEntry);
  }
  const q = String(query || '').toLowerCase().trim();
  if (!q) return entries.slice(-10).map(summarizeEntry);
  const hits = [];
  for (const e of entries) {
    let text = e.snippet || '';
    try {
      if (e.textFile) text = fs.readFileSync(path.join(taskDir(taskId), e.textFile), 'utf8');
    } catch (_) {}
    if ((e.title + ' ' + text + ' ' + e.url).toLowerCase().includes(q)) {
      hits.push(summarizeEntry(Object.assign({}, e, { text })));
    }
    if (hits.length >= 10) break;
  }
  return hits;
}

function summarizeEntry(e) {
  return {
    id: e.id,
    url: e.url,
    title: e.title,
    source: e.source,
    publishedAt: e.publishedAt,
    snippet: clip(e.snippet || e.text, MAX_SNIPPET),
    kind: e.kind
  };
}

function ledgerPromptBlock(taskId) {
  const entries = loadLedger(taskId).filter((x) => x && x.kind !== 'serp').slice(-30);
  const cov = researchCoverage(taskId, {});
  const head = 'RESEARCH_COVERAGE: found=' + cov.found + ' opened=' + cov.opened + ' verified=' + cov.verified + ' independentHosts=' + cov.independentHosts +
    (cov.target != null ? (' target=' + cov.target + ' met=' + cov.targetMet) : '') + '\n';
  if (!entries.length) return head + 'EVIDENCE: (empty — search snippets are NOT verified evidence until pages are opened/read)';
  return head + 'EVIDENCE (cite as [E#]; only verified page reads support factual claims):\n' + entries.map((e) =>
    `[${e.id}] ${e.verified ? 'verified' : 'unverified'} | ${e.sourceClass || 'web'} | ${e.source || ''} | ${e.publishedAt || '?'} | ${clip(e.title, 80)}\n  ${clip(e.snippet, 220)}\n  ${e.url}`
  ).join('\n');
}

function clearTaskEvidence(taskId) {
  const d = path.join(LEDGER_ROOT, String(taskId || ''));
  try {
    for (const f of fs.readdirSync(d)) fs.unlinkSync(path.join(d, f));
    fs.rmdirSync(d);
  } catch (_) {}
}

module.exports = {
  addEvidence, getEvidence, recall, loadLedger, ledgerPromptBlock, clearTaskEvidence, domainOf, clip,
  classifySourceClass, canonicalizeEvidenceUrl, researchCoverage, parseTargetSourceCount
};
