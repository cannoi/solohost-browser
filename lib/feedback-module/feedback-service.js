/**
 * Universal SoloHost Feedback Hub server module.
 * Token stays on the server — never sent to the browser client.
 * Hub endpoint is preconfigured for this SoloHost Browser release.
 */
'use strict';

const DEFAULTS = {
  hubId: 'SHFH-CANNOI-0905428801',
  baseUrl: 'http://14.176.78.46:8090',
  // Server-side only; publicConfig never returns this value.
  ingestToken: 'cannoi_7Kp9xV2mQ8rN4tY6cL3wA5zD1eF0uH9'
};

/** Allow HTTP to private/LAN hubs; still prefer HTTPS for public internet hosts. */
function isAllowedHubTransport(urlString) {
  try {
    const u = new URL(String(urlString || ''));
    if (u.protocol === 'https:') return true;
    if (u.protocol !== 'http:') return false;
    const host = (u.hostname || '').toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
    // Private IPv4 ranges + this product's known Hub host
    if (/^10\.\d+\.\d+\.\d+$/.test(host)) return true;
    if (/^192\.168\.\d+\.\d+$/.test(host)) return true;
    if (/^172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+$/.test(host)) return true;
    if (host === '14.176.78.46') return true;
    // Explicit override for special deployments
    if (String(process.env.SHFH_ALLOW_HTTP || '').trim() === '1') return true;
    return false;
  } catch (_) {
    return false;
  }
}

function getKnowledgeConfig(opts = {}) {
  const hubId = String(opts.hubId || process.env.SHFH_HUB_ID || DEFAULTS.hubId).slice(0, 128);
  const baseUrl = String(opts.baseUrl || process.env.SHFH_HUB_URL || DEFAULTS.baseUrl);
  const tokenConfigured = String(
    opts.ingestToken != null ? opts.ingestToken : (process.env.SHFH_INGEST_TOKEN || DEFAULTS.ingestToken || '')
  ).length > 0;
  let safeBaseUrl = '(invalid Hub URL)';
  let allowed = false;
  try {
    const url = new URL(baseUrl);
    allowed = isAllowedHubTransport(url.href);
    safeBaseUrl = (url.origin + url.pathname.replace(/\/$/, '')).slice(0, 300);
  } catch (_) {}
  return {
    hubId,
    baseUrl: safeBaseUrl,
    ingestEnabled: tokenConfigured && allowed,
    ingestStatus: !tokenConfigured
      ? 'disabled: ingest token missing'
      : (allowed
        ? 'enabled (server-side Hub; users do not enter credentials)'
        : 'disabled: Hub URL must be HTTPS or an allowed private HTTP endpoint')
  };
}

function createFeedbackService(opts = {}) {
  const envTok = process.env.SHFH_INGEST_TOKEN;
  // Explicit opts.ingestToken (including '') wins; else env; else product default.
  const ingestToken = String(
    Object.prototype.hasOwnProperty.call(opts, 'ingestToken')
      ? (opts.ingestToken || '')
      : (envTok != null && String(envTok) !== '' ? envTok : DEFAULTS.ingestToken)
  );
  const cfg = {
    ...DEFAULTS,
    ...opts,
    hubId: opts.hubId || process.env.SHFH_HUB_ID || DEFAULTS.hubId,
    baseUrl: opts.baseUrl || process.env.SHFH_HUB_URL || DEFAULTS.baseUrl,
    ingestToken
  };
  const appId = opts.appId || process.env.SHFH_APP_ID || 'solohost-browser';
  const appName = opts.appName || process.env.SHFH_APP_NAME || 'SoloHost Browser';
  const version = opts.version || process.env.SHFH_APP_VERSION || '1.0.0';
  const base = String(cfg.baseUrl).replace(/\/$/, '');
  const transportOk = isAllowedHubTransport(base);

  async function request(method, path, body) {
    const headers = { Accept: 'application/json' };
    if (method !== 'GET') headers['Content-Type'] = 'application/json';
    if (path === '/api/feedback') {
      if (!cfg.ingestToken) throw new Error('Feedback Hub ingest token is not configured');
      if (!transportOk) {
        throw new Error('Feedback Hub ingestion requires HTTPS or an allowed private HTTP Hub endpoint');
      }
      headers.Authorization = 'Bearer ' + cfg.ingestToken;
    }
    const r = await fetch(base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      redirect: path === '/api/feedback' ? 'error' : 'follow',
      signal: AbortSignal.timeout(12000)
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      let detail = '';
      if (typeof j.error === 'string') detail = j.error;
      else if (j.error && typeof j.error === 'object') detail = j.error.message || j.error.code || JSON.stringify(j.error).slice(0, 120);
      else if (j.message) detail = j.message;
      throw new Error(detail || ('Feedback Hub HTTP ' + r.status));
    }
    return j;
  }

  function publicConfig() {
    // Never expose ingestToken to the browser
    return {
      enabled: !!(cfg.ingestToken && transportOk),
      hubId: cfg.hubId,
      appId,
      appName,
      version
    };
  }

  async function sync(anonymousId) {
    const anon = String(anonymousId || '').slice(0, 128);
    const q = '?app_id=' + encodeURIComponent(appId)
      + '&anonymous_id=' + encodeURIComponent(anon);
    // Hub v2.5: /api/feedback/sync returns policy+donate but often empty notices.
    // Actual per-user + broadcast notices live on GET /api/notices (items[]).
    let policyPack = {};
    try {
      policyPack = await request('GET', '/api/feedback/sync' + q);
    } catch (e) {
      policyPack = { ok: false, error: String(e.message || e).slice(0, 200) };
    }
    let noticeItems = [];
    try {
      const noticePack = await request('GET', '/api/notices' + q);
      if (Array.isArray(noticePack.items)) noticeItems = noticePack.items;
      else if (Array.isArray(noticePack.notices)) noticeItems = noticePack.notices;
    } catch (e) {
      // Keep policy/donate even if notices endpoint fails
      noticeItems = Array.isArray(policyPack.notices) ? policyPack.notices : [];
    }
    // Prefer unread; keep broadcast (empty anonymous_id) + this user
    const notices = noticeItems
      .filter((n) => n && n.id)
      .filter((n) => n.read !== true)
      .map((n) => ({
        id: n.id,
        title: n.title || n.kind || 'Notice',
        body: n.body || n.message || '',
        kind: n.kind || 'notice',
        read: !!n.read,
        created_at: n.created_at || n.createdAt || null,
        app_id: n.app_id || null
      }));
    const donate = policyPack.donate
      || (policyPack.policy && policyPack.policy.donate)
      || null;
    return {
      ok: true,
      notices,
      donate,
      policy: policyPack.policy || null,
      hub: policyPack
    };
  }

  async function markRead(noticeId, anonymousId) {
    return request('POST', '/api/notices/' + encodeURIComponent(String(noticeId || '')) + '/read', {
      app_id: appId,
      anonymous_id: String(anonymousId || '').slice(0, 128)
    });
  }

  async function send(payload) {
    const body = {
      event: 'feedback',
      type: String(payload.type || 'improvement').slice(0, 40),
      rating: payload.rating != null ? Number(payload.rating) : undefined,
      message: String(payload.message || '').slice(0, 8000),
      anonymous_id: String(payload.anonymous_id || '').slice(0, 128),
      locale: String(payload.locale || 'en').slice(0, 16),
      app_id: appId,
      app_name: appName,
      version
    };
    return request('POST', '/api/feedback', body);
  }

  return { publicConfig, sync, markRead, send, cfg: { hubId: cfg.hubId, baseUrl: base, hasToken: !!cfg.ingestToken } };
}

function mountFeedbackRoutes(router, service) {
  router.get('/api/feedback/config', (req, res) => {
    res.json({ ok: true, ...(service.publicConfig ? service.publicConfig() : {}) });
  });
  router.get('/api/feedback/sync', async (req, res) => {
    try {
      const out = await service.sync(req.query.anonymous_id || '');
      res.json({
        ok: true,
        notices: (out && out.notices) || [],
        donate: (out && out.donate) || null,
        policy: (out && out.policy) || null
      });
    } catch (e) {
      res.status(502).json({ ok: false, error: String(e.message || e).slice(0, 200) });
    }
  });
  router.post('/api/feedback/read/:id', async (req, res) => {
    try {
      const body = req.body || {};
      const out = await service.markRead(req.params.id, body.anonymous_id || req.query.anonymous_id || '');
      res.json({ ok: true, ...(out || {}) });
    } catch (e) {
      res.status(502).json({ ok: false, error: String(e.message || e).slice(0, 200) });
    }
  });
  router.post('/api/feedback', async (req, res) => {
    try {
      const b = req.body || {};
      // Forward only documented fields — never passwords/tokens/cookies/history
      const out = await service.send({
        event: 'feedback',
        type: b.type,
        rating: b.rating,
        message: b.message,
        anonymous_id: b.anonymous_id,
        locale: b.locale
      });
      res.json({ ok: true, ...(out || {}) });
    } catch (e) {
      const msg = String(e.message || e);
      const reason = /not configured|requires HTTPS|allowed private/i.test(msg)
        ? msg
        : 'Feedback Hub unavailable';
      res.status(502).json({ ok: false, error: reason.slice(0, 240) });
    }
  });
}

module.exports = {
  createFeedbackService,
  mountFeedbackRoutes,
  DEFAULTS,
  getKnowledgeConfig,
  isAllowedHubTransport
};
