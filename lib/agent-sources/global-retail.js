'use strict';
/**
 * Lightweight retailer/search seeds for product comparison (optional playbook acceleration).
 * Not a closed allow-list — LLM loop may open any http(s) source via SSRF-safe tools.
 */
const GLOBAL = [
  { id: 'amazon', name: 'Amazon', host: 'amazon.com', searchUrl: (q) => 'https://www.amazon.com/s?k=' + encodeURIComponent(q) },
  { id: 'ebay', name: 'eBay', host: 'ebay.com', searchUrl: (q) => 'https://www.ebay.com/sch/i.html?_nkw=' + encodeURIComponent(q) },
  { id: 'walmart', name: 'Walmart', host: 'walmart.com', searchUrl: (q) => 'https://www.walmart.com/search?q=' + encodeURIComponent(q) },
  { id: 'bestbuy', name: 'Best Buy', host: 'bestbuy.com', searchUrl: (q) => 'https://www.bestbuy.com/site/searchpage.jsp?st=' + encodeURIComponent(q) },
  { id: 'aliexpress', name: 'AliExpress', host: 'aliexpress.com', searchUrl: (q) => 'https://www.aliexpress.com/wholesale?SearchText=' + encodeURIComponent(q) },
  { id: 'shopee', name: 'Shopee', host: 'shopee.vn', searchUrl: (q) => 'https://shopee.vn/search?keyword=' + encodeURIComponent(q) },
  { id: 'lazada', name: 'Lazada', host: 'lazada.vn', searchUrl: (q) => 'https://www.lazada.vn/catalog/?q=' + encodeURIComponent(q) },
  { id: 'google_shopping', name: 'Google Shopping', host: 'google.com', searchUrl: (q) => 'https://www.google.com/search?tbm=shop&q=' + encodeURIComponent(q) }
];

function matchGlobalInText(text) {
  const t = String(text || '').toLowerCase();
  return GLOBAL.filter((r) => t.includes(r.id) || t.includes(r.host.split('.')[0]) || t.includes(r.name.toLowerCase()));
}

function defaultGlobalRetailers(limit) {
  return GLOBAL.slice(0, Math.max(2, Math.min(6, limit || 4)));
}

module.exports = { GLOBAL, matchGlobalInText, defaultGlobalRetailers };
