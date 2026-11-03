'use strict';
const proxyManager = require('./proxy-manager');
const { redactErrorMessage } = require('./proxy-config');

function mountProxyRoutes(app) {
  app.get('/api/proxy/status', (req, res) => {
    res.json({ ok: true, ...proxyManager.publicState(String(req.query.lang || '').slice(0, 5)) });
  });
  app.get('/api/proxy/providers', (_req, res) => {
    res.json({ ok: true, providers: proxyManager.listProviders() });
  });
  app.post('/api/proxy/entries', async (req, res) => {
    try {
      const entry = await proxyManager.upsertEntry(req.body || {});
      res.json({ ok: true, entry, ...proxyManager.publicState() });
    } catch (e) { res.status(400).json({ ok: false, error: redactErrorMessage(e.message), code: e.code || 'INVALID_CONFIGURATION' }); }
  });
  app.put('/api/proxy/entries/:id', async (req, res) => {
    try {
      const entry = await proxyManager.upsertEntry({ ...(req.body || {}), id: req.params.id });
      res.json({ ok: true, entry, ...proxyManager.publicState() });
    } catch (e) { res.status(400).json({ ok: false, error: redactErrorMessage(e.message), code: e.code || 'INVALID_CONFIGURATION' }); }
  });
  app.delete('/api/proxy/entries/:id', (req, res) => {
    try { res.json({ ok: true, ...proxyManager.removeEntry(req.params.id) }); }
    catch (e) { res.status(400).json({ ok: false, error: redactErrorMessage(e.message), code: e.code || 'ERROR' }); }
  });
  app.post('/api/proxy/select', (req, res) => {
    try { res.json({ ok: true, ...proxyManager.selectActive((req.body || {}).id) }); }
    catch (e) { res.status(400).json({ ok: false, error: redactErrorMessage(e.message), code: e.code || 'INVALID_CONFIGURATION' }); }
  });
  app.post('/api/proxy/connect', async (req, res) => {
    try {
      const body = req.body || {};
      if (body.id) proxyManager.selectActive(body.id);
      const st = await proxyManager.connect({ id: body.id, lang: body.lang });
      res.json({ ok: st.lastStatus && st.lastStatus.state === 'CONNECTED', ...st });
    } catch (e) { res.status(502).json({ ok: false, error: redactErrorMessage(e.message), code: e.code || 'CONNECTION_FAILED' }); }
  });
  app.post('/api/proxy/disconnect', async (req, res) => {
    try { res.json({ ok: true, ...await proxyManager.disconnect({ lang: (req.body || {}).lang }) }); }
    catch (e) { res.status(500).json({ ok: false, error: redactErrorMessage(e.message) }); }
  });
  app.post('/api/proxy/test', async (req, res) => {
    try {
      const body = req.body || {};
      const result = body.id ? await proxyManager.testEntry(body.id) : await proxyManager.testEntry(body);
      res.json({ ok: !!result.ok, ...result });
    } catch (e) { res.status(400).json({ ok: false, error: redactErrorMessage(e.message), code: e.code || 'CONNECTION_FAILED' }); }
  });
  app.post('/api/proxy/profile', (req, res) => {
    try {
      const body = req.body || {};
      res.json({ ok: true, ...proxyManager.setProfileProxy(body.profileKey || body.profile, body) });
    } catch (e) { res.status(400).json({ ok: false, error: redactErrorMessage(e.message), code: e.code || 'INVALID_CONFIGURATION' }); }
  });
}
module.exports = { mountProxyRoutes };
