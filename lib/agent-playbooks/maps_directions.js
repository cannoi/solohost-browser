'use strict';
/**
 * Optional maps / directions acceleration (OpenStreetMap / Google Maps search URLs).
 */
function matchMapsIntent(task) {
  const t = String(task || '').toLowerCase();
  if (/(?:chỉ đường|chi duong|directions?|đường đi|duong di|route to|how to get to)/.test(t)) return true;
  if (/(?:bản đồ|ban do|on (?:the )?map|google maps|openstreetmap|\bosm\b)/.test(t)) return true;
  if (/(?:ở đâu|o dau|where is|locate|tìm địa chỉ|tim dia chi).{0,40}(?:gần|near|tại|in|at)/.test(t)) return true;
  return false;
}

function extractPlace(task) {
  const s = String(task || '');
  const m = s.match(/(?:chỉ đường|chi duong|directions?|đến|den|to|tới|toi|ở|o|at|near)\s+(.+)$/i);
  if (m) return m[1].replace(/[?.!].*$/, '').trim().slice(0, 120);
  return s.replace(/bản đồ|ban do|google maps|chỉ đường|directions?/ig, '').trim().slice(0, 120);
}

function buildChecklist(task, lang) {
  return {
    kind: 'maps_directions',
    place_hint: extractPlace(task),
    citation_required: true,
    output_language: lang === 'vi' ? 'vi' : 'en'
  };
}

function suggestedActions(task) {
  const place = extractPlace(task) || String(task || '').slice(0, 80);
  const q = encodeURIComponent(place);
  return [
    { type: 'navigate', url: 'https://www.openstreetmap.org/search?query=' + q },
    { type: 'navigate', url: 'https://www.google.com/maps/search/' + q }
  ].slice(0, 1);
}

module.exports = {
  id: 'maps_directions',
  matchMapsIntent,
  match: matchMapsIntent,
  buildChecklist,
  suggestedActions,
  extractPlace
};
