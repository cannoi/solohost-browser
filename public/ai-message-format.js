'use strict';
(function (root, factory) {
  const format = factory();
  if (typeof module === 'object' && module.exports) module.exports = format;
  if (root) root.SoloAIMessageFormat = format;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function decodeEntity(_match, entity) {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'" };
    if (Object.prototype.hasOwnProperty.call(named, entity)) return named[entity];
    const numeric = entity[0] === '#';
    if (!numeric) return '&' + entity + ';';
    const hex = entity[1] === 'x' || entity[1] === 'X';
    const code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
    if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
      return '\uFFFD';
    }
    return String.fromCodePoint(code);
  }

  function normalizeMessageText(value) {
    return String(value == null ? '' : value)
      .replace(/\r\n?/g, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z][a-z0-9]+);/gi, decodeEntity)
      .replace(/<br\s*\/?>/gi, '\n');
  }

  function format(raw) {
    const safeHref = (value) => {
      try {
        const url = new URL(String(value || '').trim());
        return /^https?:$/.test(url.protocol) ? url.href : '';
      } catch (_) { return ''; }
    };
    let text = normalizeMessageText(raw);
    const codeBlocks = [];
    text = text.replace(/```(?:[\w+-]+)?\n?([\s\S]*?)```/g, (_, code) => {
      const index = codeBlocks.push('<pre class="agent-code-block"><code>' +
        escapeHtml(code.replace(/^\n+|\n+$/g, '')) + '</code></pre>') - 1;
      return '\u0000CODE' + index + '\u0000';
    });

    const lines = text.split('\n');
    const output = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1])) {
        const rows = [line]; i += 2;
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
        i--;
        const cells = (row) => row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
        const head = cells(rows[0]);
        let html = '<div class="agent-md-table-wrap" style="overflow-x:auto"><table class="agent-md-table"><thead><tr>' +
          head.map(cell => '<th>' + escapeHtml(cell) + '</th>').join('') + '</tr></thead><tbody>';
        rows.slice(1).forEach(row => {
          html += '<tr>' + cells(row).map(cell => '<td>' + escapeHtml(cell) + '</td>').join('') + '</tr>';
        });
        output.push(html + '</tbody></table></div>');
        continue;
      }

      let html = escapeHtml(line);
      html = html.replace(/^###\s+(.+)$/, '<h4 class="agent-h">$1</h4>')
        .replace(/^##\s+(.+)$/, '<h3 class="agent-h">$1</h3>')
        .replace(/^#\s+(.+)$/, '<h2 class="agent-h">$1</h2>');
      html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/`([^`\n]+)`/g, '<code>$1</code>');
      html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+(?:\([^\s)]*\)[^\s)]*)?)\)/g,
        (_, label, href) => {
          const clean = safeHref(href);
          return clean ? '<a class="agent-link" href="' + escapeHtml(clean) +
            '" target="_blank" rel="noopener noreferrer">' + label + '</a>' : label;
        });
      html = html.replace(/https?:\/\/[^\s<]+/g, (token) => {
        let url = token;
        while (/[.,;:!?]$/.test(url)) url = url.slice(0, -1);
        while (url.endsWith(')') && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
          url = url.slice(0, -1);
        }
        const clean = safeHref(url);
        if (!clean) return token;
        return '<a class="agent-link" href="' + escapeHtml(clean) +
          '" target="_blank" rel="noopener noreferrer">' + escapeHtml(url) + '</a>' + escapeHtml(token.slice(url.length));
      });
      if (/^\s*[-*]\s+/.test(line)) html = '• ' + html.replace(/^\s*[-*]\s+/, '');
      else if (/^\s*\d+[.)]\s+/.test(line)) html = html.replace(/^\s*(\d+[.)])\s+/, '$1 ');
      output.push(html || '<br>');
    }
    return output.join('<br>').replace(/\u0000CODE(\d+)\u0000/g, (_, index) => codeBlocks[Number(index)] || '');
  }

  return { format, normalizeMessageText };
});
