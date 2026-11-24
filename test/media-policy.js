'use strict';
const assert = require('assert');

const blocked = require('../lib/media/blocked-hosts');
const sniffer = require('../lib/media/media-sniffer');

assert.strictEqual(blocked.isBlockedHost('https://www.youtube.com/watch?v=abc'), true);
assert.strictEqual(blocked.isBlockedHost('https://youtu.be/abc'), true);
assert.strictEqual(blocked.isBlockedHost('https://googlevideo.com/video'), true);
assert.strictEqual(blocked.isBlockedHost('https://example.com/video.mp4'), false);

assert.strictEqual(sniffer.looksLikeMedia('https://cdn.example.com/a.mp4', 'video/mp4').media, true);
assert.strictEqual(sniffer.looksLikeMedia('https://cdn.example.com/a.txt', 'text/plain').media, false);
assert.strictEqual(sniffer.detectDrmHints('x', {}, '#EXT-X-KEY:METHOD=AES-128,URI="k"'), true);
assert.strictEqual(sniffer.detectDrmHints('x', {}, '#EXT-X-KEY:METHOD=NONE'), false);

console.log('media-policy: PASS');
