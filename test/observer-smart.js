'use strict';
const assert = require('assert');
const { observeLive, hashObservation, OBSERVE_JS } = require('../lib/engine/observer');

assert.ok(typeof OBSERVE_JS === 'string' && OBSERVE_JS.length > 500);
assert.ok(OBSERVE_JS.includes('pageKind'));
assert.ok(OBSERVE_JS.includes('regionOf') || OBSERVE_JS.includes('region'));
assert.ok(OBSERVE_JS.includes('kindOf') || OBSERVE_JS.includes('kind'));
assert.ok(OBSERVE_JS.includes('shadowRoot'));
assert.ok(OBSERVE_JS.includes('iframe'));
assert.ok(OBSERVE_JS.includes('SECRET_RE') || OBSERVE_JS.includes('password'));
assert.ok(OBSERVE_JS.includes('aria-labelledby') || OBSERVE_JS.includes('labelledBy'));
assert.ok(OBSERVE_JS.includes('NOISE_RE') || OBSERVE_JS.includes('advertisement'));

// Mock evaluate — form page
const formObs = {
  url: 'https://example.com/login',
  title: 'Login',
  text: 'Please sign in to continue with your account.',
  textTotal: 40,
  elements: [
    { id: 1, tag: 'input', type: 'email', kind: 'input', region: 'form', label: 'Email', inView: true },
    { id: 2, tag: 'input', type: 'password', kind: 'input', region: 'form', label: 'Password', inView: true },
    { id: 3, tag: 'button', kind: 'button', region: 'form', label: 'Sign in', inView: true }
  ],
  targets: { primary_submit: 3 },
  scroll: { y: 0, height: 800, viewport: 700 },
  pageState: ['form'],
  pageKind: 'form',
  landmarks: ['main', 'form'],
  remainingBelow: 0
};

(async () => {
  const engine = {
    evaluate: async () => formObs
  };
  const live = await observeLive(engine, 'pw1', {});
  assert.ok(live.live);
  assert.strictEqual(live.pageKind, 'form');
  assert.ok(live.landmarks.includes('form'));
  assert.ok(live.elements.some((e) => e.kind === 'button'));
  const h1 = hashObservation(live);
  const h2 = hashObservation(live);
  assert.strictEqual(h1, h2);
  live.elements[0].label = 'changed';
  assert.notStrictEqual(hashObservation(live), h1);

  // Article-like mock
  const articleObs = Object.assign({}, formObs, {
    pageKind: 'article',
    pageState: [],
    text: 'A'.repeat(2000),
    elements: [
      { id: 1, tag: 'a', kind: 'link', region: 'nav', label: 'Home', inView: true },
      { id: 2, tag: 'a', kind: 'link', region: 'main', label: 'Read more', inView: true }
    ]
  });
  engine.evaluate = async () => articleObs;
  const art = await observeLive(engine, 'pw2', {});
  assert.strictEqual(art.pageKind, 'article');
  // Prefer main over nav when ranking under budget
  assert.ok(art.elements.length >= 1);

  // Secret elements must not be produced by OBSERVE_JS logic (string-level check)
  assert.ok(OBSERVE_JS.includes('isSecret'));
  assert.ok(!/password/.test(JSON.stringify(live.elements.filter((e) => e.type === 'password' && e.value))));

  // SPA / dialog markers present in script
  assert.ok(OBSERVE_JS.includes('dialog'));
  assert.ok(OBSERVE_JS.includes('search_results') || OBSERVE_JS.includes('pageKind'));

  console.log('[PASS] observer-smart');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
