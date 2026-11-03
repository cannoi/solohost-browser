'use strict';
/**
 * Standardized Agent tool set — single source of truth.
 * Keep the surface small so the planner chooses correctly and runs faster.
 */

const CORE = [
  'search',
  'navigate',
  'click',
  'type',
  'scroll',
  'extract',
  'note',
  'recall',
  'wait',
  'back',
  'ask_user',
  'done',
  'fail'
];

/** Map legacy / verbose action names → core */
const ALIASES = {
  read: 'extract',
  extract_page: 'extract',
  extract_articles: 'extract',
  read_article: 'navigate', // open page first; next step extract
  fetch_doc: 'navigate',
  fetch_feed: 'navigate',
  open_many: 'navigate', // first URL only at normalize; rest left as note for planner
  press: 'type',
  press_key: 'type',
  select: 'type',
  forward: 'wait'
};

function coreList() {
  return CORE.slice();
}

function isCore(type) {
  return CORE.includes(String(type || '').toLowerCase());
}

/**
 * Normalize one action into the core toolkit.
 * Returns { type, ...fields } or null if invalid.
 */
function normalizeToolAction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let type = String(raw.type || '').toLowerCase().trim();
  if (!type) return null;
  if (ALIASES[type]) type = ALIASES[type];
  if (!isCore(type) && type !== 'navigate') {
    // unknown → reject (executor returns ok:false)
    return null;
  }

  const out = { type };
  switch (type) {
    case 'search':
      out.query = String(raw.query || raw.text || '').trim().slice(0, 500);
      out.engine = String(raw.engine || 'bing').toLowerCase();
      if (!['bing', 'ddg', 'brave', 'google', 'youtube'].includes(out.engine)) out.engine = 'bing';
      break;
    case 'navigate': {
      let url = String(raw.url || '').trim();
      if (!url && Array.isArray(raw.urls) && raw.urls[0]) url = String(raw.urls[0]).trim();
      out.url = url.slice(0, 2000);
      break;
    }
    case 'click':
      out.id = Number(raw.id);
      break;
    case 'type':
      out.id = raw.id != null ? Number(raw.id) : undefined;
      out.text = String(raw.text || raw.value || '').slice(0, 8000);
      out.submit = !!(raw.submit || raw.press_enter);
      if (raw.key) out.key = String(raw.key).slice(0, 40);
      break;
    case 'scroll':
      out.direction = String(raw.direction || 'down').toLowerCase();
      break;
    case 'extract':
      out.offset = Number(raw.offset) || 0;
      if (raw.url) out.url = String(raw.url).slice(0, 2000);
      break;
    case 'note':
      out.text = String(raw.text || raw.message || '').slice(0, 4000);
      break;
    case 'recall':
      out.query = String(raw.query || '').slice(0, 200);
      if (raw.id != null) out.id = String(raw.id);
      if (raw.url) out.url = String(raw.url).slice(0, 500);
      break;
    case 'wait':
      out.ms = Math.min(15000, Math.max(0, Number(raw.ms) || 800));
      break;
    case 'ask_user':
      out.question = String(raw.question || raw.text || '').slice(0, 500);
      break;
    case 'done':
      out.summary = String(raw.summary || raw.message || raw.text || '').slice(0, 100000);
      break;
    case 'fail':
      out.reason = String(raw.reason || raw.text || '').slice(0, 500);
      break;
    default:
      break;
  }
  if (raw._normalizedFrom) out._normalizedFrom = raw._normalizedFrom;
  return out;
}

function toolsPromptBlock() {
  return [
    '=== TOOLS (use ONLY these) ===',
    '1. search   { "type":"search", "query":"...", "engine":"bing|ddg|brave" }',
    '   → Find sources. After results, open the best URL (navigate), do not re-search the same query.',
    '2. navigate { "type":"navigate", "url":"https://..." }',
    '   → Open one page. Prefer authoritative domains for research.',
    '3. extract  { "type":"extract" }',
    '   → Read the current page into evidence (use after navigate).',
    '4. click    { "type":"click", "id":N }',
    '5. type     { "type":"type", "id":N, "text":"...", "submit":true|false }',
    '6. scroll   { "type":"scroll", "direction":"down|up|top|bottom" }',
    '7. note     { "type":"note", "text":"..." }  → save a finding',
    '8. recall   { "type":"recall", "query":"..." } → prior evidence in this task',
    '9. wait     { "type":"wait", "ms":800 }',
    '10. back    { "type":"back" }',
    '11. ask_user { "type":"ask_user", "question":"..." }  → only if truly blocked',
    '12. done    { "type":"done", "summary":"..." }  → full user-facing answer',
    '13. fail    { "type":"fail", "reason":"..." }',
    '',
    'Legacy names are auto-mapped to these tools (e.g. read→extract, fetch_doc→navigate).',
    'Prefer the 13 tools above. One primary action per step.'
  ].join('\n');
}

/** Compact OpenAI-style tools list for providers that support function calling */
function functionTools() {
  return [
    { type: 'function', function: { name: 'search', description: 'Web search', parameters: { type: 'object', properties: { query: { type: 'string' }, engine: { type: 'string' } }, required: ['query'] } } },
    { type: 'function', function: { name: 'navigate', description: 'Open URL', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } } },
    { type: 'function', function: { name: 'extract', description: 'Read current page into evidence', parameters: { type: 'object', properties: { offset: { type: 'number' } } } } },
    { type: 'function', function: { name: 'click', description: 'Click element id', parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } } },
    { type: 'function', function: { name: 'type', description: 'Type into element', parameters: { type: 'object', properties: { id: { type: 'number' }, text: { type: 'string' }, submit: { type: 'boolean' } }, required: ['text'] } } },
    { type: 'function', function: { name: 'scroll', description: 'Scroll page', parameters: { type: 'object', properties: { direction: { type: 'string' } } } } },
    { type: 'function', function: { name: 'note', description: 'Save finding', parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } } },
    { type: 'function', function: { name: 'recall', description: 'Recall evidence', parameters: { type: 'object', properties: { query: { type: 'string' }, id: { type: 'string' } } } } },
    { type: 'function', function: { name: 'wait', description: 'Wait', parameters: { type: 'object', properties: { ms: { type: 'number' } } } } },
    { type: 'function', function: { name: 'back', description: 'History back', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'ask_user', description: 'Ask user', parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } } },
    { type: 'function', function: { name: 'done', description: 'Finish with full summary', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } } },
    { type: 'function', function: { name: 'fail', description: 'Abort', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } } }
  ];
}

module.exports = {
  CORE,
  ALIASES,
  coreList,
  isCore,
  normalizeToolAction,
  toolsPromptBlock,
  functionTools
};
