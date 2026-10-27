'use strict';
/**
 * Agent reliability: error classification, bounded retries, cancellation,
 * duplicate-action guard, lifecycle normalization.
 * Never auto-retries non-idempotent actions (click/type/submit).
 */

const DEFAULTS = {
  maxRetries: 2,
  baseDelayMs: 200,
  maxDelayMs: 2500
};

const IDEMPOTENT_ACTIONS = new Set([
  'navigate', 'search', 'wait', 'read', 'note', 'extract_page', 'back', 'forward', 'scroll'
]);

function classifyError(err, opts) {
  const msg = String(
    (err && err.message) || (err && err.error) || (err && err.result) || err || ''
  ).slice(0, 400);
  const low = msg.toLowerCase();
  const status = Number(
    (err && (err.status || err.statusCode || err.httpStatus)) ||
    (opts && opts.httpStatus) || 0
  ) || 0;

  if (status === 404 || /\b404\b|not found|page not found|http.?404/i.test(msg)) {
    return { code: 'HTTP_404', transient: false, httpStatus: 404, message: msg };
  }
  if (status === 408 || status === 504 || /timeout|timed?\s*out|etimedout|navigation timeout|timeouterror/i.test(msg)) {
    return { code: 'TIMEOUT', transient: true, httpStatus: status || undefined, message: msg };
  }
  if (/enotfound|getaddrinfo|dns|err_name_not_resolved|nxdomain/i.test(low)) {
    return { code: 'DNS', transient: true, message: msg };
  }
  if (/econnrefused|econnreset|econnaborted|socket hang up|network|net::err_|connection (reset|refused|closed)/i.test(low)) {
    return { code: 'CONNECTION', transient: true, message: msg };
  }
  if (/unknown_element|missing.?element|no such element|not visible|target closed|unknown_element_id/i.test(low)) {
    return { code: 'MISSING_ELEMENT', transient: false, message: msg };
  }
  if (/blocked_secret|login_requires|captcha|challenge|verification required/i.test(low)) {
    return { code: 'BLOCKED_INTERACTION', transient: false, message: msg };
  }
  if (status >= 500 && status <= 599) {
    return { code: 'HTTP_5XX', transient: true, httpStatus: status, message: msg };
  }
  if (status >= 400 && status <= 499) {
    return { code: 'HTTP_4XX', transient: false, httpStatus: status, message: msg };
  }
  if (/cancelled|canceled|aborted|task_stop|stopped by user/i.test(low)) {
    return { code: 'CANCELLED', transient: false, message: msg };
  }
  return { code: 'UNKNOWN', transient: false, message: msg };
}

function isIdempotentAction(actionType) {
  return IDEMPOTENT_ACTIONS.has(String(actionType || '').toLowerCase());
}

function shouldRetry(classification, actionType, attempt, maxRetries) {
  const max = Math.max(0, Number(maxRetries != null ? maxRetries : DEFAULTS.maxRetries));
  if (attempt >= max) return false;
  if (!classification || !classification.transient) return false;
  if (!isIdempotentAction(actionType)) return false;
  return true;
}

function backoffMs(attempt, baseMs, maxMs) {
  const base = Math.max(10, Number(baseMs != null ? baseMs : DEFAULTS.baseDelayMs));
  const max = Math.max(base, Number(maxMs != null ? maxMs : DEFAULTS.maxDelayMs));
  const exp = Math.min(max, base * Math.pow(2, Math.max(0, attempt)));
  return Math.floor(Math.random() * (exp + 1));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, Number(ms) || 0)));
}

async function withBoundedRetry(opts) {
  const actionType = opts.actionType || 'navigate';
  const maxRetries = opts.maxRetries != null ? opts.maxRetries : DEFAULTS.maxRetries;
  const isOk = opts.isOk || ((r) => r && r.ok !== false && !r.error);
  const attempts = [];
  let lastResult = null;
  let lastClass = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (opts.shouldAbort && opts.shouldAbort()) {
      return {
        ok: false,
        cancelled: true,
        classification: { code: 'CANCELLED', transient: false, message: 'cancelled' },
        attempts,
        result: { ok: false, result: 'cancelled', error: 'cancelled' }
      };
    }
    try {
      const result = await opts.fn(attempt);
      lastResult = result;
      if (isOk(result)) {
        return { ok: true, result, attempts, classification: null };
      }
      const errLike = (result && (result.error || result.result || result.message)) || 'action_failed';
      lastClass = classifyError(errLike, { httpStatus: result && result.status });
      attempts.push({ attempt, classification: lastClass, ok: false });
      if (!shouldRetry(lastClass, actionType, attempt, maxRetries)) {
        return { ok: false, result, classification: lastClass, attempts };
      }
      const delay = backoffMs(attempt, opts.baseDelayMs, opts.maxDelayMs);
      if (opts.onAttempt) opts.onAttempt({ attempt, classification: lastClass, delayMs: delay });
      await sleep(delay);
    } catch (e) {
      lastClass = classifyError(e);
      attempts.push({ attempt, classification: lastClass, ok: false, threw: true });
      lastResult = { ok: false, error: String(e.message || e), result: String(e.message || e) };
      if (!shouldRetry(lastClass, actionType, attempt, maxRetries)) {
        return { ok: false, result: lastResult, classification: lastClass, attempts };
      }
      const delay = backoffMs(attempt, opts.baseDelayMs, opts.maxDelayMs);
      if (opts.onAttempt) opts.onAttempt({ attempt, classification: lastClass, delayMs: delay });
      await sleep(delay);
    }
  }
  return { ok: false, result: lastResult, classification: lastClass, attempts };
}

function normalizeTaskStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'done') return 'succeeded';
  if (s === 'stopped' || s === 'stopping') return 'cancelled';
  if (s === 'error') return 'failed';
  return s || 'queued';
}

function actionSignature(action) {
  if (!action || typeof action !== 'object') return 'none';
  return [
    action.type || '',
    action.id != null ? String(action.id) : '',
    String(action.url || '').slice(0, 120),
    String(action.query || '').slice(0, 80),
    String(action.text || action.value || '').slice(0, 40)
  ].join('|');
}

function isDuplicateBurst(signatures, nextSig, n) {
  const need = Math.max(2, Number(n) || 3);
  if (!nextSig) return false;
  const arr = Array.isArray(signatures) ? signatures : [];
  const tail = arr.slice(-(need - 1));
  return tail.length >= need - 1 && tail.every((s) => s === nextSig);
}

function structuredError(classification, extra) {
  const c = classification || { code: 'UNKNOWN', message: '', transient: false };
  return {
    ok: false,
    error: {
      code: c.code,
      transient: !!c.transient,
      message: String(c.message || '').slice(0, 400),
      httpStatus: c.httpStatus || undefined,
      ...(extra || {})
    },
    result: c.code + ': ' + String(c.message || '').slice(0, 200)
  };
}

module.exports = {
  DEFAULTS,
  IDEMPOTENT_ACTIONS,
  classifyError,
  isIdempotentAction,
  shouldRetry,
  backoffMs,
  sleep,
  withBoundedRetry,
  normalizeTaskStatus,
  actionSignature,
  isDuplicateBurst,
  structuredError
};
