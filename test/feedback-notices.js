'use strict';
const assert = require('assert');
const { createFeedbackService } = require('../lib/feedback-module/feedback-service');

async function main() {
  const hits = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options = {}) => {
    const u = String(url);
    hits.push({ url: u, method: (options.method || 'GET').toUpperCase() });
    if (u.includes('/api/feedback/sync')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          policy: { donate: { mb_account: '0905428801' } },
          notices: [],
          donate: { mb_account: '0905428801' }
        })
      };
    }
    if (u.includes('/api/notices')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          items: [
            { id: 'NT-1', title: 'Thanks', body: 'Hello', read: false, anonymous_id: 'a' },
            { id: 'NT-2', title: 'Old', body: 'x', read: true },
            { id: 'NT-3', title: 'Broadcast', body: 'update', read: false, anonymous_id: '' }
          ]
        })
      };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  try {
    const svc = createFeedbackService({
      baseUrl: 'http://14.176.78.46:8090',
      ingestToken: 'test'
    });
    const out = await svc.sync('anon-xyz');
    assert.ok(hits.some((h) => h.url.includes('/api/feedback/sync')));
    assert.ok(hits.some((h) => h.url.includes('/api/notices')));
    assert.strictEqual(out.notices.length, 2, 'unread only');
    assert.ok(out.notices.find((n) => n.id === 'NT-1'));
    assert.ok(out.notices.find((n) => n.id === 'NT-3'));
    assert.ok(!out.notices.find((n) => n.id === 'NT-2'));
    assert.strictEqual(out.donate.mb_account, '0905428801');
    console.log('[PASS] feedback-notices');
  } finally {
    global.fetch = originalFetch;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
