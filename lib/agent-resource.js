'use strict';
/**
 * Phase 5 — lightweight resource hygiene for Browser Agent.
 * No extra processes; clears transient vision buffers; reports simple stats.
 */

const THUMB_TTL_MS = Math.max(15000, Number(process.env.SOLOHOST_THUMB_TTL_MS) || 60000);

function clearObsVision(obs) {
  if (!obs || typeof obs !== 'object') return false;
  let cleared = false;
  if (obs.screenshotDataUrl) {
    delete obs.screenshotDataUrl;
    cleared = true;
  }
  if (obs.vision) {
    obs.vision = { used: !!obs.vision.used, reason: obs.vision.reason, clearedAt: new Date().toISOString() };
  }
  return cleared;
}

function clearSessionThumbs(sessionLike) {
  if (!sessionLike) return;
  try {
    if (sessionLike.thumbDataUrl) {
      const age = Date.now() - (sessionLike.thumbAt || 0);
      if (age > THUMB_TTL_MS || true) {
        // Always clear on explicit hygiene call (agent release / after plan)
        sessionLike.thumbDataUrl = null;
        sessionLike.thumbAt = 0;
      }
    }
    if (sessionLike.screenshot) sessionLike.screenshot = null;
  } catch (_) {}
}

/** Drop vision payload from task after planner consumed the step (or on release). */
function hygieneAfterStep(task, opts) {
  const o = opts || {};
  let n = 0;
  try {
    if (task && task._lastObservation) {
      if (clearObsVision(task._lastObservation)) n++;
    }
    if (o.force && task && task.session) {
      clearSessionThumbs(task.session);
      n++;
    }
  } catch (_) {}
  return n;
}

function hygieneOnRelease(task) {
  try {
    hygieneAfterStep(task, { force: true });
    if (task) {
      task._lastActionFailed = false;
      task._consecutiveNoEffect = 0;
      // keep researchCoverage / report on disk; drop only heavy buffers
    }
    const pe = require('./engine/playwright-engine');
    const sess = task && task.session;
    const pwId = sess && (sess.pwSessionId || sess.engineSessionId);
    if (pwId && pe.getSession) {
      const st = pe.getSession(pwId);
      if (st) clearSessionThumbs(st);
    }
  } catch (_) {}
}

function engineStats() {
  try {
    const pe = require('./engine/playwright-engine');
    let size = null;
    if (typeof pe.status === 'function') {
      const st = pe.status();
      size = st && (st.sessions != null ? st.sessions : st.activeSessions);
    }
    return {
      sessions: size != null ? size : null,
      maxSessions: Number(process.env.SOLOHOST_PW_MAX_SESSIONS) || 50,
      thumbTtlMs: THUMB_TTL_MS,
      at: new Date().toISOString()
    };
  } catch (e) {
    return { sessions: null, error: String(e.message || e).slice(0, 80) };
  }
}

module.exports = {
  THUMB_TTL_MS,
  clearObsVision,
  clearSessionThumbs,
  hygieneAfterStep,
  hygieneOnRelease,
  engineStats
};
