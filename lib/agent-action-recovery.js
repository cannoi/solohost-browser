'use strict';
/**
 * Smart action recovery helpers (Phase 2).
 * Bounded retries, semantic fallbacks, post-action verification signals.
 */

const MAX_RETRIES = 2;

function normalizeLabel(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findElement(obs, id) {
  const els = (obs && obs.elements) || [];
  return els.find((e) => Number(e.id) === Number(id)) || null;
}

function resolveTarget(obs, id) {
  const targets = (obs && obs.targets) || {};
  const el = findElement(obs, id);
  if (targets[id] != null && targets[id] !== '') {
    return { ok: true, targetId: String(targets[id]), el, strategy: 'target_map' };
  }
  if (el) {
    return {
      ok: true,
      targetId: String(id),
      el,
      strategy: 'agent_id',
      locator: {
        kind: el.kind,
        role: el.role,
        label: el.label || el.name,
        tag: el.tag,
        type: el.type,
        placeholder: el.placeholder,
        href: el.href
      }
    };
  }
  return { ok: false, error: 'unknown_element_id', code: 'MISSING_ELEMENT' };
}

function isSensitiveConfirmLabel(label) {
  return /\b(buy|purchase|pay|checkout|confirm payment|place order|transfer|wire|delete account|mua ngay|thanh toán|xác nhận thanh toán)\b/i.test(
    String(label || '')
  );
}

function classifyActionError(err, ctx) {
  const msg = String((err && err.message) || err || '').toLowerCase();
  if (/unknown_element|missing_element|not found|no node/i.test(msg)) return 'MISSING_ELEMENT';
  if (/detached|stale|not attached|not in the document/i.test(msg)) return 'STALE_ELEMENT';
  if (/intercept|covered|overlay|pointer-events/i.test(msg)) return 'INTERCEPTED';
  if (/timeout|timed out/i.test(msg)) return 'TIMEOUT';
  if (/disabled|not enabled|not editable/i.test(msg)) return 'DISABLED';
  if (/navigation|net::|dns/i.test(msg)) return 'NAVIGATION_ERROR';
  if (ctx && ctx.noEffect) return 'NO_EFFECT';
  return 'ACTION_FAILED';
}

function snapshotPage(session, obs) {
  return {
    url: (session && (session.url || session.lastUrl)) || (obs && obs.url) || '',
    title: (session && session.title) || (obs && obs.title) || '',
    scrollY: (obs && obs.scroll && obs.scroll.y) || 0,
    elCount: (obs && obs.elements && obs.elements.length) || 0
  };
}

function pageChanged(before, after) {
  if (!before || !after) return true;
  if (before.url && after.url && before.url !== after.url) return true;
  if (before.title && after.title && before.title !== after.title) return true;
  if (Math.abs((after.scrollY || 0) - (before.scrollY || 0)) > 80) return true;
  return false;
}

/**
 * Try semantic Playwright locators when data-sh-id / data-agent-id fails.
 * Never uses arbitrary x,y clicks.
 */
async function trySemanticClick(page, locator) {
  if (!page || !locator) return { ok: false, strategy: 'none' };
  const label = String(locator.label || '').trim();
  const role = String(locator.role || '').trim();
  const kind = String(locator.kind || '').trim();
  const attempts = [];

  const tryLoc = async (name, fn) => {
    try {
      await fn();
      return true;
    } catch (e) {
      attempts.push(name + ':' + String(e.message || e).slice(0, 60));
      return false;
    }
  };

  if (kind === 'button' || role === 'button') {
    if (label && (await tryLoc('role=button', () => page.getByRole('button', { name: label, exact: false }).first().click({ timeout: 2500 })))) {
      return { ok: true, strategy: 'role_button' };
    }
  }
  if (kind === 'link' || role === 'link') {
    if (label && (await tryLoc('role=link', () => page.getByRole('link', { name: label, exact: false }).first().click({ timeout: 2500 })))) {
      return { ok: true, strategy: 'role_link' };
    }
  }
  if (label && (await tryLoc('getByLabel', () => page.getByLabel(label, { exact: false }).first().click({ timeout: 2000 })))) {
    return { ok: true, strategy: 'label' };
  }
  if (locator.placeholder && (await tryLoc('placeholder', () => page.getByPlaceholder(locator.placeholder, { exact: false }).first().click({ timeout: 2000 })))) {
    return { ok: true, strategy: 'placeholder' };
  }
  if (label && label.length >= 2 && (await tryLoc('text', () => page.getByText(label, { exact: false }).first().click({ timeout: 2000 })))) {
    return { ok: true, strategy: 'text' };
  }
  return { ok: false, strategy: 'semantic_exhausted', attempts };
}

async function trySemanticType(page, locator, text, submit) {
  if (!page || !locator) return { ok: false, strategy: 'none' };
  const label = String(locator.label || '').trim();
  const val = String(text || '');
  const fill = async (loc) => {
    await loc.fill(val, { timeout: 4000 });
    if (submit) await loc.press('Enter').catch(() => {});
  };
  try {
    if (label) {
      await fill(page.getByLabel(label, { exact: false }).first());
      return { ok: true, strategy: 'label' };
    }
  } catch (_) {}
  try {
    if (locator.placeholder) {
      await fill(page.getByPlaceholder(String(locator.placeholder), { exact: false }).first());
      return { ok: true, strategy: 'placeholder' };
    }
  } catch (_) {}
  try {
    if (locator.kind === 'search' || locator.type === 'search') {
      await fill(page.getByRole('searchbox').first());
      return { ok: true, strategy: 'role_searchbox' };
    }
  } catch (_) {}
  return { ok: false, strategy: 'semantic_exhausted' };
}

module.exports = {
  MAX_RETRIES,
  normalizeLabel,
  findElement,
  resolveTarget,
  isSensitiveConfirmLabel,
  classifyActionError,
  snapshotPage,
  pageChanged,
  trySemanticClick,
  trySemanticType
};
