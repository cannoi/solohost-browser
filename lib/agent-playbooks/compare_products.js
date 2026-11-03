'use strict';
/**
 * Optional acceleration for price/product comparison.
 * Matching is an optimization — non-matching tasks still run via the default LLM planStep loop.
 */
const vnRetail = require('../agent-sources/vn-retail');
const globalRetail = require('../agent-sources/global-retail');

function matchCompareIntent(task) {
  const t = String(task || '').toLowerCase();
  if (/so sánh giá|so sanh gia|compare price|price comparison|best price|giá rẻ nhất|where to buy|nơi nào bán|nơi bán/.test(t)) return true;
  if (/(?:so sánh|so sanh|compare|versus|\bvs\.?\b).{0,80}(?:giá|price|sản phẩm|product|model)/.test(t)) return true;
  if (/(?:giá|price|cost|bao nhiêu tiền).{0,100}(?:rẻ|cheap|retailer|cửa hàng|store|amazon|shopee|lazada|ebay)/.test(t)) return true;
  // Any product-ish + price signal (phones, laptops, appliances, generic)
  if (/(?:iphone|samsung|galaxy|pixel|oppo|xiaomi|macbook|ipad|laptop|tv|tai nghe|headphone|camera|máy|điện thoại|dien thoai|product|sku).{0,80}(?:giá|price|rẻ|cheap)/.test(t)) return true;
  if (/(?:giá|price).{0,60}(?:iphone|samsung|laptop|macbook|ipad|tv|product)/.test(t)) return true;
  return false;
}

function productQuery(task) {
  const s = String(task || '');
  const m = s.match(/(?:iphone|samsung\s*galaxy|galaxy|pixel|oppo|xiaomi|redmi|realme|vivo|macbook|ipad|laptop|headphone|airpods|tv|điện thoại|dien thoai)[^,]{0,60}/i);
  if (m) return m[0].trim();
  // Strip compare verbs for a cleaner query
  return s
    .replace(/so sánh giá|so sanh gia|compare prices?|best price|giá rẻ nhất|where to buy|nơi nào bán/ig, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function isLikelyVn(task) {
  const t = String(task || '').toLowerCase();
  return /việt nam|vietnam|\.vn\b|tgdd|fpt shop|thế giới di động|shopee\.vn|lazada\.vn|điện thoại|triệu|vnd|vnđ/.test(t);
}

function buildChecklist(task, lang) {
  const vn = vnRetail.matchRetailersInText(task);
  const gl = globalRetail.matchGlobalInText(task);
  let sources;
  if (vn.length) sources = vn.map((r) => r.host);
  else if (gl.length) sources = gl.map((r) => r.host);
  else if (isLikelyVn(task)) sources = vnRetail.defaultPhoneRetailers().map((r) => r.host);
  else sources = globalRetail.defaultGlobalRetailers(4).map((r) => r.host);

  return {
    kind: 'compare_products',
    sources,
    product_hint: productQuery(task),
    min_sources_ok: Math.min(3, sources.length),
    citation_required: true,
    output_language: lang === 'vi' ? 'vi' : 'en'
  };
}

function suggestedActions(task) {
  const q = productQuery(task);
  const vn = vnRetail.matchRetailersInText(task);
  const gl = globalRetail.matchGlobalInText(task);
  let list;
  if (vn.length) list = vn;
  else if (gl.length) list = gl;
  else if (isLikelyVn(task)) list = vnRetail.defaultPhoneRetailers();
  else list = globalRetail.defaultGlobalRetailers(4);
  return list.slice(0, 4).map((r) => ({ type: 'navigate', url: r.searchUrl(q) }));
}

module.exports = {
  id: 'compare_products',
  matchCompareIntent,
  match: matchCompareIntent,
  buildChecklist,
  suggestedActions,
  productQuery,
  retail: vnRetail,
  globalRetail
};
