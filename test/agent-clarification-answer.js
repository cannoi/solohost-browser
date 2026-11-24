'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const backendSrc = fs.readFileSync(path.join(__dirname, '../lib/backend-agent.js'), 'utf8');
const agentSrc = fs.readFileSync(path.join(__dirname, '../lib/browser-agent.js'), 'utf8');
const panelSrc = fs.readFileSync(path.join(__dirname, '../public/ai-panel.js'), 'utf8');

assert.ok(backendSrc.includes('normalizeAskText'), 'normalizeAskText present');
assert.ok(backendSrc.includes('ask_user_suppressed_repeat'), 'repeat ask suppression');
assert.ok(backendSrc.includes('Đã nhận câu trả lời'), 'answer status message VI');
assert.ok(backendSrc.includes('lastUserAnswer'), 'stores lastUserAnswer');
assert.ok(agentSrc.includes('USER_CLARIFICATIONS are authoritative'), 'system prompt rule');
assert.ok(agentSrc.includes('do NOT re-ask'), 'userPrompt label');
assert.ok(panelSrc.includes('pendingAsk: true'), 'client pendingAsk on ask');
assert.ok(panelSrc.includes('agentCtx.pendingAsk'), 'clarification uses pendingAsk');

// Functional: isSimilarAsk via requiring backend is heavy; test pure helpers by eval extract
const start = backendSrc.indexOf('function normalizeAskText');
const end = backendSrc.indexOf('function loadTaskDisk');
assert.ok(start > 0 && end > start);
const helpers = backendSrc.slice(start, end) + '\nmodule.exports = { normalizeAskText, isSimilarAsk };';
const tmp = path.join(__dirname, '_helpers_clarif_tmp.js');
fs.writeFileSync(tmp, helpers);
const { normalizeAskText, isSimilarAsk } = require(tmp);
assert.ok(isSimilarAsk(
  'Bạn đang ở đâu để tôi có thể chỉ đường chính xác đến Chợ Hàn, Đà Nẵng?',
  'ban dang o dau de toi co the chi duong chinh xac den Cho Han Da Nang'
));
assert.ok(isSimilarAsk('Where are you located?', 'where are you located?'));
assert.ok(!isSimilarAsk('What is the price of iPhone?', 'Where is the nearest cafe?'));
try { fs.unlinkSync(tmp); } catch (_) {}

console.log('[PASS] agent-clarification-answer');
