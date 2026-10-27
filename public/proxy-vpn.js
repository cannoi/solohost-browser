(function () {
  'use strict';
  function $(id) { return document.getElementById(id); }
  function lang() {
    try { return (localStorage.getItem('solohost_lang') || document.documentElement.lang || 'en').toLowerCase().startsWith('vi') ? 'vi' : 'en'; }
    catch (_) { return 'en'; }
  }
  function t(key) {
    const vi = lang() === 'vi';
    const map = {
      title: vi ? 'Kết nối an toàn' : 'Secure connection',
      disconnected: vi ? 'Chưa kết nối' : 'Disconnected',
      connecting: vi ? 'Đang kết nối…' : 'Connecting…',
      connected: vi ? 'Đã kết nối' : 'Connected',
      direct: vi ? 'Kết nối trực tiếp' : 'Direct connection',
      viaProxy: vi ? 'Qua proxy của bạn' : 'Via your proxy',
      ip: 'IP', location: vi ? 'Vị trí' : 'Location', latency: vi ? 'Độ trễ' : 'Latency',
      proxy: 'Proxy', quick: vi ? 'Kết nối nhanh' : 'Quick connect', test: vi ? 'Kiểm tra' : 'Test',
      save: vi ? 'Lưu proxy' : 'Save proxy', del: vi ? 'Xóa' : 'Delete',
      adv: vi ? 'Thêm / sửa proxy' : 'Add / edit proxy',
      note: vi ? 'Dùng máy chủ proxy của bạn — không phải VPN có sẵn. Không vượt CAPTCHA hay đảm bảo đăng nhập Google.' : 'Uses your proxy server — not a built-in VPN. Does not bypass CAPTCHA or guarantee login success.',
      none: vi ? '— Chưa có proxy —' : '— No proxy yet —', saved: vi ? 'Đã lưu' : 'Saved', failed: vi ? 'Thất bại' : 'Failed', testing: vi ? 'Đang kiểm tra…' : 'Testing…'
    };
    return map[key] || key;
  }
  let state = null, busy = false;
  async function api(path, opts) {
    const r = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(opts && opts.headers || {}) }, ...opts });
    const j = await r.json().catch(() => ({}));
    if (!r.ok && !j.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  }
  function applyI18n() {
    const set = (id, key) => { const el = $(id); if (el) el.textContent = t(key); };
    ['vpn-title:title','vpn-ip-k:ip','vpn-loc-k:location','vpn-lat-k:latency','vpn-proxy-label:proxy','vpn-quick:quick','vpn-test:test','vpn-save:save','vpn-delete:del','vpn-adv-sum:adv','vpn-note:note'].forEach(pair => {
      const [id, key] = pair.split(':'); set(id, key);
    });
  }
  function fillSelect(entries, activeId) {
    const sel = $('vpn-entry-select'); if (!sel) return;
    const cur = sel.value; sel.innerHTML = '';
    if (!entries || !entries.length) { const o = document.createElement('option'); o.value = ''; o.textContent = t('none'); sel.appendChild(o); return; }
    entries.forEach(e => {
      const o = document.createElement('option'); o.value = e.id;
      o.textContent = (e.name || e.host) + ' · ' + e.protocol + '://' + e.host + ':' + e.port + (e.location ? ' · ' + e.location : '');
      sel.appendChild(o);
    });
    sel.value = activeId || cur || entries[0].id;
  }
  function render(st) {
    state = st; const status = (st && st.lastStatus) || {}; const s = status.state || 'DISCONNECTED';
    const dot = $('vpn-dot'); if (dot) dot.setAttribute('data-state', s);
    const on = s === 'CONNECTED' && st && st.enabled;
    const toggle = $('vpn-toggle'); if (toggle) { toggle.setAttribute('aria-pressed', on ? 'true' : 'false'); toggle.textContent = on ? 'ON' : 'OFF'; }
    const btn = $('btn-vpn'); if (btn) btn.setAttribute('data-on', on ? '1' : '0');
    const label = $('vpn-state-label');
    if (label) label.textContent = s === 'CONNECTED' ? t('connected') : s === 'CONNECTING' ? t('connecting') : s === 'DISCONNECTED' ? t('disconnected') : (st.statusMessage || s);
    const sub = $('vpn-sub-label'); if (sub) sub.textContent = on ? t('viaProxy') : (st.statusMessage || t('direct'));
    if ($('vpn-ip')) $('vpn-ip').textContent = status.publicIp || '—';
    if ($('vpn-loc')) $('vpn-loc').textContent = status.location || '—';
    if ($('vpn-lat')) $('vpn-lat').textContent = status.latencyMs != null ? (status.latencyMs + ' ms') : '—';
    fillSelect(st.entries || [], st.activeId);
    if ($('vpn-diag')) $('vpn-diag').textContent = st.statusMessage || (status.message || '');
  }
  async function refresh() {
    try { render(await api('/api/proxy/status?lang=' + encodeURIComponent(lang()))); }
    catch (e) { if ($('vpn-diag')) $('vpn-diag').textContent = e.message || String(e); }
  }
  function openPanel() { applyI18n(); const ov = $('vpn-overlay'); if (ov) ov.hidden = false; const btn = $('btn-vpn'); if (btn) btn.setAttribute('aria-expanded', 'true'); refresh(); }
  function closePanel() { const ov = $('vpn-overlay'); if (ov) ov.hidden = true; const btn = $('btn-vpn'); if (btn) btn.setAttribute('aria-expanded', 'false'); }
  async function connectSelected() {
    if (busy) return; const id = $('vpn-entry-select') && $('vpn-entry-select').value;
    if (!id) { if ($('vpn-diag')) $('vpn-diag').textContent = lang() === 'vi' ? 'Hãy thêm proxy trước' : 'Add a proxy first'; const adv = $('vpn-advanced'); if (adv) adv.open = true; return; }
    busy = true; if ($('vpn-diag')) $('vpn-diag').textContent = t('connecting');
    try { render(await api('/api/proxy/connect', { method: 'POST', body: JSON.stringify({ id, lang: lang() }) })); }
    catch (e) { if ($('vpn-diag')) $('vpn-diag').textContent = e.message || t('failed'); }
    finally { busy = false; }
  }
  async function disconnect() {
    if (busy) return; busy = true;
    try { render(await api('/api/proxy/disconnect', { method: 'POST', body: JSON.stringify({ lang: lang() }) })); }
    catch (e) { if ($('vpn-diag')) $('vpn-diag').textContent = e.message || t('failed'); }
    finally { busy = false; }
  }
  async function toggle() { const on = $('vpn-toggle') && $('vpn-toggle').getAttribute('aria-pressed') === 'true'; if (on) await disconnect(); else await connectSelected(); }
  function formBody() {
    return { name: ($('vpn-name') && $('vpn-name').value) || '', provider: ($('vpn-provider') && $('vpn-provider').value) || 'custom', protocol: ($('vpn-protocol') && $('vpn-protocol').value) || 'http', host: ($('vpn-host') && $('vpn-host').value) || '', port: Number(($('vpn-port') && $('vpn-port').value) || 0), username: ($('vpn-user') && $('vpn-user').value) || '', password: ($('vpn-pass') && $('vpn-pass').value) || undefined, location: ($('vpn-location') && $('vpn-location').value) || '', id: window.__vpnEditId || undefined };
  }
  async function testProxy() {
    if (busy) return; busy = true; if ($('vpn-diag')) $('vpn-diag').textContent = t('testing');
    try {
      const id = $('vpn-entry-select') && $('vpn-entry-select').value;
      const r = await api('/api/proxy/test', { method: 'POST', body: JSON.stringify(id ? { id } : formBody()) });
      if ($('vpn-diag')) $('vpn-diag').textContent = r.ok ? ('OK · IP ' + (r.publicIp || '?') + (r.latencyMs != null ? ' · ' + r.latencyMs + ' ms' : '')) : (r.message || r.errorCode || t('failed'));
      if (r.publicIp && $('vpn-ip')) $('vpn-ip').textContent = r.publicIp;
      if (r.latencyMs != null && $('vpn-lat')) $('vpn-lat').textContent = r.latencyMs + ' ms';
    } catch (e) { if ($('vpn-diag')) $('vpn-diag').textContent = e.message || t('failed'); }
    finally { busy = false; }
  }
  async function saveProxy() {
    if (busy) return; busy = true;
    try {
      const st = await api('/api/proxy/entries', { method: 'POST', body: JSON.stringify(formBody()) });
      window.__vpnEditId = null; if ($('vpn-pass')) $('vpn-pass').value = ''; if ($('vpn-delete')) $('vpn-delete').hidden = true;
      render(st); if ($('vpn-diag')) $('vpn-diag').textContent = t('saved');
    } catch (e) { if ($('vpn-diag')) $('vpn-diag').textContent = e.message || t('failed'); }
    finally { busy = false; }
  }
  async function deleteProxy() {
    const id = window.__vpnEditId || ($('vpn-entry-select') && $('vpn-entry-select').value);
    if (!id || busy) return; busy = true;
    try { render(await api('/api/proxy/entries/' + encodeURIComponent(id), { method: 'DELETE' })); window.__vpnEditId = null; }
    catch (e) { if ($('vpn-diag')) $('vpn-diag').textContent = e.message || t('failed'); }
    finally { busy = false; }
  }
  function loadEntryIntoForm(id) {
    if (!state || !state.entries) return;
    const e = state.entries.find(x => x.id === id); if (!e) return;
    window.__vpnEditId = e.id;
    if ($('vpn-name')) $('vpn-name').value = e.name || '';
    if ($('vpn-provider')) $('vpn-provider').value = e.provider || 'custom';
    if ($('vpn-protocol')) $('vpn-protocol').value = e.protocol || 'http';
    if ($('vpn-host')) $('vpn-host').value = e.host || '';
    if ($('vpn-port')) $('vpn-port').value = e.port || '';
    if ($('vpn-user')) $('vpn-user').value = '';
    if ($('vpn-pass')) $('vpn-pass').value = '';
    if ($('vpn-location')) $('vpn-location').value = e.location || '';
    if ($('vpn-delete')) $('vpn-delete').hidden = false;
    const adv = $('vpn-advanced'); if (adv) adv.open = true;
  }
  function bind() {
    ['btn-vpn', 'btn-vpn-menu'].forEach(id => {
      const el = $(id); if (!el) return;
      el.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); openPanel(); try { const m = $('settings-menu'); if (m) m.hidden = true; } catch (_) {} });
    });
    if ($('vpn-close')) $('vpn-close').addEventListener('click', closePanel);
    if ($('vpn-overlay')) $('vpn-overlay').addEventListener('click', e => { if (e.target === $('vpn-overlay')) closePanel(); });
    if ($('vpn-toggle')) $('vpn-toggle').addEventListener('click', toggle);
    if ($('vpn-quick')) $('vpn-quick').addEventListener('click', connectSelected);
    if ($('vpn-test')) $('vpn-test').addEventListener('click', testProxy);
    if ($('vpn-refresh')) $('vpn-refresh').addEventListener('click', refresh);
    if ($('vpn-save')) $('vpn-save').addEventListener('click', saveProxy);
    if ($('vpn-delete')) $('vpn-delete').addEventListener('click', deleteProxy);
    if ($('vpn-entry-select')) $('vpn-entry-select').addEventListener('change', () => { const id = $('vpn-entry-select').value; if (id) loadEntryIntoForm(id); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { bind(); refresh(); });
  else { bind(); refresh(); }
  window.SoloHostVpn = { open: openPanel, close: closePanel, refresh };
})();
