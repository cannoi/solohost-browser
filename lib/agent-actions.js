'use strict';
/** Browser Agent action handlers (extracted; behavior-preserving). */
const agentSearch = require('./agent-search');
const agentTools = require('./agent-tools');
const agentLinks = require('./agent-links');
const actionRecovery = require('./agent-action-recovery');
const agentEvidence = require('./agent-evidence');
const agentWeb = require('./agent-web');
const appLog = require('./app-log');
const { clip } = require('./util');

/** Block autofill into password/OTP/payment fields (same policy as backend-agent). */
const SECRET = /password|passcode|one[- ]?time|otp|cvv|cvc|credit.?card|mật khẩu|mat khau|mã xác minh/i;

function isLiveEngine(session) {
  return !!(session && (session.pwSessionId || session.backend === 'playwright' || session.engine === 'playwright'));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, Math.max(0, Number(ms) || 0)));
}

async function waitStable(session) {
  await sleep(350);
  if (isLiveEngine(session) && session.pwSessionId) {
    try {
      const pw = require('./engine/playwright-engine');
      if (typeof pw.evaluate === 'function') {
        await pw.evaluate(session.pwSessionId, 'new Promise(r => setTimeout(r, 150))');
      }
    } catch (_) {}
  }
}

function createExecuteAction(ctx) {
  return async function executeAction(task, session, action, obs) {
    const domBridge = ctx.domBridge;
    const assertSafeUrl = ctx.assertSafeUrl;
    const targets = (obs && obs.targets) || {};
    if (!action || !action.type) return { ok: false, result: 'missing_action' };
    try {
      const n = agentTools.normalizeToolAction(action);
      if (n && n.type) action = Object.assign({}, action, n);
    } catch (_) {}
    switch (action.type) {
    case 'navigate': {
      let url = String(action.url || '').trim();
      if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
      await assertSafeUrl(url);
      const r = await domBridge.navigate(session, url);
      const finalUrl = String((r && r.url) || url || '');
      const chromeErr = /chrome-error:\/\/|chromewebdata|about:neterror|err_/i.test(finalUrl)
        || /net::ERR_|HTTP2_PROTOCOL|NAME_NOT_RESOLVED|TIMED_OUT/i.test(String((r && r.error) || ''));
      let ok = !!(r && !r.error && r.hasContent !== false && r.backend !== 'proxy-error' && !chromeErr);
      if (chromeErr) ok = false;
      const domain = agentEvidence.domainOf(finalUrl.indexOf('chrome-error') === 0 ? url : finalUrl) || agentEvidence.domainOf(url);
      task.sourcesStatus = task.sourcesStatus || {};
      if (domain) task.sourcesStatus[domain] = ok
        ? { status: 'ok', reason: 'navigation_succeeded', at: new Date().toISOString() }
        : { status: 'failed', reason: clip((r && r.error) || (chromeErr ? 'chrome_error_or_protocol_failure' : 'navigation_failed_or_empty_content'), 180), at: new Date().toISOString() };
      if (ok && r && r.url) {
        task.urlStack = task.urlStack.slice(0, task.urlIndex + 1);
        task.urlStack.push(r.url);
        task.urlIndex = task.urlStack.length - 1;
        task.workMemory = task.workMemory || {};
        task.workMemory.visited = (task.workMemory.visited || []).concat([r.url]).slice(-30);
      }
      if (ok && r && r.url) {
        try { session.url = r.url; session.title = r.title || session.title; session.lastUrl = r.url; } catch (_) {}
      }
      // Auto-extract after successful navigate so research gets verified page evidence
      let extracted = null;
      if (ok && isLiveEngine(session) && session.pwSessionId) {
        try {
          const agentToolsImpl = require('./agent-tools-impl');
          const pw = require('./engine/playwright-engine');
          let data = null;
          if (typeof agentToolsImpl.extractFromPlaywrightSession === 'function') {
            data = await agentToolsImpl.extractFromPlaywrightSession(pw, session.pwSessionId);
          }
          if (data && !data.error && (data.text || data.title)) {
            extracted = agentEvidence.addEvidence(task.id, {
              kind: 'page',
              url: finalUrl || url,
              title: data.title || session.title || domain,
              text: data.text || data.snippet || '',
              snippet: (data.text || data.snippet || '').slice(0, 500),
              publishedAt: data.publishedAt || null,
              verified: true
            });
          }
        } catch (e) {
          try { appLog.log('warn', 'agent.navigate_auto_extract_fail', { error: String(e.message || e).slice(0, 120) }); } catch (_) {}
        }
      }
      if (!ok) {
        task._navFailStreak = (task._navFailStreak || 0) + 1;
        task._lastNavFailUrl = url;
        return {
          ok: false,
          result: chromeErr
            ? ('navigation_chrome_error: ' + url + ' — try alternate public source URL from SEARCH_CANDIDATES')
            : ((r && r.error) || 'navigation_failed_or_empty_content'),
          code: chromeErr ? 'NAV_CHROME_ERROR' : 'NAV_FAILED',
          state: r
        };
      }
      task._navFailStreak = 0;
      return {
        ok: true,
        result: (finalUrl || url) + (extracted ? (' · evidence ' + extracted.id) : ''),
        state: r,
        evidenceId: extracted && extracted.id
      };
    }
    case 'search': {
      const query = String(action.query || '').trim();
      if (!query) throw new Error('search needs "query"');
      // Task-local dedupe: identical normalized query already ran → reuse, no engine hit
      try {
        const nq = agentSearch.normalizeQuery ? agentSearch.normalizeQuery(query) : query.toLowerCase().trim();
        task.searchMemory = task.searchMemory || {};
        const prev = task.searchMemory[nq];
        if (prev && prev.at && (Date.now() - prev.at) < 8 * 60 * 1000 && prev.payload) {
          appLog.log('info', 'agent.search.duplicate_skipped', { query: nq.slice(0, 120), ageMs: Date.now() - prev.at });
          return prev.payload;
        }
      } catch (_) {}

      let engine = String(action.engine || process.env.SOLOHOST_DEFAULT_SEARCH || 'bing').toLowerCase();
      if (!['youtube', 'bing', 'google', 'ddg', 'brave'].includes(engine)) engine = 'bing';
      let url;
      if (engine === 'youtube') url = 'https://www.youtube.com/results?search_query=' + encodeURIComponent(query);
      else if (engine === 'bing') url = 'https://www.bing.com/search?q=' + encodeURIComponent(query);
      else if (engine === 'ddg') url = 'https://html.duckduckgo.com/html/?q=' + encodeURIComponent(query);
      else if (engine === 'brave') url = 'https://search.brave.com/search?q=' + encodeURIComponent(query);
      else url = 'https://www.google.com/search?q=' + encodeURIComponent(query);
      if (engine !== 'youtube') {
        const preferred = engine === 'google' ? ['bing', 'ddg', 'brave'] : [engine, ...['bing','ddg','brave'].filter(x => x !== engine)];
        task.searchEngineBlockedMap = task.searchEngineBlockedMap || {};
        if (Array.isArray(task.searchEngineBlocked)) {
          for (const e of task.searchEngineBlocked) task.searchEngineBlockedMap[e] = Date.now() + 20 * 60 * 1000;
        }
        let found = await agentSearch.searchWithAutoAdjust(query, {
          engines: preferred,
          timeoutMs: 3200,
          limit: 10,
          blockedMap: task.searchEngineBlockedMap,
          locale: task.lang || 'en',
          minScore: -10,
          variantLimit: 5
        });
        if (found.repairedQuery && Array.isArray(found.repairFixes) && found.repairFixes.length) {
          appLog.log('info', 'agent.search.query_repaired', {
            from: query.slice(0, 100),
            to: String(found.repairedQuery).slice(0, 100),
            fixes: found.repairFixes.slice(0, 8)
          });
        }
        if (found.autoAdjusted && found.adjustedQuery) {
          appLog.log('info', 'agent.search.query_adjusted', {
            from: query.slice(0, 100),
            to: String(found.adjustedQuery).slice(0, 100),
            attempts: (found.attempts || []).length
          });
          try {
            task.workMemory = task.workMemory || {};
            task.workMemory.notes = task.workMemory.notes || [];
            task.workMemory.notes.push({
              at: new Date().toISOString(),
              text: 'query_adjusted: ' + query.slice(0, 80) + ' → ' + String(found.adjustedQuery).slice(0, 80)
            });
          } catch (_) {}
        }
        if (Array.isArray(found.attempts)) {
          task.searchAttempts = (task.searchAttempts || []).concat(found.attempts.map((a) => ({
            engine: a.engine, outcome: a.outcome, query: a.query, resultCount: a.n, at: Date.now()
          }))).slice(-24);
        }
        task.searchEngineBlocked = Object.keys(task.searchEngineBlockedMap).filter((k) => task.searchEngineBlockedMap[k] > Date.now());
        const blockedEngines = Array.isArray(found.blockedEngines) ? found.blockedEngines : (found.blocked || []);
        appLog.log('info', found.cached ? 'agent.search.cache_hit' : 'agent.search.end', {
          query: query.slice(0, 120),
          outcome: found.outcome || (found.results && found.results.length ? 'ok' : 'empty'),
          engine: found.engine || null,
          engines: found.engines || undefined,
          intent: found.intent || undefined,
          bestScore: found.bestScore,
          adjusted: found.autoAdjusted ? String(found.adjustedQuery || '').slice(0, 100) : undefined,
          durationMs: found.durationMs != null ? found.durationMs : found.ms,
          resultCount: (found.results || []).length,
          blockedEngines: blockedEngines.length ? blockedEngines : undefined,
          cached: !!found.cached
        });
        if (found.results && found.results.length) {
          task.workMemory = task.workMemory || { findings: [], visited: [], notes: [], todo: [] };
          let candidateChecks = [];
          try {
            candidateChecks = await agentLinks.verifyLinks(
              found.results.slice(0, 4).map((x) => x.url),
              { cache: task.linkVerifyCache || (task.linkVerifyCache = new Map()), timeoutMs: 3500, concurrency: 4 }
            );
          } catch (e) {
            appLog.log('warn', 'agent.search.link_verify_fail', { error: String(e.message || e).slice(0, 160) });
            candidateChecks = [];
          }
          const checkedByUrl = new Map((candidateChecks || []).map((x) => [x.url, x]));
          task.workMemory.searchCandidates = found.results.map((x) => Object.assign({}, x, {
            linkCheck: checkedByUrl.get(agentLinks.canonicalizeUrl(x.url)) || null
          }));
          try {
            if (agentSearch.rankCandidates) {
              task.workMemory.searchCandidates = agentSearch.rankCandidates(task.workMemory.searchCandidates, query);
            }
          } catch (_) {}
          task.searchEngineBlocked = [...new Set([...(task.searchEngineBlocked || []), ...(found.blocked || [])])];
          for (const item of task.workMemory.searchCandidates) agentEvidence.addEvidence(task.id, { kind: 'serp', url: item.url, title: item.title, snippet: (item.snippet || '') + (item.linkCheck ? ` [link check: ${item.linkCheck.ok ? 'ok' : item.linkCheck.reason || 'unverified'}]` : ''), text: item.snippet || '', source: item.site });
          const summary = task.workMemory.searchCandidates.map((x, i) => `${i + 1}. ${x.title} — ${x.url}${x.snippet ? ' — ' + x.snippet : ''}${x.linkCheck ? ' [link: ' + (x.linkCheck.ok ? 'reachable' : 'not verified') + ']' : ''}`).join('\n');
          try {
            const nq = agentSearch.normalizeQuery ? agentSearch.normalizeQuery(query) : query.toLowerCase().trim();
            task.searchMemory = task.searchMemory || {};
            task.searchMemory[nq] = { at: Date.now(), payload: null };
          } catch (_) {}
          task.lastToolResult = {
            action: 'search', query, outcome: 'ok', engine: found.engine,
            durationMs: found.durationMs != null ? found.durationMs : found.ms,
            resultCount: (found.results || []).length
          };
          task.searchAttempts = (task.searchAttempts || []).concat([{
            engine: found.engine, outcome: 'ok', query, durationMs: task.lastToolResult.durationMs, at: Date.now()
          }]).slice(-20);
          const __searchPayload = { ok: true, result: `Structured search via ${found.engine}; ${found.results.length} candidates. Search snippets are candidates only; open pages before making factual claims.\n${summary}`, state: { url, title: `Search: ${query}`, text: summary, searchResults: found.results, engine: found.engine, blocked: found.blocked || [], blockedEngines: found.blocked || [] } };
          try { const nq = agentSearch.normalizeQuery ? agentSearch.normalizeQuery(query) : query.toLowerCase().trim(); if (task.searchMemory && task.searchMemory[nq]) task.searchMemory[nq].payload = __searchPayload; } catch (_) {}
          return __searchPayload;
        }
        task.errors = task.errors || [];
        task.errors.push({
          at: new Date().toISOString(),
          step: task.history.length + 1,
          message: 'Structured search ' + (found.outcome || 'empty') + ': ' + (found.error || 'no results'),
          enginesBlocked: found.blocked || []
        });
        if (found.outcome === 'blocked' || found.outcome === 'empty') {
          // Research + locale aware variants (auto-adjust already tried some; use remaining)
          const triedQs = (task.searchAttempts || []).map((a) => a.query).filter(Boolean);
          const variants = (agentSearch.buildQueryVariants
            ? agentSearch.buildQueryVariants(query, { tried: triedQs, locale: task.lang || 'en', limit: 6 })
            : []);
          // Keep a couple marketplace pivots for commerce tasks
          if (/\b(mua|bán|giá|chotot)\b/i.test(query)) {
            variants.push(query + ' chotot');
            variants.push(query + ' mua bán');
          }
          for (const v of variants) {
            const nq = agentSearch.normalizeQuery ? agentSearch.normalizeQuery(v) : v.toLowerCase();
            if (task.searchMemory && task.searchMemory[nq]) continue;
            const found2 = await agentSearch.searchWeb(v, {
              engines: preferred, timeoutMs: 3200, limit: 10, blockedMap: task.searchEngineBlockedMap
            });
            task.searchAttempts = (task.searchAttempts || []).concat([{
              engine: found2.engine, outcome: found2.outcome, reason: found2.error || null, query: v,
              durationMs: found2.durationMs || found2.ms, at: Date.now()
            }]).slice(-20);
            try {
              task.searchMemory = task.searchMemory || {};
              task.searchMemory[nq] = { at: Date.now(), outcome: found2.outcome, payload: null };
            } catch (_) {}
            if (found2.results && found2.results.length) {
              found = found2;
              // fall through by reusing success path — rebuild candidates briefly
              task.workMemory = task.workMemory || { findings: [], visited: [], notes: [], todo: [] };
              task.workMemory.searchCandidates = found2.results.map((x, i) => Object.assign({}, x, { rank: i + 1 }));
              task.lastToolResult = {
                action: 'search', query: v, outcome: 'ok', engine: found2.engine,
                durationMs: found2.durationMs || found2.ms, resultCount: found2.results.length
              };
              const summary = task.workMemory.searchCandidates.map((x, i) => (i + 1) + '. ' + x.title + ' — ' + x.url).join('\n');
              const payload = { ok: true, result: 'Structured search (variant) via ' + found2.engine + '; ' + found2.results.length + ' candidates.\n' + summary, state: { searchResults: found2.results, engine: found2.engine } };
              try { task.searchMemory[nq].payload = payload; } catch (_) {}
              return payload;
            }
          }
          const failPayload = {
            ok: false,
            outcome: found.outcome,
            result: found.outcome === 'blocked'
              ? 'search_blocked: engines challenged. Tried variants. Open a source URL or ask_user — do NOT conclude unavailable.'
              : 'search_empty: no results after variants. Try different keywords or direct classifieds URLs.',
            state: { blocked: found.blocked || [], outcome: found.outcome, attempts: (task.searchAttempts || []).slice(-8) }
          };
          try {
            const nq = agentSearch.normalizeQuery ? agentSearch.normalizeQuery(query) : query.toLowerCase();
            task.searchMemory = task.searchMemory || {};
            task.searchMemory[nq] = { at: Date.now(), outcome: found.outcome, payload: failPayload };
          } catch (_) {}
          task.lastToolResult = {
            action: 'search', query, outcome: found.outcome, reason: found.error || found.outcome,
            engine: found.engine, resultCount: 0
          };
          return failPayload;
        }
      }
      await assertSafeUrl(url);
      const r = await domBridge.navigate(session, url);
      if (r && r.url && /google\.com\/sorry|captcha|verify/i.test(r.url)) {
        task.errors = task.errors || []; task.errors.push({ at: new Date().toISOString(), message: 'Search engine blocked/verification page; switched to structured fallback where possible.' });
        return { ok: false, result: 'search_engine_blocked; do not retry this engine, use another public search engine or direct official source', state: r };
      }
      return { ok: !r.error && r.hasContent !== false, result: engine + ': ' + query, state: r };
    }
    case 'click': {
      const id = Number(action.id);
      const resolved = actionRecovery.resolveTarget(obs, id);
      if (!resolved.ok) return { ok: false, result: resolved.error || 'unknown_element_id', code: resolved.code || 'MISSING_ELEMENT' };
      const el = resolved.el;
      if (el && el.disabled) return { ok: false, result: 'element_disabled', code: 'DISABLED' };
      if (el && el.href && /\/(login|signin|oauth)/i.test(el.href) && !isLiveEngine(session)) {
        return { ok: false, result: 'login_requires_engine' };
      }
      if (el && actionRecovery.isSensitiveConfirmLabel(el.label || el.name) && !action.confirmed) {
        return { ok: false, result: 'sensitive_confirm_required', code: 'SENSITIVE_ACTION' };
      }
      const before = actionRecovery.snapshotPage(session, obs);
      let lastErr = null;
      let out = null;
      const targetId = resolved.targetId;
      for (let attempt = 0; attempt <= actionRecovery.MAX_RETRIES; attempt++) {
        try {
          if (isLiveEngine(session) && session.pwSessionId) {
            const pw = require('./engine/playwright-engine');
            out = await pw.dispatchEvent(session.pwSessionId, {
              type: 'click',
              targetId,
              locator: resolved.locator || (el ? { kind: el.kind, role: el.role, label: el.label, placeholder: el.placeholder, tag: el.tag } : null)
            });
            if (out && out.result && out.result.ok === false && attempt < actionRecovery.MAX_RETRIES) {
              lastErr = 'click_not_ok';
              await waitStable(session);
              continue;
            }
            if (out && (out.ok !== false) && !(out.result && out.result.ok === false)) {
              const after = { url: (out.url || session.url || ''), title: out.title || session.title || '', scrollY: before.scrollY };
              const changed = actionRecovery.pageChanged(before, after);
              if (!changed && attempt < actionRecovery.MAX_RETRIES) {
                lastErr = 'no_effect';
                await waitStable(session);
                continue;
              }
              return {
                ok: true,
                result: 'clicked ' + id + (out.result && out.result.strategy ? ' via ' + out.result.strategy : ''),
                state: out,
                no_effect: !changed,
                code: changed ? undefined : 'NO_EFFECT'
              };
            }
          }
          const bridgeOut = await domBridge.dispatchEvent(session, { type: 'click', targetId });
          out = bridgeOut;
          if (bridgeOut && bridgeOut.ok) {
            return { ok: true, result: bridgeOut.result || 'clicked ' + id, state: bridgeOut };
          }
          lastErr = (bridgeOut && bridgeOut.result) || 'click_failed';
        } catch (e) {
          lastErr = e;
          appLog.log('warn', 'agent.click_recover', { attempt, error: String(e.message || e).slice(0, 120) });
        }
        await waitStable(session);
      }
      const code = actionRecovery.classifyActionError(lastErr, { noEffect: lastErr === 'no_effect' });
      return { ok: false, result: String((lastErr && lastErr.message) || lastErr || 'click_failed').slice(0, 180), code, state: out };
    }
    case 'type': {
      const id = Number(action.id);
      const resolved = actionRecovery.resolveTarget(obs, id);
      if (!resolved.ok) return { ok: false, result: resolved.error || 'unknown_element_id', code: resolved.code || 'MISSING_ELEMENT' };
      const el = resolved.el;
      if (el && el.disabled) return { ok: false, result: 'element_disabled', code: 'DISABLED' };
      if (el && SECRET.test([el.type, el.label, el.name, el.placeholder, el.kind].filter(Boolean).join(' '))) {
        return { ok: false, result: 'blocked_secret_field_use_ask_user', code: 'SECRET_FIELD' };
      }
      const value = String(action.text != null ? action.text : action.value != null ? action.value : '');
      const targetId = resolved.targetId;
      const before = actionRecovery.snapshotPage(session, obs);
      let lastErr = null;
      for (let attempt = 0; attempt <= actionRecovery.MAX_RETRIES; attempt++) {
        try {
          if (isLiveEngine(session) && session.pwSessionId) {
            const pw = require('./engine/playwright-engine');
            let out = await pw.dispatchEvent(session.pwSessionId, {
              type: 'type',
              targetId,
              text: value,
              submit: !!(action.submit || action.press_enter),
              locator: resolved.locator || (el ? { kind: el.kind, role: el.role, label: el.label, placeholder: el.placeholder, type: el.type } : null)
            });
            if (out && out.ok === false && attempt < actionRecovery.MAX_RETRIES) {
              // semantic type fallback
              try {
                const page = pw.getPage ? pw.getPage(session.pwSessionId) : null;
                if (page) {
                  const sem = await actionRecovery.trySemanticType(page, resolved.locator || el, value, !!(action.submit || action.press_enter));
                  if (sem.ok) {
                    return { ok: true, result: 'typed via ' + sem.strategy, state: sem };
                  }
                }
              } catch (_) {}
              lastErr = 'type_failed';
              continue;
            }
            if (out && out.ok !== false) {
              return { ok: true, result: (action.submit || action.press_enter) ? 'typed+submit' : 'typed', state: out };
            }
          }
          const out = await domBridge.dispatchEvent(session, { type: 'input', targetId, value });
          if (action.submit || action.press_enter) {
            await waitStable(session);
            const sub = await domBridge.dispatchEvent(session, { type: 'submit', targetId });
            return { ok: !!out.ok, result: 'typed+submit', state: sub };
          }
          if (out && out.ok) return { ok: true, result: 'typed', state: out };
          lastErr = (out && out.result) || 'type_failed';
        } catch (e) {
          lastErr = e;
          appLog.log('warn', 'agent.type_recover', { attempt, error: String(e.message || e).slice(0, 120) });
        }
        await waitStable(session);
      }
      return {
        ok: false,
        result: String((lastErr && lastErr.message) || lastErr || 'type_failed').slice(0, 180),
        code: actionRecovery.classifyActionError(lastErr, {})
      };
    }
    case 'press_key':
    case 'press': {
      const id = Number(action.id);
      const targetId = id ? targets[id] : '';
      const key = String(action.key || 'Enter');
      if (isLiveEngine(session)) {
        const pw = require('./engine/playwright-engine');
        const out = await pw.dispatchEvent(session.pwSessionId, { type: 'press_key', targetId, key });
        return { ok: true, result: 'pressed ' + key, state: out };
      }
      if (targetId && (key === 'Enter' || key === 'Return')) {
        const out = await domBridge.dispatchEvent(session, { type: 'submit', targetId });
        return { ok: !!out.ok, result: 'enter', state: out };
      }
      return { ok: false, result: 'press_key_requires_engine' };
    }
    case 'select': {
      const id = Number(action.id);
      const targetId = targets[id];
      if (!targetId) return { ok: false, result: 'unknown_element_id' };
      const out = await domBridge.dispatchEvent(session, {
        type: 'input',
        targetId,
        value: action.value != null ? String(action.value) : '',
        selectedIndex: action.selectedIndex
      });
      return { ok: !!out.ok, result: 'selected', state: out };
    }
    case 'extract':
    case 'extract_page': {
      try {
        const pw = require('./engine/playwright-engine');
        const data = await agentTools.extractFromPlaywrightSession(pw, session.pwSessionId);
        if (data && !data.error) {
          const summary = [
            'title: ' + (data.title || ''),
            'headings: ' + (data.headings || []).slice(0, 12).join(' · '),
            'links: ' + (data.links || []).slice(0, 16).map((l) => l.text + ' → ' + l.href).join(' | '),
            'docs: ' + (data.docs || []).map((d) => d.kind + ' ' + d.href).join(' | '),
            'tables: ' + (data.tables || []).slice(0, 3).join('\n---\n'),
            'text: ' + (data.text || '').slice(0, 8000)
          ].join('\n');
          task.workMemory = task.workMemory || { findings: [], sources_status: {} };
          const ev = agentEvidence.addEvidence(task.id, {
            url: data.url || session.url,
            title: data.title || '',
            text: data.text || summary,
            snippet: (data.headings || []).slice(0, 6).join(' · '),
            kind: 'page'
          });
          task.workMemory.findings = (task.workMemory.findings || []).concat([{
            fact: clip(summary, 2500),
            url: data.url || session.url,
            evidenceId: ev.id,
            step: task.history.length
          }]).slice(-30);
          task.workMemory.lastUrl = data.url || session.url;
          const domain = agentEvidence.domainOf(data.url || session.url);
          if (domain) {
            task.workMemory.sources_status = task.workMemory.sources_status || {};
            task.workMemory.sources_status[domain] = { status: 'ok', reason: 'extract_page' };
          }
          return { ok: true, result: '[' + ev.id + '] ' + clip(summary, 6000) };
        }
        return { ok: false, result: (data && data.error) || 'extract_failed' };
      } catch (e) {
        return { ok: false, result: clip(e.message || e, 200) };
      }
    }
    case 'fetch_doc': {
      try {
        const docUrl = String(action.url || '').trim();
        if (!/^https?:/i.test(docUrl)) return { ok: false, result: 'fetch_doc needs http(s) url' };
        await assertSafeUrl(docUrl);
        const undici = global.fetch || (async (url, opt) => {
          const http = require('http');
          const https = require('https');
          const lib = String(url).startsWith('https') ? https : http;
          return new Promise((resolve, reject) => {
            const req = lib.get(url, { headers: (opt && opt.headers) || {}, timeout: 15000 }, (res) => {
              // block redirect to private hosts: re-check location
              if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                const next = res.headers.location;
                assertSafeUrl(next).then(() => {
                  res.resume();
                  reject(new Error('redirect_recheck_required:' + next));
                }).catch((err) => {
                  res.resume();
                  reject(err);
                });
                return;
              }
              const chunks = [];
              res.on('data', (c) => chunks.push(c));
              res.on('end', () => {
                const buf = Buffer.concat(chunks);
                resolve({
                  ok: res.statusCode >= 200 && res.statusCode < 400,
                  status: res.statusCode,
                  headers: { get: (k) => res.headers[String(k).toLowerCase()] },
                  arrayBuffer: async () => buf
                });
              });
            });
            req.on('error', reject);
          });
        });
        const result = await agentTools.fetchDocumentText(docUrl, undici);
        if (result.ok) {
          task.workMemory = task.workMemory || { findings: [] };
          task.workMemory.findings = (task.workMemory.findings || []).concat([{ fact: clip(result.text, 800), url: docUrl, step: task.history.length }]).slice(-20);
          return { ok: true, result: clip((result.kind || 'doc') + ': ' + (result.text || ''), 6000) };
        }
        return { ok: false, result: result.error || 'fetch_doc_failed' };
      } catch (e) {
        return { ok: false, result: clip(e.message || e, 200) };
      }
    }

    
    case 'fetch_feed': {
      try {
        let feedUrl = String(action.url || session.url || '').trim();
        if (!feedUrl) return { ok: false, result: 'fetch_feed needs url' };
        await assertSafeUrl(feedUrl);
        let items = [];
        try {
          const res = await researchTools.safeFetch(feedUrl);
          items = researchTools.parseFeed(res.body, res.url);
          if (!items.length && /html/i.test(res.contentType || '')) {
            const alts = researchTools.discoverFeedLinks(res.body, res.url);
            for (const alt of alts.slice(0, 3)) {
              try {
                const r2 = await researchTools.safeFetch(alt);
                items = researchTools.parseFeed(r2.body, r2.url);
                if (items.length) { feedUrl = r2.url; break; }
              } catch (_) {}
            }
          }
        } catch (e) {
          return { ok: false, result: clip(e.message || e, 200) };
        }
        task.workMemory = task.workMemory || { findings: [], sources_status: {} };
        const lines = [];
        for (const it of items.slice(0, 20)) {
          const ev = agentEvidence.addEvidence(task.id, {
            url: it.url, title: it.title, publishedAt: it.publishedAt,
            snippet: it.summary, text: it.summary, kind: 'feed'
          });
          task.workMemory.findings = (task.workMemory.findings || []).concat([{
            fact: it.title + (it.publishedAt ? ' (' + it.publishedAt + ')' : ''),
            url: it.url, evidenceId: ev.id
          }]).slice(-40);
          lines.push('[' + ev.id + '] ' + it.title + ' | ' + (it.publishedAt || '?') + ' | ' + it.url);
        }
        const domain = agentEvidence.domainOf(feedUrl);
        if (domain) task.workMemory.sources_status[domain] = { status: 'ok', reason: 'feed', count: items.length };
        return { ok: true, result: lines.length ? lines.join('\n') : 'no_feed_items' };
      } catch (e) {
        return { ok: false, result: clip(e.message || e, 200) };
      }
    }
    case 'extract_articles': {
      try {
        const html = session.html || '';
        const pageUrl = session.url || '';
        const list = researchTools.extractArticlesFromHtml(html, pageUrl);
        task.workMemory = task.workMemory || { findings: [] };
        const lines = [];
        for (const it of list.slice(0, 20)) {
          const ev = agentEvidence.addEvidence(task.id, {
            url: it.url, title: it.title, publishedAt: it.time, snippet: it.title, kind: 'article'
          });
          lines.push('[' + ev.id + '] ' + it.title + ' → ' + it.url);
        }
        return { ok: true, result: lines.join('\n') || 'no_articles_found' };
      } catch (e) {
        return { ok: false, result: clip(e.message || e, 200) };
      }
    }
    case 'read_article': {
      try {
        const u = String(action.url || '').trim();
        if (!u) return { ok: false, result: 'read_article needs url' };
        await assertSafeUrl(u);
        const res = await researchTools.safeFetch(u);
        const meta = researchTools.extractArticleMeta(res.body, res.url);
        const ev = agentEvidence.addEvidence(task.id, {
          url: res.url, title: meta.title, publishedAt: meta.publishedAt,
          text: meta.text, snippet: meta.text.slice(0, 400), kind: 'article'
        });
        task.workMemory = task.workMemory || { findings: [], sources_status: {} };
        task.workMemory.findings = (task.workMemory.findings || []).concat([{
          fact: meta.title + (meta.publishedAt ? ' @' + meta.publishedAt : ''),
          url: res.url, evidenceId: ev.id
        }]).slice(-40);
        const domain = agentEvidence.domainOf(res.url);
        if (domain) task.workMemory.sources_status[domain] = { status: 'ok', reason: 'read_article' };
        return {
          ok: true,
          result: '[' + ev.id + '] ' + meta.title + '\n' + (meta.publishedAt || '') + '\n' + researchTools.clip(meta.text, 4000)
        };
      } catch (e) {
        return { ok: false, result: clip(e.message || e, 200) };
      }
    }
    case 'open_many': {
      const urls = Array.isArray(action.urls) ? action.urls.slice(0, 8) : [];
      const lines = [];
      const runOne = async (u) => {
        try {
          await assertSafeUrl(u);
          const res = await researchTools.safeFetch(u);
          const meta = researchTools.extractArticleMeta(res.body, res.url);
          const ev = agentEvidence.addEvidence(task.id, {
            url: res.url, title: meta.title, publishedAt: meta.publishedAt,
            text: meta.text, snippet: meta.text.slice(0, 400), kind: 'article'
          });
          lines.push('[' + ev.id + '] ' + meta.title + ' | ' + (meta.publishedAt || '?') + ' | ' + res.url);
        } catch (e) {
          lines.push('FAIL ' + u + ' ' + String(e.message || e).slice(0, 80));
        }
      };
      // sequential with small batches of 3
      for (let i = 0; i < urls.length; i += 3) {
        await Promise.all(urls.slice(i, i + 3).map(runOne));
      }
      return { ok: lines.some((l) => l.startsWith('[E')), result: lines.join('\n') };
    }
    case 'recall': {
      const hits = agentEvidence.recall(task.id, { query: action.query, id: action.id, url: action.url });
      if (!hits.length) return { ok: true, result: 'no_evidence_match' };
      return {
        ok: true,
        result: hits.map((h) => '[' + h.id + '] ' + h.title + ' | ' + (h.publishedAt || '?') + '\n' + h.snippet + '\n' + h.url).join('\n\n')
      };
    }

    case 'scroll': {
      const current = Number((obs.scroll && obs.scroll.y) || session.scrollY) || 0;
      const delta = 600;
      const y =
        action.direction === 'top'
          ? 0
          : action.direction === 'bottom'
            ? 100000
            : Math.max(0, current + (action.direction === 'up' ? -delta : delta));
      const out = await domBridge.dispatchEvent(session, { type: 'scroll', scrollY: y, scrollX: Number(session.scrollX) || 0 });
      session.scrollY = Number(out.result && out.result.scrollY != null ? out.result.scrollY : y);
      return { ok: !!out.ok, result: 'scrolled ' + action.direction, state: out };
    }
    case 'wait':
      await sleep(Math.min(5000, Math.max(200, action.ms || 1000)));
      return { ok: true, result: 'waited' };
    case 'read':
      task.readOffset = Math.max(0, Number(action.offset) || 0);
      return { ok: true, result: 'read page text at offset ' + task.readOffset };
    case 'note': {
      task.workMemory = task.workMemory || { notes: [] };
      task.workMemory.notes = (task.workMemory.notes || []).concat([String(action.text || action.note || '')]).slice(-20);
      return { ok: true, result: 'noted' };
    }
    case 'back':
    case 'forward': {
      const next = task.urlIndex + (action.type === 'back' ? -1 : 1);
      if (next < 0 || next >= task.urlStack.length) return { ok: false, result: 'no_' + action.type + '_history' };
      task.urlIndex = next;
      const target = task.urlStack[task.urlIndex];
      await assertSafeUrl(target);
      const r = await domBridge.navigate(session, target);
      return { ok: !r.error && r.hasContent !== false, result: action.type + ' to ' + target, state: r };
    }

    case 'tabs': {
      const op = String(action.op || 'list').toLowerCase();
      task.workMemory = task.workMemory || {};
      task.workMemory.agentTabs = task.workMemory.agentTabs || [{ id: 'main', url: session.url || '', title: session.title || '' }];
      const tabs = task.workMemory.agentTabs;
      if (op === 'list') {
        return { ok: true, result: tabs.map((t, i) => (i + 1) + '. [' + t.id + '] ' + (t.title || t.url || '')).join('\n') || '1 tab' };
      }
      if (op === 'new') {
        const id = 't' + Date.now().toString(36);
        tabs.push({ id, url: action.url || 'about:blank', title: '' });
        task.workMemory.activeAgentTab = id;
        if (action.url && isLiveEngine(session) && session.pwSessionId) {
          try {
            const pw = require('./engine/playwright-engine');
            await pw.navigate(session.pwSessionId, action.url);
          } catch (_) {}
        }
        return { ok: true, result: 'opened_tab ' + id };
      }
      if (op === 'switch' || op === 'close') {
        const tid = String(action.tabId || '');
        const idx = tabs.findIndex((t) => t.id === tid);
        if (idx < 0) return { ok: false, result: 'tab_not_found' };
        if (op === 'close') {
          if (tabs.length <= 1) return { ok: false, result: 'cannot_close_last_tab' };
          tabs.splice(idx, 1);
          task.workMemory.activeAgentTab = tabs[0].id;
          return { ok: true, result: 'closed ' + tid };
        }
        task.workMemory.activeAgentTab = tid;
        return { ok: true, result: 'switched ' + tid };
      }
      return { ok: false, result: 'bad_tabs_op' };
    }
    case 'screenshot': {
      if (!isLiveEngine(session) || !session.pwSessionId) {
        return { ok: false, result: 'screenshot_requires_playwright' };
      }
      try {
        const pw = require('./engine/playwright-engine');
        const s = pw.getSession && pw.getSession(session.pwSessionId);
        if (!s || !s.page) return { ok: false, result: 'no_page' };
        const buf = await s.page.screenshot({ type: 'jpeg', quality: 60, fullPage: !!action.fullPage });
        const b64 = buf.toString('base64');
        task.workMemory = task.workMemory || {};
        task.workMemory.lastScreenshot = { at: Date.now(), bytes: buf.length, fullPage: !!action.fullPage };
        // Keep only a short marker in result; vision modules may consume buffer separately
        return { ok: true, result: 'screenshot_ok bytes=' + buf.length, screenshotBase64: b64.slice(0, 0) ? b64 : undefined, _screenshotBytes: buf.length };
      } catch (e) {
        return { ok: false, result: 'screenshot_fail ' + String(e.message || e).slice(0, 120) };
      }
    }
    case 'press_key': {
      const key = String(action.key || 'Enter').slice(0, 40);
      if (isLiveEngine(session) && session.pwSessionId) {
        try {
          const pw = require('./engine/playwright-engine');
          const s = pw.getSession && pw.getSession(session.pwSessionId);
          if (s && s.page) {
            if (action.id != null) {
              // focus element by data-sh-id if possible
              await s.page.evaluate((id) => {
                const el = document.querySelector('[data-sh-id="e' + id + '"], [data-sh-id="' + id + '"], #e' + id);
                if (el && el.focus) el.focus();
              }, action.id).catch(() => {});
            }
            await s.page.keyboard.press(key);
            return { ok: true, result: 'pressed ' + key };
          }
        } catch (e) {
          return { ok: false, result: String(e.message || e).slice(0, 120) };
        }
      }
      // fallback: treat Enter as submit on focused field via type path
      if (key === 'Enter') {
        return { ok: true, result: 'press_enter_fallback', soft: true };
      }
      return { ok: false, result: 'press_key_unavailable' };
    }
    case 'select': {
      const value = String(action.value || action.label || '');
      if (!value) return { ok: false, result: 'value_required' };
      if (isLiveEngine(session) && session.pwSessionId) {
        try {
          const pw = require('./engine/playwright-engine');
          const s = pw.getSession && pw.getSession(session.pwSessionId);
          if (s && s.page) {
            const id = action.id;
            const ok = await s.page.evaluate(({ id, value }) => {
              let el = null;
              if (id != null) el = document.querySelector('[data-sh-id="e' + id + '"], [data-sh-id="' + id + '"], select');
              if (!el) el = document.querySelector('select');
              if (!el) return false;
              const opts = Array.from(el.options || []);
              const match = opts.find((o) => o.value === value || (o.textContent || '').trim() === value || (o.textContent || '').includes(value));
              if (match) {
                el.value = match.value;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }
              return false;
            }, { id, value });
            return { ok: !!ok, result: ok ? 'selected ' + value : 'option_not_found' };
          }
        } catch (e) {
          return { ok: false, result: String(e.message || e).slice(0, 120) };
        }
      }
      return { ok: false, result: 'select_unavailable' };
    }
    case 'hover': {
      if (action.id == null || Number.isNaN(Number(action.id))) return { ok: false, result: 'id_required' };
      if (isLiveEngine(session) && session.pwSessionId) {
        try {
          const pw = require('./engine/playwright-engine');
          const s = pw.getSession && pw.getSession(session.pwSessionId);
          if (s && s.page) {
            const handle = await s.page.$('[data-sh-id="e' + action.id + '"], [data-sh-id="' + action.id + '"]');
            if (handle) {
              await handle.hover();
              return { ok: true, result: 'hovered ' + action.id };
            }
          }
        } catch (e) {
          return { ok: false, result: String(e.message || e).slice(0, 120) };
        }
      }
      return { ok: false, result: 'hover_unavailable' };
    }
    case 'wait_for': {
      const timeout = Math.min(30000, Math.max(500, Number(action.timeoutMs) || 8000));
      const cond = String(action.condition || 'selector').toLowerCase();
      if (isLiveEngine(session) && session.pwSessionId) {
        try {
          const pw = require('./engine/playwright-engine');
          const s = pw.getSession && pw.getSession(session.pwSessionId);
          if (!s || !s.page) return { ok: false, result: 'no_page' };
          if (cond === 'text' && action.text) {
            await s.page.getByText(action.text, { exact: false }).first().waitFor({ timeout });
            return { ok: true, result: 'text_found' };
          }
          if (cond === 'url' && action.url) {
            await s.page.waitForURL(new RegExp(action.url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), { timeout });
            return { ok: true, result: 'url_matched' };
          }
          if (action.selector) {
            await s.page.waitForSelector(action.selector, { timeout });
            return { ok: true, result: 'selector_found' };
          }
          await s.page.waitForLoadState('networkidle', { timeout }).catch(() => {});
          return { ok: true, result: 'network_idle_or_timeout' };
        } catch (e) {
          return { ok: false, result: 'wait_for_timeout ' + String(e.message || e).slice(0, 100) };
        }
      }
      await sleep(Math.min(timeout, 3000));
      return { ok: true, result: 'wait_for_soft' };
    }
    case 'extract_table': {
      if (isLiveEngine(session) && session.pwSessionId) {
        try {
          const agentToolsImpl = require('./agent-tools-impl');
          if (typeof agentToolsImpl.extractTablesFromPlaywrightSession === 'function') {
            const tables = await agentToolsImpl.extractTablesFromPlaywrightSession(
              require('./engine/playwright-engine'), session.pwSessionId, action.index || 0
            );
            return { ok: true, result: JSON.stringify(tables).slice(0, 8000) };
          }
        } catch (e) {
          return { ok: false, result: String(e.message || e).slice(0, 120) };
        }
      }
      return { ok: false, result: 'extract_table_unavailable' };
    }
    case 'extract_form': {
      if (isLiveEngine(session) && session.pwSessionId) {
        try {
          const agentToolsImpl = require('./agent-tools-impl');
          if (typeof agentToolsImpl.extractFormsFromPlaywrightSession === 'function') {
            const forms = await agentToolsImpl.extractFormsFromPlaywrightSession(
              require('./engine/playwright-engine'), session.pwSessionId, action.index || 0
            );
            return { ok: true, result: JSON.stringify(forms).slice(0, 8000) };
          }
        } catch (e) {
          return { ok: false, result: String(e.message || e).slice(0, 120) };
        }
      }
      return { ok: false, result: 'extract_form_unavailable' };
    }
    case 'handle_dialog': {
      if (!session.pwSessionId) return { ok: false, result: 'no_pw_session' };
      try {
        const pw = require('./engine/playwright-engine');
        const dialogs = pw.getPendingDialogs ? pw.getPendingDialogs(session.pwSessionId) : [];
        if (!dialogs.length) return { ok: false, result: 'no_pending_dialog' };
        const d = dialogs[dialogs.length - 1];
        const out = pw.resolveDialog(session.pwSessionId, d.id, action.accept !== false, action.promptText || '');
        return { ok: !!out.ok, result: out.ok ? 'dialog_resolved' : (out.error || 'fail') };
      } catch (e) {
        return { ok: false, result: String(e.message || e).slice(0, 120) };
      }
    }
    case 'save_file': {
      const fs = require('fs');
      const path = require('path');
      const DATA = process.env.SOLOHOST_DATA_DIR || path.join(process.cwd(), 'data');
      const dir = path.join(DATA, 'downloads');
      try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (_) {}
      const name = String(action.filename || 'agent-output.txt').replace(/[^\w.\-]+/g, '_').slice(0, 120);
      const file = path.join(dir, name);
      fs.writeFileSync(file, String(action.content || ''), { mode: 0o600 });
      return { ok: true, result: 'saved ' + name, path: file };
    }



    default:
      return { ok: false, result: 'unsupported_action' };
  }
  };
}

module.exports = { createExecuteAction };
