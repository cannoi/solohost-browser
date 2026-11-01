'use strict';

const assert = require('assert');
const {
  createFeedbackService,
  mountFeedbackRoutes,
  DEFAULTS
} = require('../lib/feedback-module/feedback-service');

async function main() {
  assert.strictEqual(DEFAULTS.ingestToken, '', 'no ingest credential is bundled');
  const missing = createFeedbackService({ baseUrl: 'https://hub.example', ingestToken: '' });
  assert.strictEqual(missing.publicConfig().enabled, false, 'feedback is disabled without owner token');

  const http = createFeedbackService({
    baseUrl: 'http://hub.example',
    ingestToken: 'test-token'
  });
  assert.strictEqual(http.publicConfig().enabled, false, 'token submission is disabled on HTTP');

  const service = createFeedbackService({
    baseUrl: 'https://hub.example',
    ingestToken: 'test-token',
    appId: 'solohost-browser',
    appName: 'SoloHost Browser',
    version: 'test'
  });
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true, status: 200, json: async () => ({ ok: true, items: [] }) };
  };
  try {
    await assert.rejects(missing.send({ message: 'hello' }), /not configured/,
      'missing owner token is a clear configuration error');
    await assert.rejects(http.send({ message: 'hello' }), /requires HTTPS/,
      'bearer token is never submitted to an HTTP endpoint');
    assert.strictEqual(requests.length, 0, 'blocked submissions make no network request');
    await service.sync('anonymous-id');
    assert.ok(requests.every(({ options }) => !options.headers.Authorization),
      'sync GET requests do not receive the ingest credential');
    await service.markRead('notice-id');
    assert.ok(!requests[2].options.headers.Authorization,
      'notice-read endpoint does not receive the ingest credential');
    await service.send({ message: 'hello' });
    assert.strictEqual(requests[3].options.headers.Authorization, 'Bearer test-token',
      'credential is sent to feedback ingestion only');
    assert.strictEqual(requests[3].options.redirect, 'error',
      'authenticated ingestion refuses redirects that could change the credential destination');
  } finally {
    global.fetch = originalFetch;
  }

  const handlers = {};
  const router = {
    get(path, handler) { handlers['GET ' + path] = handler; },
    post(path, handler) { handlers['POST ' + path] = handler; }
  };
  let submitted;
  mountFeedbackRoutes(router, {
    ...service,
    send: async payload => { submitted = payload; return { ok: true }; }
  });
  const res = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; }
  };
  await handlers['POST /api/feedback']({
    body: {
      type: 'bug',
      rating: 5,
      message: 'A report',
      anonymous_id: 'anon',
      locale: 'vi',
      password: 'must-not-forward',
      token: 'must-not-forward',
      cookies: 'must-not-forward',
      history: ['must-not-forward']
    }
  }, res);
  assert.deepStrictEqual(submitted, {
    event: 'feedback',
    type: 'bug',
    rating: 5,
    message: 'A report',
    anonymous_id: 'anon',
    locale: 'vi',
    app_id: 'solohost-browser',
    app_name: 'SoloHost Browser',
    version: 'test'
  }, 'only the documented feedback fields are forwarded');

  console.log('[PASS] feedback credential transport and payload isolation');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
