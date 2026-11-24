'use strict';
/**
 * Phase 4 — Understand request before acting.
 * Primary path: deterministic structured parse (always works offline).
 * Optional: one AI call when AGENT_INTENT_LLM=1 and a chat function is provided.
 * Always falls back to regex intent + task-analyzer.
 */

const agentIntent = require('./agent-intent');
const taskAnalyzer = require('./agent-task-analyzer');

const CONFIDENCE_ASK = 0.55;
const MAX_ASK_ROUNDS = 2;

function detectLanguage(text) {
  const t = String(text || '');
  if (/[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i.test(t)) return 'vi';
  if (/\b(tìm|mở|so sánh|giá|tin tức|tóm tắt|hãy|cho tôi)\b/i.test(t)) return 'vi';
  return 'en';
}

function extractEntities(text) {
  const t = String(text || '');
  const entities = {
    site: '',
    query: '',
    items: [],
    time: '',
    price: '',
    city: '',
    url: ''
  };
  const urlM = t.match(/https?:\/\/[^\s)\]>]+/i);
  if (urlM) entities.url = urlM[0].replace(/[.,;]+$/, '');
  const siteM = t.match(/\b(youtube|google|facebook|shopee|lazada|tiki|amazon|maps|github|bing)\b/i);
  if (siteM) entities.site = siteM[1].toLowerCase();
  if (/\b(24\s*h|hôm nay|today|this week|tuần này)\b/i.test(t)) entities.time = /24/.test(t) ? '24h' : 'today';
  const priceM = t.match(/(?:dưới|under|below|max|tối đa)\s*([$\d.,]+)\s*(k|nghìn|triệu|million|usd|vnd)?/i);
  if (priceM) entities.price = priceM[0];
  const cityM = t.match(/\b(hà nội|ha noi|hồ chí minh|ho chi minh|sài gòn|saigon|đà nẵng|da nang|hải phòng)\b/i);
  if (cityM) entities.city = cityM[1];
  // rough query: strip leading verbs
  entities.query = t
    .replace(/^(?:hãy|vui lòng|please|help me|cho tôi|tìm giúp)\s+/i, '')
    .slice(0, 300);
  return entities;
}

function buildPlanOutline(kind, entities, lang) {
  const vi = lang === 'vi';
  if (kind === 'compare') {
    return vi
      ? ['Tìm sản phẩm trên vài nguồn', 'Đọc giá / thông tin', 'So sánh và tóm tắt']
      : ['Search products on a few sources', 'Read prices / details', 'Compare and summarize'];
  }
  if (kind === 'news') {
    return vi
      ? ['Tìm tin theo chủ đề', 'Đọc vài bài chính', 'Tóm tắt các điểm']
      : ['Search recent news', 'Read top articles', 'Summarize key points'];
  }
  if (kind === 'maps') {
    return vi
      ? ['Mở bản đồ / tìm địa điểm', 'Lấy chỉ đường hoặc thông tin']
      : ['Open maps / find place', 'Get directions or details'];
  }
  if (kind === 'form') {
    return vi
      ? ['Mở trang form', 'Điền các ô không nhạy cảm', 'Dừng lại để bạn xác nhận trước khi gửi']
      : ['Open the form page', 'Fill non-sensitive fields', 'Stop for your confirmation before submit'];
  }
  if (kind === 'lookup' || kind === 'other') {
    if (entities.url) {
      return vi ? ['Mở URL', 'Đọc và tóm tắt'] : ['Open URL', 'Read and summarize'];
    }
    return vi ? ['Tìm kiếm', 'Mở kết quả phù hợp', 'Tóm tắt'] : ['Search', 'Open best result', 'Summarize'];
  }
  return vi
    ? ['Tìm thông tin', 'Đọc trang liên quan', 'Tổng hợp kết quả']
    : ['Search for information', 'Read relevant pages', 'Summarize results'];
}

function missingInputs(kind, entities, text) {
  const missing = [];
  const low = String(text || '').toLowerCase();
  if (kind === 'compare' && !entities.query && !/\b(iphone|samsung|laptop|macbook)\b/i.test(text)) {
    missing.push('product');
  }
  if (kind === 'maps' && !entities.city && !entities.query && !/đến|to\s+\w+/i.test(text)) {
    missing.push('destination');
  }
  if (kind === 'form' && !entities.url && !entities.site) {
    missing.push('form_url');
  }
  if (kind === 'work_doc' && !entities.url && !/\b(repo|github|gitlab)\b/i.test(low)) {
    missing.push('repo_url');
  }
  // Very short vague tasks
  if (String(text || '').trim().length < 8 && kind === 'research') {
    missing.push('goal');
  }
  return missing;
}

function clarificationQuestion(missing, lang) {
  const vi = lang === 'vi';
  const map = {
    product: {
      q: vi ? 'Bạn muốn so sánh sản phẩm nào?' : 'Which product do you want to compare?',
      choices: vi ? ['iPhone', 'Samsung', 'Laptop văn phòng', 'Khác…'] : ['iPhone', 'Samsung', 'Office laptop', 'Other…']
    },
    destination: {
      q: vi ? 'Bạn muốn đến đâu?' : 'Where do you want to go?',
      choices: vi ? ['Hà Nội', 'TP.HCM', 'Đà Nẵng', 'Khác…'] : ['Hanoi', 'HCMC', 'Da Nang', 'Other…']
    },
    form_url: {
      q: vi ? 'Form nằm ở trang nào? (dán URL)' : 'What is the form page URL?',
      choices: []
    },
    repo_url: {
      q: vi ? 'Repository nào? (dán URL GitHub/GitLab)' : 'Which repository? (paste GitHub/GitLab URL)',
      choices: []
    },
    goal: {
      q: vi ? 'Bạn muốn Agent làm gì cụ thể hơn?' : 'What exactly should the Agent do?',
      choices: vi
        ? ['Tìm & tóm tắt tin', 'So sánh giá', 'Mở một trang', 'Khác…']
        : ['Find & summarize news', 'Compare prices', 'Open a page', 'Other…']
    }
  };
  const first = missing[0] || 'goal';
  return map[first] || map.goal;
}

/**
 * Structured understanding — deterministic core.
 * @returns {object} schema-stable intent object
 */
function understandDeterministic(text, langHint) {
  const language = langHint || detectLanguage(text);
  const intentClass = agentIntent.classifyIntent(text);
  const spec = taskAnalyzer.analyzeTask(text, language);
  const entities = extractEntities(text);
  const missing = missingInputs(spec.kind, entities, text);
  let confidence = 0.85;
  if (intentClass.kind === 'CHAT') confidence = 0.9;
  if (intentClass.kind === 'QUICK_LOOKUP') confidence = 0.88;
  if (missing.length) confidence = Math.min(confidence, 0.45);
  if (String(text || '').trim().length < 12 && intentClass.kind === 'TASK') confidence = Math.min(confidence, 0.5);
  if (spec.kind === 'other' && intentClass.kind === 'TASK') confidence = Math.min(confidence, 0.6);

  const plan_outline = buildPlanOutline(spec.kind, entities, language);
  const risk = spec.risk === 'elevated' ? 'elevated' : /buy|payment|delete|transfer|password|otp|thanh toán|mật khẩu/i.test(text) ? 'elevated' : 'low';

  return {
    intent: intentClass.kind, // CHAT | QUICK_LOOKUP | TASK
    kind: spec.kind,
    goal: spec.goal || String(text || '').slice(0, 700),
    entities,
    inputs_missing: missing,
    risk,
    plan_outline,
    confidence,
    language,
    needs_clarification: missing.length > 0 || confidence < CONFIDENCE_ASK,
    source: 'deterministic'
  };
}

/**
 * Optional AI enrichment. chatFn(messages) -> string JSON or text.
 * On any failure, returns deterministic result unchanged.
 */
async function understandWithOptionalLlm(text, langHint, chatFn) {
  const base = understandDeterministic(text, langHint);
  if (String(process.env.AGENT_INTENT_LLM || '').toLowerCase() !== '1') return base;
  if (typeof chatFn !== 'function') return base;
  if (base.confidence >= 0.8 && !base.inputs_missing.length) return base;
  try {
    const prompt = [
      'Return ONLY JSON with keys: intent, kind, goal, entities, inputs_missing, risk, plan_outline, confidence, language.',
      'intent: CHAT|QUICK_LOOKUP|TASK. confidence 0-1. plan_outline: 2-5 short steps.',
      'User message:',
      String(text || '').slice(0, 2000)
    ].join('\n');
    const raw = await chatFn([{ role: 'user', content: prompt }]);
    const m = String(raw || '').match(/\{[\s\S]*\}/);
    if (!m) return base;
    const parsed = JSON.parse(m[0]);
    if (!parsed || typeof parsed !== 'object') return base;
    return {
      intent: parsed.intent || base.intent,
      kind: parsed.kind || base.kind,
      goal: String(parsed.goal || base.goal).slice(0, 700),
      entities: Object.assign({}, base.entities, parsed.entities || {}),
      inputs_missing: Array.isArray(parsed.inputs_missing) ? parsed.inputs_missing.slice(0, 5) : base.inputs_missing,
      risk: parsed.risk === 'elevated' ? 'elevated' : 'low',
      plan_outline: Array.isArray(parsed.plan_outline) ? parsed.plan_outline.slice(0, 5).map((s) => String(s).slice(0, 120)) : base.plan_outline,
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || base.confidence)),
      language: parsed.language === 'vi' ? 'vi' : parsed.language === 'en' ? 'en' : base.language,
      needs_clarification: false,
      source: 'llm'
    };
  } catch (_) {
    return base;
  }
}

function shouldAskUser(understanding, askRound) {
  if (askRound >= MAX_ASK_ROUNDS) return false;
  if (!understanding) return false;
  if (understanding.inputs_missing && understanding.inputs_missing.length) return true;
  if (understanding.confidence < CONFIDENCE_ASK) return true;
  return !!understanding.needs_clarification;
}

function buildAskPayload(understanding) {
  const lang = understanding.language || 'en';
  const missing = understanding.inputs_missing || [];
  const { q, choices } = clarificationQuestion(missing, lang);
  return {
    type: 'ask_user',
    question: q,
    options: choices.slice(0, 4),
    kind: 'clarify',
    plan_outline: understanding.plan_outline || [],
    language: lang
  };
}

/** One-tap common tasks — bilingual */
function commonTasks(lang) {
  const vi = lang === 'vi';
  return [
    { id: 'news_today', icon: '📰', label: vi ? 'Tin hôm nay' : 'Today’s news', prompt: vi ? 'Tóm tắt tin nổi bật hôm nay từ vài nguồn' : 'Summarize today’s top news from a few sources', playbook: 'news_digest' },
    { id: 'compare_price', icon: '💰', label: vi ? 'So sánh giá' : 'Compare prices', prompt: vi ? 'So sánh giá sản phẩm: ' : 'Compare prices for: ', playbook: 'compare_products' },
    { id: 'summarize_page', icon: '📝', label: vi ? 'Tóm tắt trang' : 'Summarize page', prompt: vi ? 'Tóm tắt nội dung trang đang mở' : 'Summarize the current page', playbook: null },
    { id: 'maps', icon: '🗺️', label: vi ? 'Chỉ đường' : 'Directions', prompt: vi ? 'Chỉ đường đến ' : 'Directions to ', playbook: 'maps_directions' },
    { id: 'track_order', icon: '📦', label: vi ? 'Tra đơn hàng' : 'Track order', prompt: vi ? 'Kiểm tra trạng thái đơn hàng trên trang đã đăng nhập' : 'Check order status on the signed-in site', playbook: null },
    { id: 'save_notes', icon: '💾', label: vi ? 'Lưu ghi chú' : 'Save notes', prompt: vi ? 'Tóm tắt trang và lưu thành file ghi chú' : 'Summarize the page and save as a note file', playbook: null }
  ];
}

module.exports = {
  detectLanguage,
  understandDeterministic,
  understandWithOptionalLlm,
  shouldAskUser,
  buildAskPayload,
  commonTasks,
  CONFIDENCE_ASK,
  MAX_ASK_ROUNDS
};
