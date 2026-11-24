'use strict';
/**
 * Live Chromium observation for Browser Agent (page.evaluate / CDP).
 * Phase 1: smarter element classification, regions, noise reduction, page kind.
 * Does NOT parse sanitized Bridge HTML.
 * API shape remains compatible: url, title, text, elements[], targets, scroll, pageState.
 */

const crypto = require('crypto');

const OBSERVE_JS = `(() => {
  const MAX = 100;
  const SECRET_RE = /password|passcode|otp|one[- ]?time|cvv|cvc|credit.?card|card.?number|ssn|mật khẩu|mat khau|mã xác minh|ma otp/i;
  const NOISE_RE = /advertisement|sponsored|cookie.?banner|newsletter|subscribe.?popup|promo.?banner|social.?share/i;

  const abs = (h) => { try { return new URL(h, location.href).href; } catch { return ''; } };

  const vis = (el) => {
    try {
      if (!el || el.nodeType !== 1) return false;
      if (typeof el.checkVisibility === 'function') {
        return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      }
      const st = getComputedStyle(el);
      if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1;
    } catch { return false; }
  };

  const inView = (el) => {
    try {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight || 800, vw = window.innerWidth || 1200;
      return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    } catch { return false; }
  };

  const labelledBy = (el) => {
    try {
      const id = el.getAttribute('aria-labelledby');
      if (!id) return '';
      return id.split(/\\s+/).map((i) => {
        const n = document.getElementById(i);
        return n ? (n.innerText || n.textContent || '').replace(/\\s+/g, ' ').trim() : '';
      }).filter(Boolean).join(' ').slice(0, 120);
    } catch { return ''; }
  };

  const accName = (el) => {
    const aria = el.getAttribute('aria-label') || '';
    const by = labelledBy(el);
    const title = el.getAttribute('title') || '';
    const ph = el.getAttribute('placeholder') || '';
    const name = el.getAttribute('name') || '';
    const alt = el.getAttribute('alt') || '';
    let t = '';
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      t = '';
    } else {
      t = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (t.length > 90) t = t.slice(0, 90);
    }
    // associated <label for=id>
    let lab = '';
    try {
      if (el.id) {
        const L = document.querySelector('label[for=\"' + CSS.escape(el.id) + '\"]');
        if (L) lab = (L.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
      }
      if (!lab && el.closest) {
        const wrap = el.closest('label');
        if (wrap) lab = (wrap.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 90);
      }
    } catch (_) {}
    return (aria || by || lab || title || ph || name || alt || t || el.getAttribute('value') || '').toString().slice(0, 120);
  };

  const isSecret = (el) => {
    const bits = [el.type, el.name, el.id, el.placeholder, el.autocomplete, el.getAttribute('aria-label'), el.getAttribute('aria-describedby')].join(' ');
    return SECRET_RE.test(bits) || String(el.type || '').toLowerCase() === 'password';
  };

  const isNoise = (el) => {
    try {
      const bits = [el.className, el.id, el.getAttribute('aria-label'), el.getAttribute('role')].join(' ');
      if (NOISE_RE.test(bits)) return true;
      if (el.closest && el.closest('[aria-hidden="true"]')) return true;
      if (el.closest && el.closest('aside[class*="ad" i], [data-ad], [id*="google_ads"]')) return true;
      return false;
    } catch { return false; }
  };

  const regionOf = (el) => {
    try {
      if (el.closest && el.closest('[role=dialog], dialog, .modal, [aria-modal="true"]')) return 'dialog';
      if (el.closest && el.closest('form')) return 'form';
      if (el.closest && el.closest('nav, [role=navigation], header')) return 'nav';
      if (el.closest && el.closest('footer, [role=contentinfo]')) return 'footer';
      if (el.closest && el.closest('aside, [role=complementary]')) return 'aside';
      if (el.closest && el.closest('main, [role=main], article')) return 'main';
      return 'page';
    } catch { return 'page'; }
  };

  const kindOf = (el) => {
    const tag = (el.tagName || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const type = String(el.type || '').toLowerCase();
    if (role === 'searchbox' || type === 'search' || (tag === 'input' && /search/i.test(el.name || el.id || el.placeholder || ''))) return 'search';
    if (tag === 'a' || role === 'link') return 'link';
    if (tag === 'button' || role === 'button' || type === 'submit' || type === 'button') return 'button';
    if (tag === 'select' || role === 'listbox' || role === 'combobox') return 'select';
    if (role === 'tab') return 'tab';
    if (role === 'menuitem' || role === 'menu') return 'menu';
    if (tag === 'textarea' || role === 'textbox' || (tag === 'input' && !['checkbox','radio','file','hidden','submit','button','image'].includes(type))) return 'input';
    if (type === 'checkbox' || role === 'checkbox') return 'checkbox';
    if (type === 'radio' || role === 'radio') return 'radio';
    if (tag === 'summary') return 'summary';
    if (el.isContentEditable) return 'editable';
    return tag || 'unknown';
  };

  const isInteractive = (el) => {
    if (!el || el.nodeType !== 1) return false;
    const tag = (el.tagName || '').toLowerCase();
    if (['script','style','noscript','meta','link','head','svg','path'].includes(tag)) return false;
    if (tag === 'a' && el.hasAttribute('href')) return true;
    if (['button','input','textarea','select','summary'].includes(tag)) return true;
    if (el.isContentEditable) return true;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (['button','link','tab','checkbox','radio','switch','option','menuitem','textbox','combobox','searchbox','slider'].includes(role)) return true;
    const st = getComputedStyle(el);
    if (st.cursor === 'pointer' && (el.onclick || el.getAttribute('onclick') || role === 'button')) return true;
    if (el.tabIndex >= 0 && role) return true;
    return false;
  };

  const walk = (root, out, depth) => {
    if (!root || depth > 14 || out.length > 400) return;
    try {
      const nodes = root.querySelectorAll ? root.querySelectorAll('a[href],button,input,textarea,select,summary,[role],[contenteditable=true],tabindex') : [];
      nodes.forEach((el) => {
        if (out.length > 400) return;
        if (!isInteractive(el)) return;
        if (!vis(el)) return;
        if (isSecret(el)) return;
        if (isNoise(el)) return;
        out.push(el);
      });
      // shadow DOM
      root.querySelectorAll && root.querySelectorAll('*').forEach((el) => {
        if (el.shadowRoot) walk(el.shadowRoot, out, depth + 1);
      });
    } catch (_) {}
  };

  const collected = [];
  walk(document, collected, 0);
  // same-origin iframes
  try {
    document.querySelectorAll('iframe').forEach((frame) => {
      try {
        const doc = frame.contentDocument;
        if (doc) walk(doc, collected, 1);
      } catch (_) {}
    });
  } catch (_) {}

  // score: prefer in-view, main region, search/buttons
  const scoreEl = (el) => {
    let s = 0;
    if (inView(el)) s += 20;
    const reg = regionOf(el);
    if (reg === 'main') s += 12;
    if (reg === 'form') s += 10;
    if (reg === 'dialog') s += 15;
    if (reg === 'nav') s += 4;
    if (reg === 'footer') s -= 8;
    if (reg === 'aside') s -= 4;
    const k = kindOf(el);
    if (k === 'search') s += 14;
    if (k === 'button') s += 8;
    if (k === 'input') s += 6;
    if (k === 'link') s += 3;
    return s;
  };

  collected.sort((a, b) => scoreEl(b) - scoreEl(a));

  const elements = [];
  const seen = new Set();
  let id = 0;
  for (const el of collected) {
    if (elements.length >= MAX) break;
    if (seen.has(el)) continue;
    seen.add(el);
    id += 1;
    const tag = (el.tagName || '').toLowerCase();
    const r = el.getBoundingClientRect();
    const kind = kindOf(el);
    const name = accName(el);
    const item = {
      id,
      tag,
      type: el.type || undefined,
      role: (el.getAttribute('role') || '') || undefined,
      kind,
      label: name,
      name,
      region: regionOf(el),
      href: tag === 'a' ? abs(el.getAttribute('href') || '') : undefined,
      value: isSecret(el) ? undefined : (el.value != null ? String(el.value).slice(0, 80) : undefined),
      placeholder: el.placeholder ? String(el.placeholder).slice(0, 80) : undefined,
      checked: el.checked === true ? true : undefined,
      disabled: !!(el.disabled || el.getAttribute('aria-disabled') === 'true'),
      bbox: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
      inView: inView(el) ? true : undefined
    };
    if (tag === 'select' && el.options) {
      item.options = Array.from(el.options).slice(0, 15).map((o) => String(o.text || o.value || '').slice(0, 40));
    }
    try { el.setAttribute('data-agent-id', String(id)); } catch (_) {}
    elements.push(item);
  }

  // Main content text without nav/footer/ads
  let textRoot = document.querySelector('article, main, [role=main]') || document.body;
  let text = '';
  try {
    const clone = textRoot.cloneNode(true);
    clone.querySelectorAll('nav, footer, script, style, noscript, svg, iframe, [role=navigation], [role=contentinfo], aside, [aria-hidden=true], [data-ad], .advertisement, .cookie-banner, #cookie-banner').forEach((n) => { try { n.remove(); } catch (_) {} });
    text = (clone.innerText || clone.textContent || '').replace(/\\s+/g, ' ').trim();
  } catch (_) {
    text = (document.body && (document.body.innerText || document.body.textContent) || '').replace(/\\s+/g, ' ').trim();
  }

  const pageState = [];
  if (document.querySelector('[role=dialog], dialog, .modal, [aria-modal="true"]')) pageState.push('dialog');
  if (document.querySelector('form')) pageState.push('form');
  if (document.querySelector('[role=tab], [role=tablist]')) pageState.push('tabs');
  if (document.querySelector('nav, [role=navigation]')) pageState.push('nav');
  if (document.querySelector('table')) pageState.push('table');
  if (document.querySelector('iframe')) pageState.push('iframe');
  try {
    if ([...document.querySelectorAll('*')].some((el) => el.shadowRoot)) pageState.push('shadow_dom');
  } catch (_) {}
  if (/cookie|consent/i.test(document.body ? document.body.innerText.slice(0, 2000) : '')) pageState.push('possible_cookie_banner');

  // pageKind heuristic
  let pageKind = 'generic';
  const path = (location.pathname || '').toLowerCase();
  const titleL = (document.title || '').toLowerCase();
  const hasSearch = elements.some((e) => e.kind === 'search');
  const hasManyLinks = elements.filter((e) => e.kind === 'link').length >= 12;
  if (pageState.includes('dialog') && elements.filter((e) => e.region === 'dialog').length) pageKind = 'dialog';
  else if (document.querySelector('article') && text.length > 400) pageKind = 'article';
  else if (pageState.includes('form') && elements.some((e) => e.kind === 'input')) pageKind = 'form';
  else if (pageState.includes('table') && document.querySelectorAll('table tr').length > 3) pageKind = 'table';
  else if (hasSearch && hasManyLinks) pageKind = 'search_results';
  else if (/\\/(search|results)/i.test(path) || /search results/i.test(titleL)) pageKind = 'search_results';
  else if (hasManyLinks && text.length < 800) pageKind = 'listing';
  else if (text.length > 1200) pageKind = 'content';

  // landmarks summary
  const landmarks = [];
  [['main','main,[role=main]'],['nav','nav,[role=navigation]'],['banner','header,[role=banner]'],['contentinfo','footer,[role=contentinfo]'],['form','form']].forEach(([name, sel]) => {
    try { if (document.querySelector(sel)) landmarks.push(name); } catch (_) {}
  });

  const targets = {};
  for (const e of elements) { targets[e.id] = String(e.id); }
  const searchEl = elements.find((e) => e.kind === 'search') || elements.find((e) => e.tag === 'input' && e.type === 'search');
  if (searchEl) targets.search = searchEl.id;
  const submitBtn = elements.find((e) => e.kind === 'button' && /submit|search|tìm|đăng|sign|log\\s*in|continue|tiếp/i.test(e.label || ''));
  if (submitBtn) targets.primary_submit = submitBtn.id;

  return {
    url: location.href,
    title: document.title || '',
    text: text.slice(0, 12000),
    textTotal: text.length,
    elements,
    targets,
    scroll: {
      y: Math.round(window.scrollY || document.documentElement.scrollTop || 0),
      height: Math.round(Math.max(document.body ? document.body.scrollHeight : 0, document.documentElement ? document.documentElement.scrollHeight : 0)),
      viewport: Math.round(window.innerHeight || 0)
    },
    pageState,
    pageKind,
    landmarks,
    remainingBelow: Math.max(0, collected.length - elements.length)
  };
})()`;

async function observeLive(playwrightEngine, pwSessionId, opts = {}) {
  if (!playwrightEngine || !pwSessionId) return null;
  const observationId = crypto.randomBytes(8).toString('hex');
  const offset = Math.max(0, Number(opts.textOffset) || 0);
  try {
    const raw = await playwrightEngine.evaluate(pwSessionId, OBSERVE_JS);
    if (!raw || typeof raw !== 'object') return null;
    const budget = Math.max(2000, Number(process.env.AGENT_OBS_TOKENS) || 6000);
    let text = String(raw.text || '');
    const maxChars = Math.min(text.length, Math.floor(budget * 3));
    text = text.slice(offset, offset + maxChars);
    const elements = Array.isArray(raw.elements) ? raw.elements : [];
    // Prefer in-view + main/dialog when truncating
    const ranked = elements.slice().sort((a, b) => {
      const sa = (a.inView ? 2 : 0) + (a.region === 'main' || a.region === 'dialog' || a.region === 'form' ? 2 : 0) + (a.kind === 'search' ? 3 : 0);
      const sb = (b.inView ? 2 : 0) + (b.region === 'main' || b.region === 'dialog' || b.region === 'form' ? 2 : 0) + (b.kind === 'search' ? 3 : 0);
      return sb - sa;
    });
    const maxEl = Math.min(ranked.length, Math.floor(budget / 50), 80);
    const els = ranked.slice(0, maxEl);
    return {
      observationId,
      readable: true,
      live: true,
      url: raw.url || '',
      title: raw.title || '',
      text,
      textOffset: offset,
      textTotal: Number(raw.textTotal) || text.length,
      elements: els,
      targets: raw.targets || {},
      scroll: raw.scroll || { y: 0, height: 0, viewport: 0 },
      pageState: raw.pageState || [],
      pageKind: raw.pageKind || 'generic',
      landmarks: Array.isArray(raw.landmarks) ? raw.landmarks.slice(0, 12) : [],
      remainingBelow: Number(raw.remainingBelow) || 0,
      audit: {
        controls: els.length,
        textLength: text.length,
        media: 0,
        pageKind: raw.pageKind || 'generic',
        landmarks: (raw.landmarks || []).length
      }
    };
  } catch (e) {
    return { error: String(e.message || e).slice(0, 200), observationId };
  }
}

function hashObservation(obs) {
  const key = [
    obs && obs.url,
    obs && obs.title,
    obs && obs.pageKind,
    (obs && obs.elements || []).map((e) => e.id + ':' + (e.kind || e.tag) + ':' + (e.label || '').slice(0, 40)).join('|'),
    obs && obs.scroll && obs.scroll.y
  ].join('::');
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}

module.exports = { observeLive, hashObservation, OBSERVE_JS };
