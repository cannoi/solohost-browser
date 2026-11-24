'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { finalizeDoneMessage, writeReportFiles, resolveReportFile, reportDir } = require('../lib/agent-report');

const task = {
  id: 'repfile99aabb',
  lang: 'vi',
  task: 'Báo cáo thị trường phần mềm 2026',
  message: 'Tóm tắt: thị trường tăng trưởng, cần thêm nguồn.',
  history: [{ step: 1, action: { type: 'search', query: 'software market' }, result: 'ok' }],
  workMemory: {},
  errors: []
};

const fin = finalizeDoneMessage(task, task.message);
assert.ok(fin.report, 'report present');
assert.ok(fin.report.files || task.reportFiles, 'files metadata');
const files = fin.report.files || task.reportFiles;
const dir = reportDir();
assert.ok(fs.existsSync(path.join(dir, files.md)), 'md file exists');
assert.ok(fs.existsSync(path.join(dir, files.html)), 'html file exists');
const md = fs.readFileSync(path.join(dir, files.md), 'utf8');
assert.ok(md.includes('Báo cáo') || md.includes('report') || md.includes('Tóm tắt'));
const resolved = resolveReportFile(task.id, 'md');
assert.ok(resolved && resolved.path);
console.log('[PASS] agent-report-files');
console.log(' wrote', files.md);
