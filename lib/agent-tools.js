'use strict';
/**
 * Standardized Agent tool set — single source of truth (V11 Phase 3).
 * 13 original tools kept; new tools added for practical browsing.
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
  'fail',
  // Phase 3 extensions
  'tabs',
  'screenshot',
  'press_key',
  'select',
  'hover',
  'wait_for',
  'extract_table',
  'extract_form',
  'handle_dialog',
  'save_file'
];

/** Map legacy / verbose action names → core */
const ALIASES = {
  read: 'extract',
  extract_page: 'extract',
  extract_articles: 'extract',
  read_article: 'navigate',
  fetch_doc: 'navigate',
  fetch_feed: 'navigate',
  open_many: 'navigate',
  press: 'press_key',
  forward: 'wait',
  tab_list: 'tabs',
  tab_new: 'tabs',
  tab_switch: 'tabs',
  tab_close: 'tabs'
};

/** Risk class: read | write | sensitive */
const RISK = {
  search: 'read',
  navigate: 'read',
  click: 'write',
  type: 'write',
  scroll: 'read',
  extract: 'read',
  note: 'read',
  recall: 'read',
  wait: 'read',
  back: 'read',
  ask_user: 'read',
  done: 'read',
  fail: 'read',
  tabs: 'read',
  screenshot: 'read',
  press_key: 'write',
  select: 'write',
  hover: 'read',
  wait_for: 'read',
  extract_table: 'read',
  extract_form: 'read',
  handle_dialog: 'write',
  save_file: 'write'
};

function coreList() {
  return CORE.slice();
}

function isCore(type) {
  return CORE.includes(String(type || '').toLowerCase());
}

function riskOf(type) {
  return RISK[String(type || '').toLowerCase()] || 'write';
}

/**
 * Normalize one action into the core toolkit.
 * Returns { type, risk, ...fields } or null if invalid.
 */
function normalizeToolAction(raw) {
  if (!raw || typeof raw !== 'object') return null;
  let type = String(raw.type || '').toLowerCase().trim();
  if (!type) return null;
  if (ALIASES[type]) type = ALIASES[type];
  if (!isCore(type)) return null;

  const out = { type, risk: riskOf(type) };
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
      if (raw.role) out.role = String(raw.role).slice(0, 40);
      if (raw.name) out.name = String(raw.name).slice(0, 120);
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
      if (raw.id) out.id = String(raw.id).slice(0, 64);
      break;
    case 'wait':
      out.ms = Math.min(30000, Math.max(0, Number(raw.ms) || 1000));
      break;
    case 'ask_user':
      out.question = String(raw.question || raw.text || '').slice(0, 1000);
      if (Array.isArray(raw.choices)) out.choices = raw.choices.slice(0, 4).map((c) => String(c).slice(0, 80));
      break;
    case 'done':
      out.summary = String(raw.summary || raw.text || '').slice(0, 12000);
      break;
    case 'fail':
      out.reason = String(raw.reason || raw.text || '').slice(0, 1000);
      break;
    case 'tabs':
      out.op = String(raw.op || raw.action || 'list').toLowerCase();
      if (!['list', 'new', 'switch', 'close'].includes(out.op)) out.op = 'list';
      if (raw.tabId != null) out.tabId = String(raw.tabId).slice(0, 64);
      if (raw.url) out.url = String(raw.url).slice(0, 2000);
      break;
    case 'screenshot':
      out.fullPage = !!raw.fullPage;
      break;
    case 'press_key':
      out.key = String(raw.key || raw.text || 'Enter').slice(0, 40);
      if (raw.id != null) out.id = Number(raw.id);
      break;
    case 'select':
      out.id = raw.id != null ? Number(raw.id) : undefined;
      out.value = String(raw.value || raw.text || raw.label || '').slice(0, 500);
      if (raw.label) out.label = String(raw.label).slice(0, 200);
      break;
    case 'hover':
      out.id = Number(raw.id);
      break;
    case 'wait_for':
      out.condition = String(raw.condition || raw.for || 'selector').toLowerCase();
      out.text = String(raw.text || '').slice(0, 500);
      out.selector = String(raw.selector || '').slice(0, 300);
      out.url = String(raw.url || '').slice(0, 2000);
      out.timeoutMs = Math.min(30000, Math.max(500, Number(raw.timeoutMs || raw.ms) || 8000));
      break;
    case 'extract_table':
      out.index = Math.max(0, Number(raw.index) || 0);
      break;
    case 'extract_form':
      out.index = Math.max(0, Number(raw.index) || 0);
      break;
    case 'handle_dialog':
      out.accept = raw.accept !== false;
      out.promptText = String(raw.promptText || raw.text || '').slice(0, 500);
      break;
    case 'save_file':
      out.filename = String(raw.filename || raw.name || 'agent-output.txt').replace(/[^\w.\-]+/g, '_').slice(0, 120);
      out.content = String(raw.content || raw.text || '').slice(0, 200000);
      out.format = String(raw.format || 'txt').toLowerCase();
      break;
    default:
      break;
  }
  return out;
}

function toolsPromptBlock() {
  return [
    'TOOLS (use only these types):',
    'search, navigate, click, type, scroll, extract, note, recall, wait, back, ask_user, done, fail,',
    'tabs (op: list|new|switch|close), screenshot, press_key, select, hover, wait_for,',
    'extract_table, extract_form, handle_dialog, save_file.',
    'Sensitive actions (payment, delete, share, password fields) require user confirmation.',
    'Never type passwords, OTP, or card numbers.'
  ].join(' ');
}

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
    { type: 'function', function: { name: 'fail', description: 'Abort', parameters: { type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] } } },
    { type: 'function', function: { name: 'tabs', description: 'List/new/switch/close tabs', parameters: { type: 'object', properties: { op: { type: 'string' }, tabId: { type: 'string' }, url: { type: 'string' } } } } },
    { type: 'function', function: { name: 'screenshot', description: 'Capture page screenshot for vision', parameters: { type: 'object', properties: { fullPage: { type: 'boolean' } } } } },
    { type: 'function', function: { name: 'press_key', description: 'Press a key (Enter, Tab, Escape, …)', parameters: { type: 'object', properties: { key: { type: 'string' }, id: { type: 'number' } }, required: ['key'] } } },
    { type: 'function', function: { name: 'select', description: 'Select dropdown option', parameters: { type: 'object', properties: { id: { type: 'number' }, value: { type: 'string' }, label: { type: 'string' } }, required: ['value'] } } },
    { type: 'function', function: { name: 'hover', description: 'Hover element id', parameters: { type: 'object', properties: { id: { type: 'number' } }, required: ['id'] } } },
    { type: 'function', function: { name: 'wait_for', description: 'Wait for text, selector, or URL', parameters: { type: 'object', properties: { condition: { type: 'string' }, text: { type: 'string' }, selector: { type: 'string' }, url: { type: 'string' }, timeoutMs: { type: 'number' } } } } },
    { type: 'function', function: { name: 'extract_table', description: 'Extract HTML table as structured rows', parameters: { type: 'object', properties: { index: { type: 'number' } } } } },
    { type: 'function', function: { name: 'extract_form', description: 'Extract form fields as structured JSON', parameters: { type: 'object', properties: { index: { type: 'number' } } } } },
    { type: 'function', function: { name: 'handle_dialog', description: 'Accept or dismiss JS dialog', parameters: { type: 'object', properties: { accept: { type: 'boolean' }, promptText: { type: 'string' } } } } },
    { type: 'function', function: { name: 'save_file', description: 'Save text/CSV/MD result to downloads', parameters: { type: 'object', properties: { filename: { type: 'string' }, content: { type: 'string' }, format: { type: 'string' } }, required: ['content'] } } }
  ];
}

module.exports = {
  CORE,
  ALIASES,
  RISK,
  coreList,
  isCore,
  riskOf,
  normalizeToolAction,
  toolsPromptBlock,
  functionTools
};
