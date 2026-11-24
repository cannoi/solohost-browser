'use strict';
const assert = require('assert');
const {
  createFeedbackService,
  mountFeedbackRoutes,
  DEFAULTS,
  getKnowledgeConfig,
  isAllowedHubTransport
} = require('../lib/feedback-module/feedback-service');

async function main() {
  assert.strictEqual(DEFAULTS.hubId, 'SHFH-CANNOI-0905428801');
  assert.ok(DEFAULTS.baseUrl.includes('14.176.78.46'));
  assert.ok(DEFAULTS.ingestToken && DEFAULTS.ingestToken.length > 8, 'token is bundled server-side');

  assert.ok(isAllowedHubTransport('http://14.176.78.46:8090'));
  assert.ok(isAllowedHubTransport('https://hub.example.com'));
  assert.ok(isAllowedHubTransport('http://127.0.0.1:8090'));
  assert.ok(!isAllowedHubTransport('http://example.com')); // public HTTP blocked

  const kc = getKnowledgeConfig();
  assert.strictEqual(kc.hubId, 'SHFH-CANNOI-0905428801');
  assert.ok(kc.ingestEnabled, 'default build has ingestion enabled');

  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, items: [] })
    };
  };

  try {
    const missing = createFeedbackService({ baseUrl: 'https://hub.example', ingestToken: '' });
    await assert.rejects(missing.send({ message: 'hello' }), /not configured/);

    const publicHttp = createFeedbackService({
      baseUrl: 'http://example.com',
      ingestToken: 'test-token'
    });
    await assert.rejects(
      publicHttp.send({ message: 'hello' }),
      /requires HTTPS|allowed private/,
      'public HTTP endpoints stay blocked'
    );

    const privateHttp = createFeedbackService({
      baseUrl: 'http://14.176.78.46:8090',
      ingestToken: 'test-token'
    });
    await privateHttp.send({ message: 'hello' });
    assert.ok(requests.some((r) => /\/api\/feedback$/.test(r.url)));
    const ingest = requests.find((r) => /\/api\/feedback$/.test(r.url));
    assert.strictEqual(ingest.options.headers.Authorization, 'Bearer test-token');
    assert.strictEqual(ingest.options.redirect, 'error');

    requests.length = 0;
    const service = createFeedbackService({
      baseUrl: 'https://hub.example',
      ingestToken: 'test-token',
      appId: 'solohost-browser',
      appName: 'SoloHost Browser',
      version: 'test'
    });
    await service.sync('anonymous-id');
    const syncReqs = requests.filter((r) => /\/api\/(feedback\/sync|notices)/.test(r.url));
    assert.ok(syncReqs.length >= 1, 'sync hits hub endpoints');
    assert.ok(syncReqs.every(({ options }) => !options.headers.Authorization),
      'sync GET does not receive ingest credential');
    requests.length = 0;
    await service.markRead('notice-id');
    assert.ok(requests.every(({ options }) => !options.headers.Authorization),
      'notice-read does not receive ingest credential');
    requests.length = 0;
    await service.send({ message: 'hello' });
    const post = requests.find((r) => (r.options.method || 'GET').toUpperCase() === 'POST' && /\/api\/feedback$/.test(r.url));
    assert.ok(post, 'ingest POST present');
    assert.strictEqual(post.options.headers.Authorization, 'Bearer test-token');

    const handlers = {};
    const router = {
      get(path, handler) { handlers['GET ' + path] = handler; },
      post(path, handler) { handlers['POST ' + path] = handler; }
    };
    let submitted;
    mountFeedbackRoutes(router, {
      ...service,
      publicConfig: () => service.publicConfig(),
      send: async (payload) => { submitted = payload; return { ok: true }; }
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
      locale: 'vi'
    }, 'only documented feedback fields are forwarded');

    // publicConfig must not leak token
    const pub = service.publicConfig();
    assert.ok(pub.enabled);
    assert.ok(!JSON.stringify(pub).includes('test-token'));
    assert.ok(!JSON.stringify(pub).includes(DEFAULTS.ingestToken));
  } finally {
    global.fetch = originalFetch;
  }

  console.log('[PASS] feedback credential transport and private-HTTP Hub policy');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
