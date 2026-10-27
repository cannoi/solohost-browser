'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sh-proxy-'));
process.env.SOLOHOST_DATA_DIR = tmp;
process.env.SOLOHOST_ALLOW_PRIVATE_PROXY = '1';

const { validateProtocol, validatePort, isPrivateIp } = require('../lib/proxy/proxy-validator');
const { normalizeEntry, redactEntry, toPlaywrightProxy, redactErrorMessage } = require('../lib/proxy/proxy-config');
const proxyManager = require('../lib/proxy/proxy-manager');

function pass(name) { console.log('  PASS', name); }

assert.strictEqual(validateProtocol('socks5'), 'socks5');
assert.throws(() => validateProtocol('ftp'), /Protocol/);
assert.strictEqual(validatePort(8080), 8080);
assert.throws(() => validatePort(0), /port/i);
assert.ok(isPrivateIp('10.0.0.1'));
assert.ok(!isPrivateIp('8.8.8.8'));
pass('validator basics');

const entry = normalizeEntry({ name: 'Test', protocol: 'http', host: '127.0.0.1', port: 18080, username: 'user', password: 'secret-pass', location: 'Lab' });
assert.ok(entry.id.startsWith('px_'));
assert.strictEqual(entry.password, 'secret-pass');
const red = redactEntry(entry);
assert.ok(!JSON.stringify(red).includes('secret-pass'));
assert.strictEqual(red.hasPassword, true);
const pw = toPlaywrightProxy(entry);
assert.strictEqual(pw.server, 'http://127.0.0.1:18080');
assert.ok(redactErrorMessage('password=secret-pass').includes('***'));
pass('config redact + playwright shape');

proxyManager.reload();
(async () => {
  const saved = await proxyManager.upsertEntry({ name: 'Local', protocol: 'http', host: '127.0.0.1', port: 18080, username: 'u', password: 'p', location: 'Local' });
  assert.ok(saved.id);
  const st = proxyManager.publicState();
  assert.ok(Array.isArray(st.entries));
  assert.ok(st.entries.every(e => !e.password));
  pass('manager upsert + public redaction');

  proxyManager.selectActive(saved.id);
  // Simulate connected without live proxy
  const storePath = path.join(tmp, 'proxy-config.json');
  const disk1 = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  disk1.enabled = true; disk1.mode = 'proxy'; disk1.activeId = saved.id;
  fs.writeFileSync(storePath, JSON.stringify(disk1));
  proxyManager.reload();
  proxyManager.setProfileProxy('profile-a', { mode: 'proxy', proxyId: saved.id });
  proxyManager.setProfileProxy('profile-b', { mode: 'direct' });
  assert.ok(proxyManager.resolveForProfile('profile-a'));
  assert.strictEqual(proxyManager.resolveForProfile('profile-b'), null);
  assert.ok(proxyManager.getPlaywrightProxyOption('profile-a'));
  assert.strictEqual(proxyManager.getPlaywrightProxyOption('profile-b'), undefined);
  pass('profile isolation assignment');

  const bad = await proxyManager.testEntry({ protocol: 'http', host: '127.0.0.1', port: 1 });
  assert.strictEqual(bad.ok, false);
  assert.ok(bad.errorCode);
  pass('invalid/unavailable proxy test');

  const disc = await proxyManager.disconnect();
  assert.strictEqual(disc.mode, 'direct');
  assert.strictEqual(disc.enabled, false);
  pass('disconnect → direct');

  let blocked = false;
  try { await proxyManager.upsertEntry({ protocol: 'http', host: 'metadata.google.internal', port: 80 }); } catch (_) { blocked = true; }
  assert.ok(blocked);
  pass('metadata host blocked');

  const disk2 = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.ok(disk2.entries.some(e => e.password));
  const pub = proxyManager.publicState();
  assert.ok(!JSON.stringify(pub).includes('secret-pass'));
  pass('disk may hold secrets; API view redacts');

  const id = saved.id;
  proxyManager.reload();
  assert.ok(proxyManager.publicState().entries.some(e => e.id === id));
  pass('browser restart recovery (reload store)');

  console.log('proxy-manager tests PASSED');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
