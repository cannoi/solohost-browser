'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../lib/feedback-module/feedback-service.js'), 'utf8');
assert.ok(src.includes('/api/feedback/sync'), 'sync must call Hub /api/feedback/sync');
assert.ok(!src.includes("'/api/sync'"), 'must not call obsolete /api/sync');
assert.ok(src.includes('/api/notices/'), 'markRead uses /api/notices/:id/read');

const { createFeedbackService } = require('../lib/feedback-module/feedback-service');

async function main() {
  const hits = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    hits.push({
      url: String(url),
      method: (options.method || 'GET').toUpperCase(),
      headers: options.headers || {}
    });
    return { ok: true, status: 200, json: async () => ({ ok: true, notices: [], donate: {} }) };
  };
  try {
    const svc = createFeedbackService({
      baseUrl: 'http://14.176.78.46:8090',
      ingestToken: 'test-token'
    });
    await svc.sync('anon-1');
    assert.ok(hits.some((h) => h.url.includes('/api/feedback/sync') && h.method === 'GET'), 'sync path');
    assert.ok(
      hits.filter((h) => h.url.includes('/api/feedback/sync')).every((h) => !h.headers.Authorization),
      'sync without bearer'
    );
    hits.length = 0;
    await svc.markRead('NT-1');
    assert.ok(hits.some((h) => /\/api\/notices\/NT-1\/read$/.test(h.url)), 'notice read path');
    hits.length = 0;
    await svc.send({ message: 'hi', anonymous_id: 'a' });
    const post = hits.find((h) => h.method === 'POST' && /\/api\/feedback$/.test(h.url));
    assert.ok(post, 'ingest post');
    assert.strictEqual(post.headers.Authorization, 'Bearer test-token');
    console.log('[PASS] feedback-hub-paths');
  } finally {
    global.fetch = originalFetch;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
