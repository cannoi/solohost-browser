'use strict';

const assert = require('assert');
const pkg = require('../package.json');
const adapter = require('../lib/app-adapter');
const { getKnowledgeConfig, DEFAULTS } = require('../lib/feedback-module/feedback-service');

const envKeys = ['SHFH_HUB_ID', 'SHFH_HUB_URL', 'SHFH_INGEST_TOKEN'];
const originalEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));

try {
  for (const key of envKeys) delete process.env[key];
  const defaults = adapter.buildKnowledge();
  assert(defaults.includes('APP NAME: SoloHost Browser (v' + pkg.version + ')'),
    'kernel knowledge version follows package metadata');
  assert(defaults.includes('SHFH-CANNOI-0905428801'),
    'kernel knowledge includes the actual Feedback Hub ID');
  assert(defaults.includes('http://14.176.78.46:8090'),
    'kernel knowledge includes the public default Hub URL');
  assert(defaults.includes('ENABLED') || defaults.includes('enabled'),
    'kernel knowledge reports preconfigured ingestion as enabled');
  assert(
    defaults.includes('never ask') || defaults.includes('Never ask') || defaults.includes('Ordinary users only write'),
    'kernel instructions do not ask app users for Hub credentials'
  );
  assert(defaults.includes('LANGUAGE RULE:') || /Reply in the user language/i.test(defaults),
    'core language guidance is present');
  assert(defaults.length <= 5000,
    'kernel knowledge fits within AI service app-knowledge limit');
  assert(!defaults.includes(DEFAULTS.ingestToken),
    'bundled ingest token is never serialized into model knowledge');
  assert.strictEqual(getKnowledgeConfig().ingestEnabled, true);

  const secretMarker = 'test-secret-never-return-this';
  process.env.SHFH_INGEST_TOKEN = secretMarker;
  process.env.SHFH_HUB_ID = 'SHFH-TEST';
  process.env.SHFH_HUB_URL = 'http://hub.example/path?token=do-not-expose';
  const httpKnowledge = adapter.buildKnowledge();
  assert(httpKnowledge.includes('SHFH-TEST') && httpKnowledge.includes('http://hub.example/path'),
    'knowledge follows server Hub configuration and sanitizes its URL');
  assert(/disabled|HTTPS|allowed private/i.test(httpKnowledge),
    'public HTTP hub is not treated as fully open without policy');
  assert(!httpKnowledge.includes(secretMarker) && !httpKnowledge.includes('do-not-expose'),
    'knowledge does not reveal tokens or URL query parameters');
  assert.strictEqual(getKnowledgeConfig().ingestEnabled, false);

  process.env.SHFH_HUB_URL = 'https://hub.example/api';
  const httpsKnowledge = adapter.buildKnowledge();
  assert(/ENABLED|enabled/i.test(httpsKnowledge),
    'HTTPS plus token is described as enabled');
  assert(!httpsKnowledge.includes(secretMarker),
    'configured server token is never serialized into model knowledge');
  assert.strictEqual(getKnowledgeConfig().ingestEnabled, true);

  const localAnswer = adapter.localReply('Thông tin Feedback Hub', { lang: 'vi' });
  assert(localAnswer.includes('SHFH-TEST') && localAnswer.includes('https://hub.example/api'),
    'offline assistant answers Hub questions from current server configuration');
  assert(/không cần nhập|không nhập token/i.test(localAnswer) && !localAnswer.includes(secretMarker),
    'offline assistant directs users away from entering credentials');
} finally {
  for (const key of envKeys) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
}

console.log('[PASS] AI Kernel current product and Feedback Hub knowledge');
