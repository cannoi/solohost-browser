'use strict';
const assert = require('assert');
const { createExecuteAction } = require('../lib/agent-actions');

const fn = createExecuteAction({
  domBridge: {
    navigate: async (s, url) => {
      if (/mckinsey/i.test(url)) {
        return { url: 'chrome-error://chromewebdata/', error: 'net::ERR_HTTP2_PROTOCOL_ERROR', hasContent: false };
      }
      return { url, title: 'OK', hasContent: true, error: null };
    }
  },
  assertSafeUrl: async () => {}
});

(async () => {
  const task = { id: 'navres1', urlStack: [], urlIndex: -1, sourcesStatus: {}, workMemory: {} };
  const bad = await fn(task, {}, { type: 'navigate', url: 'https://www.mckinsey.com/x' }, {});
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.code === 'NAV_CHROME_ERROR' || /chrome_error|ERR_/i.test(bad.result));
  assert.ok(task.sourcesStatus['mckinsey.com'] || Object.keys(task.sourcesStatus).length);

  const good = await fn(task, { url: 'https://example.com' }, { type: 'navigate', url: 'https://example.com/report' }, {});
  assert.strictEqual(good.ok, true);

  console.log('[PASS] agent-nav-resilience');
})().catch((e) => { console.error(e); process.exit(1); });
