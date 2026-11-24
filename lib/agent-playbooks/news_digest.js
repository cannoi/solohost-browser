'use strict';
/**
 * Optional multi-source news / reviews digest. Optimization only — not a gate.
 */
const DEFAULT_VN_SOURCES = [
  { name: 'VnExpress', host: 'vnexpress.net', feed: 'https://vnexpress.net/rss/tin-moi-nhat.rss' },
  { name: 'Tuoi Tre', host: 'tuoitre.vn', feed: 'https://tuoitre.vn/rss/tin-moi-nhat.rss' },
  { name: 'Thanh Nien', host: 'thanhnien.vn', feed: 'https://thanhnien.vn/rss/home.rss' },
  { name: 'Dan Tri', host: 'dantri.com.vn', feed: 'https://dantri.com.vn/rss/home.rss' },
  { name: 'VietnamNet', host: 'vietnamnet.vn', feed: 'https://vietnamnet.vn/rss/tin-moi-nhat.rss' }
];

const DEFAULT_EN_SOURCES = [
  { name: 'BBC', host: 'bbc.com', feed: 'https://feeds.bbci.co.uk/news/rss.xml' },
  { name: 'Reuters', host: 'reuters.com', feed: 'https://www.reutersagency.com/feed/' },
  { name: 'The Verge', host: 'theverge.com', feed: 'https://www.theverge.com/rss/index.xml' },
  { name: 'TechCrunch', host: 'techcrunch.com', feed: 'https://techcrunch.com/feed/' }
];

function matchNewsIntent(task) {
  const t = String(task || '').toLowerCase();
  if (/tin t[uứ]c|news digest|24h|24 giờ|bao chi|báo chí|breaking news|headlines/.test(t)) return true;
  if (/vnexpress|tuổi trẻ|tuoi tre|thanh niên|dân trí|vietnamnet/.test(t)) return true;
  if (/(?:tóm tắt|tom tat|summarize|digest|tổng hợp|tong hop).{0,40}(?:tin|news|bài|article|review|đánh giá)/.test(t)) return true;
  if (/(?:đánh giá|danh gia|review).{0,40}(?:nhiều nguồn|multiple|so sánh|compare)/.test(t)) return true;
  if (/(?:multi[- ]?source|nhiều nguồn).{0,30}(?:news|tin|review)/.test(t)) return true;
  return false;
}

function buildChecklist(task, lang) {
  const t = String(task || '').toLowerCase();
  const en = /bbc|reuters|the verge|techcrunch|\ben\b|english|international/.test(t) || lang === 'en';
  const sources = (en && !/vnexpress|tuổi trẻ|việt nam news/.test(t) ? DEFAULT_EN_SOURCES : DEFAULT_VN_SOURCES).map((s) => s.host);
  const isReview = /review|đánh giá|danh gia/.test(t);
  return {
    kind: isReview ? 'reviews_digest' : 'news_digest',
    sources,
    time_window: /24\s*(?:h|hours?|giờ)/i.test(task) ? '24h' : '',
    min_items: isReview ? 4 : 8,
    min_items_per_section: 1,
    sections: isReview
      ? (lang === 'vi' ? ['Ưu điểm', 'Nhược điểm', 'So sánh', 'Kết luận'] : ['Pros', 'Cons', 'Comparison', 'Verdict'])
      : (lang === 'vi' ? ['Chính trị', 'Kinh tế', 'Xã hội', 'Thế giới', 'Công nghệ'] : ['World', 'Business', 'Tech', 'Society']),
    output_language: lang === 'vi' ? 'vi' : 'en',
    citation_required: true
  };
}

function suggestedFirstActions(task, lang) {
  const t = String(task || '').toLowerCase();
  const en = /bbc|reuters|the verge|techcrunch|\ben\b|english/.test(t) || lang === 'en';
  const list = en && !/vnexpress|tuổi trẻ/.test(t) ? DEFAULT_EN_SOURCES : DEFAULT_VN_SOURCES;
  return list.slice(0, 3).map((s) => ({ type: 'fetch_feed', url: s.feed }));
}

module.exports = {
  id: 'news_digest',
  matchNewsIntent,
  match: matchNewsIntent,
  buildChecklist,
  suggestedFirstActions,
  DEFAULT_VN_SOURCES,
  DEFAULT_EN_SOURCES
};
