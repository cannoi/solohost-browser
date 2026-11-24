'use strict';
const intentLlm = require('./agent-intent-llm');
function list(lang) {
  return intentLlm.commonTasks(lang === 'vi' ? 'vi' : 'en');
}
module.exports = { list };
