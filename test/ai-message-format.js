'use strict';

const assert = require('assert');
const { format, normalizeMessageText } = require('../public/ai-message-format');

const supplied = [
  '📌 Cách giao việc cho Browser Agent',
  '1) Bật AI trong Settings (Provider + API key).',
  '2) Viết việc cần làm bằng tiếng Việt tự nhiên, ví dụ:',
  ' • &quot;Tìm giá iPhone 16 và so sánh 3 cửa hàng&quot;',
  ' • &quot;Mở bản đồ và chỉ đường đến chợ Hàn Đà Nẵng&quot;'
].join('<br>');
const rendered = format(supplied);

assert(rendered.includes('📌 Cách giao việc cho Browser Agent<br>1)'),
  'HTML break separators render as line breaks');
assert(rendered.includes(' • &quot;Tìm giá iPhone 16 và so sánh 3 cửa hàng&quot;'),
  'Vietnamese bullet text and quoted examples remain readable');
assert(!rendered.includes('&lt;br&gt;') && !rendered.includes('&amp;quot;'),
  'presentation markup and entities are not shown literally');

const multiline = format('Một dòng\n- Dòng gạch đầu dòng\nTiếp theo &quot;trích dẫn&quot;');
assert(multiline.includes('Một dòng<br>• Dòng gạch đầu dòng<br>Tiếp theo &quot;trích dẫn&quot;'),
  'plain multiline text, markdown bullets, and escaped quotes format consistently');

const hostile = format('&lt;img src=x onerror=alert(1)&gt;');
assert(hostile.includes('&lt;img src=x onerror=alert(1)&gt;'),
  'encoded untrusted HTML stays text');
assert(!/<img\b/i.test(hostile),
  'untrusted markup cannot create active HTML');
const rawHostile = format('<img src=x onerror=alert(1)>');
assert(rawHostile.includes('&lt;img src=x onerror=alert(1)&gt;') && !/<img\b/i.test(rawHostile),
  'raw untrusted HTML is escaped before it reaches the message DOM');
const unsafeLink = format('[open](javascript:alert(1))');
assert(!/<a\b[^>]*href=["']javascript:/i.test(unsafeLink),
  'unsafe URL schemes are not made clickable');
assert.strictEqual(normalizeMessageText('&amp;quot;'), '&quot;',
  'entity decoding is single-pass');

console.log('[PASS] AI message formatting and safe rendering');
