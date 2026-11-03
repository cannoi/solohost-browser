'use strict';
const fs = require('fs');
const path = require('path');
const agentEvidence = require('./agent-evidence');
const agentLinks = require('./agent-links');
function clip(s,n){s=String(s||'');return s.length<=n?s:s.slice(0,n)+'…';}
function uniq(arr){const out=[],seen=new Set();for(const x of arr||[]){const k=String(x||'').trim();if(k&&!seen.has(k)){seen.add(k);out.push(k);}}return out;}
function extractUrls(text){return agentLinks.extractUrls(text);}
function isMediaUrl(u){return /\.(png|jpe?g|gif|webp|svg|mp4|webm|m3u8|mp3|ogg)(\?|$)/i.test(u)||/youtube\.com\/watch|youtu\.be\/|vimeo\.com\//i.test(u);}
function domain(url){try{return new URL(url).hostname.replace(/^www\./,'');}catch(_){return '';}}
function buildAgentReport(task){
  const lang=task.lang==='vi'?'vi':'en', vi=lang==='vi', wm=task.workMemory||{}, history=Array.isArray(task.history)?task.history:[];
  const summaryRaw=String(task.message||task.lastDoneSummary||(vi?'Nhiệm vụ đã hoàn thành.':'Task completed.')).trim();
  const ledger=agentEvidence.loadLedger(task.id).filter(e=>e&&e.url&&e.kind!=='serp'&&agentLinks.canonicalizeUrl(e.url)&&!['captcha','search_results','redirector','invalid'].includes(agentLinks.classifyUrl(e.url)));
  const findings=ledger.filter(e=>e.kind!=='serp').map(e=>({id:e.id,title:e.title||domain(e.url),url:agentLinks.canonicalizeUrl(e.url),snippet:String(e.snippet||'').trim(),publishedAt:e.publishedAt||null,kind:e.kind||'page',source:e.source||domain(e.url)}));
  const stepLines=history.map((h,i)=>{const a=h.action||{};let action=typeof a==='string'?a:(a.type||'');if(a.url)action+=' '+a.url;if(a.query)action+=' q='+a.query;return {n:h.step||h.n||i+1,action:action||h.text||'step',url:h.url||(a.url||''),ok:h.ok,thought:h.thought||h.text||''};}).filter(x=>x.action||x.url);
  // Sources are ledger-backed only. Free text/LLM-authored URLs never become report references.
  const refs=uniq(ledger.map(e=>agentLinks.canonicalizeUrl(e.url))).filter(u=>!['captcha','search_results','redirector','invalid'].includes(agentLinks.classifyUrl(u)));
  const media=refs.filter(isMediaUrl), sources=refs.filter(u=>!isMediaUrl(u));
  const errors=Array.isArray(task.errors)?task.errors:[];
  const sourceStatus=task.sourcesStatus||{};
  const lines=['# '+(vi?'Báo cáo Browser Agent':'Browser Agent report'),'','## '+(vi?'Tóm tắt kết quả':'Result summary'),summaryRaw,''];
  try{const cov=agentEvidence.researchCoverage(task.id,{target:task.researchTarget});if(cov){lines.push('## '+(vi?'Độ phủ nghiên cứu':'Research coverage'));lines.push((vi?'Tìm thấy':'Found')+': '+cov.found+' · '+(vi?'Đã mở':'Opened')+': '+cov.opened+' · '+(vi?'Đã xác minh':'Verified')+': '+cov.verified+' · '+(vi?'Host độc lập':'Independent hosts')+': '+cov.independentHosts+(cov.target!=null?(' · '+(vi?'Mục tiêu':'Target')+': '+cov.target+' ('+(cov.targetMet?'met':'not met')+')'):''));if(cov.limitations)lines.push('*'+(cov.limitations)+'*');lines.push('');}}catch(_){}
  if(findings.length){lines.push('## '+(vi?'Phát hiện có bằng chứng':'Evidence-backed findings'));findings.slice(0,80).forEach((f,i)=>{const time=f.publishedAt?(' · '+f.publishedAt):(' · '+(vi?'thu thập':'collected')+' '+new Date().toISOString());lines.push(`${i+1}. ${clip(f.snippet||f.title,500)} — [${f.title||f.source} · ${f.source}]( ${f.url} ) [${f.id}]${time}`.replace(/\]\(\s+/g,'](').replace(/\s+\)/g,')'));});lines.push('');}
  if(stepLines.length){lines.push('## '+(vi?'Các bước đã thực hiện':'Steps taken'));stepLines.slice(-40).forEach(s=>lines.push(`${s.n}. ${s.action}${s.url?' — '+s.url:''}`));lines.push('');}
  if(sources.length){lines.push('## '+(vi?'Nguồn có trong sổ bằng chứng':'Evidence ledger sources'));sources.slice(0,60).forEach((u,i)=>{const e=ledger.find(x=>agentLinks.canonicalizeUrl(x.url)===u);lines.push(`${i+1}. [${(e&&e.title)||domain(u)} · ${domain(u)}](${u})${e&&e.publishedAt?' · '+e.publishedAt:''} · [${e&&e.id||'E?'}]`);});lines.push('');}
  if(media.length){lines.push('## '+(vi?'Ảnh / media':'Media'));media.slice(0,30).forEach((u,i)=>lines.push(`${i+1}. ${u}`));lines.push('');}
  lines.push('## '+(vi?'Phạm vi & hạn chế':'Scope & limitations'));
  lines.push(vi?`Số bằng chứng trong sổ: ${ledger.length}; trang đã đọc/ghi nhận: ${findings.length}. Kết quả tìm kiếm (SERP) chỉ là ứng viên, không được coi là bằng chứng nội dung.`:`Ledger evidence entries: ${ledger.length}; opened/read evidence pages: ${findings.length}. Search results (SERP) are candidates, not evidence for factual claims.`);
  const statusEntries=Object.entries(sourceStatus); if(statusEntries.length) statusEntries.forEach(([host,v])=>lines.push(`- ${host}: ${v.status||'unknown'}${v.reason?' — '+v.reason:''}`));
  if(errors.length){lines.push(vi?'Lỗi/hạn chế kỹ thuật:':'Technical errors/limitations:');errors.slice(-20).forEach(e=>lines.push(`- ${clip(e.message||e.reason||'Unknown error',240)}`));}
  if(!findings.length) lines.push(vi?'Chưa có bằng chứng từ trang đã mở; không nên xem các đoạn trích tìm kiếm là dữ kiện đã xác minh.':'No opened-page evidence was recorded; search snippets should not be treated as verified facts.');
  lines.push('',`## ${vi?'Thời điểm thu thập':'Collection time'}`,`${new Date().toISOString()} (UTC)`,'',vi?'Báo cáo chỉ liệt kê liên kết lấy từ sổ bằng chứng của nhiệm vụ này.':'Links are listed only when present in this task’s evidence ledger.');
  return {markdown:lines.join('\n'),summary:summaryRaw,findings:findings.slice(0,80),steps:stepLines.slice(-40),links:sources.slice(0,60),media:media.slice(0,30),visited:sources.slice(0,40),linkChecks:sources.map(url=>({url,status:'opened_in_task_ledger',checkedAt:(ledger.find(e=>agentLinks.canonicalizeUrl(e.url)===url)||{}).fetchedAt||null})),task:clip(task.task||'',2000),errors:errors.slice(-20),evidenceCount:ledger.length,generatedAt:new Date().toISOString()};
}
function groundSummary(task, raw) {
  let msg = String(raw || '').trim();
  // Strip HTML attribute leakage from double-encoded links
  msg = msg.replace(/\s*target="_blank"\s*rel="noopener noreferrer">/gi, ' ');
  msg = msg.replace(/<\/?a\b[^>]*>/gi, '');
  const ledger = agentEvidence.loadLedger(task.id).filter(e => e && e.url && e.kind !== 'serp' && !['captcha','search_results','redirector','invalid'].includes(agentLinks.classifyUrl(e.url)));
  const byId = new Map(ledger.map(e => [String(e.id), e]));
  const allowed = new Set(ledger.map(e => agentLinks.canonicalizeUrl(e.url)).filter(Boolean));
  const allowedHosts = new Set([...allowed].map(domain).filter(Boolean));
  for (const url of agentLinks.extractUrls(msg)) {
    const can = agentLinks.canonicalizeUrl(url);
    if (!allowed.has(can)) {
      const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      msg = msg.replace(new RegExp(escaped, 'g'), task.lang === 'vi' ? '[đã bỏ liên kết chưa có trong sổ bằng chứng]' : '[link omitted: not in task evidence ledger]');
    }
  }
  msg = msg.replace(/\[(E\d+)\]/g, (full, id) => {
    const e = byId.get(id); if (!e) return task.lang === 'vi' ? '[trích dẫn chưa xác minh]' : '[unverified citation]';
    const url = agentLinks.canonicalizeUrl(e.url);
    return '[' + clip(e.title || e.source || domain(url), 100) + ' · ' + domain(url) + '](' + url + ') [' + id + ']';
  });
  const hasEvidence = ledger.length > 0;
  const lines = msg.split('\n').map(line => {
    const lt = line.trim();
    if (!lt || /^#{1,6}\s/.test(lt) || /^[-*_]{3,}$/.test(lt) || /^\|/.test(lt) || /^⚠/.test(lt) || /^---/.test(lt)) return line;
    if (/\[E\d+\]/i.test(lt)) return line;
    if (/\[[^\]]+\]\(https?:\/\/[^)]+\)/.test(lt) && [...allowed].some(u => lt.includes(u))) return line;
    if ([...allowedHosts].some(h => h && lt.toLowerCase().includes(h))) return line;
    if (!hasEvidence && (/^[-*]\s+/.test(lt) || /^\d+[.)]\s+/.test(lt)) && lt.length > 40) {
      if (/⚠/.test(lt)) return line;
      return line + (task.lang === 'vi' ? ' ⚠ Chưa xác minh độc lập.' : ' ⚠ Not independently verified.');
    }
    return line;
  });
  return lines.join('\n');
}

function finalizeDoneMessage(task,summary){
  let msg=String(summary||task.message||'').trim();
  const report=buildAgentReport(Object.assign({},task,{message:msg,lastDoneSummary:msg}));
  if(msg.length<80||/^(done\.?|xong\.?|hoàn thành\.?|completed\.?)$/i.test(msg))msg=report.markdown;
  else {
    msg = groundSummary(task, msg);
    if(report.evidenceCount && !/\[E\d+\]/.test(msg)){
      msg=msg+'\n\n---\n\n'+(task.lang==='vi'?'## Bằng chứng đã thu thập':'## Collected evidence')+'\n'+report.findings.slice(0,30).map((f,i)=>`${i+1}. ${clip(f.snippet||f.title,500)} — [${f.title||f.source}](${f.url}) [${f.id}]`).join('\n');
    }
  }
  if(msg.length>120000)msg=msg.slice(0,120000)+'\n…';
  report.markdown = report.markdown || msg;
  // Auto-generate downloadable report files (.md + .html)
  try {
    const files = writeReportFiles(task, Object.assign({}, report, { markdown: report.markdown || msg }));
    if (files && files.ok) {
      report.files = { md: files.mdName, html: files.htmlName, baseName: files.baseName };
      if (task) task.reportFiles = report.files;
    }
  } catch (_) {}
  return {message:msg,report};
}
module.exports={buildAgentReport,finalizeDoneMessage,extractUrls,isMediaUrl,groundSummary,writeReportFiles,resolveReportFile,reportDir};

function reportDir() {
  const base = process.env.SOLOHOST_DATA_DIR || path.join(process.cwd(), 'data');
  const dir = path.join(base, 'agent-reports');
  try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (_) {}
  return dir;
}

function safeFileSlug(s) {
  return String(s || 'report')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'report';
}

function markdownToSimpleHtml(md, title) {
  const esc = (s) => String(s || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  let body = esc(md);
  body = body
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^\- (.+)$/gm, '<li>$1</li>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>\n');
  // wrap consecutive li
  body = body.replace(/(?:<li>.*?<\/li>\s*)+/gs, (m) => '<ul>' + m + '</ul>');
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(title || 'Agent Report') + '</title>'
    + '<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:860px;margin:28px auto;padding:0 18px;line-height:1.55;color:#111}'
    + 'a{color:#1d4ed8;word-break:break-all}h1,h2,h3{margin:1.2em 0 .45em}ul{padding-left:1.3em}'
    + '.meta{color:#666;font-size:13px;margin-bottom:1.5em}hr{border:none;border-top:1px solid #e5e7eb;margin:1.5em 0}</style>'
    + '</head><body><p class="meta">SoloHost Browser Agent</p><p>' + body + '</p></body></html>';
}

/**
 * Persist markdown + HTML report files for a completed (or partial) agent task.
 * Returns { ok, mdPath, htmlPath, baseName, dir } or { ok:false, error }.
 */
function writeReportFiles(task, report) {
  try {
    const rep = report || (task && task.report) || buildAgentReport(task);
    const md = String(rep.markdown || '').trim();
    if (!md) return { ok: false, error: 'empty_report' };
    const dir = reportDir();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const slug = safeFileSlug((task && (task.brief || task.task)) || task.id || 'task');
    const baseName = 'agent-report-' + safeFileSlug(task.id || 'x').slice(0, 24) + '-' + slug + '-' + ts;
    const mdPath = path.join(dir, baseName + '.md');
    const htmlPath = path.join(dir, baseName + '.html');
    const title = (task && task.lang === 'vi') ? 'Báo cáo Browser Agent' : 'Browser Agent Report';
    const header = [
      '---',
      'taskId: ' + (task && task.id || ''),
      'generatedAt: ' + (rep.generatedAt || new Date().toISOString()),
      'status: ' + (task && task.status || ''),
      'partial: ' + !!(task && task.partial),
      '---',
      ''
    ].join('\n');
    fs.writeFileSync(mdPath, header + md + '\n', { mode: 0o600 });
    fs.writeFileSync(htmlPath, markdownToSimpleHtml(md, title), { mode: 0o600 });
    const files = {
      ok: true,
      baseName,
      dir,
      mdPath,
      htmlPath,
      mdName: baseName + '.md',
      htmlName: baseName + '.html',
      generatedAt: new Date().toISOString()
    };
    if (task) {
      task.reportFiles = {
        md: files.mdName,
        html: files.htmlName,
        baseName: files.baseName,
        generatedAt: files.generatedAt
      };
    }
    return files;
  } catch (e) {
    return { ok: false, error: String(e.message || e).slice(0, 200) };
  }
}

function resolveReportFile(taskId, format) {
  const dir = reportDir();
  const fmt = String(format || 'md').toLowerCase() === 'html' ? 'html' : 'md';
  const id = String(taskId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  if (!id) return null;
  try {
    const idShort = id.slice(0, 12);
    const names = fs.readdirSync(dir).filter((n) => (n.includes(id) || n.includes(idShort)) && n.endsWith('.' + fmt));
    if (!names.length) return null;
    names.sort();
    const name = names[names.length - 1];
    const full = path.join(dir, name);
    return { path: full, name, format: fmt };
  } catch (_) {
    return null;
  }
}

