'use strict';
/**
 * Phase 3 — Visual fallback (gated).
 * DOM remains default. Screenshots only when observation is insufficient
 * or recent DOM actions failed. Never required; fails soft without vision models.
 */

const MAX_SHOT_CHARS = 160000; // data URL length budget
const MIN_INTERVAL_MS = 8000; // don't spam screenshots

function visionMode() {
  return String(process.env.AGENT_VISION || 'auto').toLowerCase();
}

function modelLikelySupportsVision(model) {
  const m = String(model || '').toLowerCase();
  if (!m || m === 'auto') return true; // auto may pick a vision-capable model
  return /gpt-4o|gpt-4\.1|gpt-4-turbo|gemini|claude-3|claude-4|vision|llava|pixtral|qwen2(\.|-)vl|qwen-vl|grok-2-vision/.test(m);
}

/** Skip vision if observation already exposes password/OTP fields (privacy). */
function observationLooksSensitive(obs) {
  const els = (obs && obs.elements) || [];
  for (const e of els) {
    const bits = [e.type, e.label, e.name, e.placeholder, e.kind].join(' ');
    if (/password|otp|cvv|cvc|credit.?card|mật khẩu|ma otp/i.test(bits)) return true;
    if (String(e.type || '').toLowerCase() === 'password') return true;
  }
  const text = String((obs && obs.text) || '').slice(0, 1500);
  if (/\b(password|otp|cvv|card number)\b/i.test(text)) return true;
  return false;
}

/**
 * Decide whether to capture/attach a screenshot.
 * @returns {{ capture: boolean, reason: string }}
 */
function shouldRequestVision(obs, ctx) {
  const mode = visionMode();
  if (mode === 'off') return { capture: false, reason: 'vision_off' };
  const c = ctx || {};
  if (observationLooksSensitive(obs)) return { capture: false, reason: 'sensitive_page' };
  if (c.lastVisionAt && Date.now() - c.lastVisionAt < MIN_INTERVAL_MS) {
    return { capture: false, reason: 'rate_limited' };
  }
  if (mode === 'on') return { capture: true, reason: 'forced_on' };

  // auto heuristics
  const els = (obs && obs.elements) || [];
  const textLen = String((obs && obs.text) || '').trim().length;
  const pageKind = (obs && obs.pageKind) || '';
  const recentFail = !!(c.lastActionFailed);
  const recoverCodes = c.lastErrorCode || '';
  const hardFail = /MISSING_ELEMENT|NO_EFFECT|INTERCEPTED|STALE_ELEMENT|ACTION_FAILED/i.test(String(recoverCodes));

  if (recentFail && hardFail) return { capture: true, reason: 'dom_action_failed' };
  if (els.length < 4 && textLen < 350) return { capture: true, reason: 'thin_dom' };
  if (pageKind === 'dialog' && els.length < 6) return { capture: true, reason: 'dialog_thin' };
  if (c.consecutiveNoEffect >= 2) return { capture: true, reason: 'no_effect_streak' };
  return { capture: false, reason: 'dom_sufficient' };
}

/**
 * Capture a bounded JPEG data URL from Playwright session.
 */
async function captureVisionShot(playwrightEngine, pwSessionId, opts) {
  if (!playwrightEngine || !pwSessionId) return { ok: false, error: 'no_session' };
  if (typeof playwrightEngine.captureThumbnail !== 'function') {
    return { ok: false, error: 'capture_unavailable' };
  }
  try {
    const shot = await playwrightEngine.captureThumbnail(pwSessionId, {
      quality: Math.min(45, Math.max(28, Number((opts && opts.quality) || 35)))
    });
    if (!shot || typeof shot !== 'string') return { ok: false, error: 'empty_shot' };
    if (shot.length > MAX_SHOT_CHARS) return { ok: false, error: 'shot_too_large' };
    if (!/^data:image\/(jpeg|png|webp);base64,/i.test(shot)) {
      return { ok: false, error: 'invalid_data_url' };
    }
    return { ok: true, screenshotDataUrl: shot, bytes: shot.length };
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 120) };
  }
}

/**
 * Attach vision image to planStep body observation if allowed.
 * Mutates obs; returns metadata for logs.
 */
async function maybeAttachVision(obs, session, ctx) {
  const decision = shouldRequestVision(obs, ctx);
  if (!decision.capture) {
    return { attached: false, reason: decision.reason };
  }
  if (!session || !session.pwSessionId) {
    return { attached: false, reason: 'no_live_engine' };
  }
  let pw;
  try {
    pw = require('./engine/playwright-engine');
  } catch (_) {
    return { attached: false, reason: 'engine_missing' };
  }
  const shot = await captureVisionShot(pw, session.pwSessionId, {});
  if (!shot.ok) {
    return { attached: false, reason: shot.error || 'capture_failed' };
  }
  obs.screenshotDataUrl = shot.screenshotDataUrl;
  obs.vision = {
    used: true,
    reason: decision.reason,
    at: new Date().toISOString(),
    approxBytes: shot.bytes
  };
  if (ctx) ctx.lastVisionAt = Date.now();
  return { attached: true, reason: decision.reason, bytes: shot.bytes };
}

function visionPromptHint(lang) {
  const vi = lang === 'vi';
  return vi
    ? 'VISION: Ảnh chụp màn hình chỉ là hỗ trợ khi DOM mỏng hoặc thao tác thất bại. Ưu tiên id phần tử trong observation; không đoán mật khẩu; không click toạ độ mù.'
    : 'VISION: Screenshot is assistive only when DOM is thin or actions failed. Prefer element ids from observation; never invent passwords; no blind coordinate clicks.';
}

module.exports = {
  visionMode,
  modelLikelySupportsVision,
  observationLooksSensitive,
  shouldRequestVision,
  captureVisionShot,
  maybeAttachVision,
  visionPromptHint,
  MAX_SHOT_CHARS,
  MIN_INTERVAL_MS
};
