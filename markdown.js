(function () {
  'use strict';

  function escapeHtml(s) {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderInline(text) {
    let out = escapeHtml(text);
    out = out.replace(/`([^`]+)`/g, (_, c) => `<code>${c}</code>`);
    out = out.replace(
      /\[([^\]]+)\]\(([^)\s]+)\)/g,
      (_, label, href) => {
        const safeHref = href.replace(/"/g, '%22');
        return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${label}</a>`;
      }
    );
    out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    out = out.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    return out;
  }

  function renderMermaidBlock(code) {
    const enc = encodeURIComponent(
      JSON.stringify({ code, mermaid: { theme: 'dark' } })
    );
    const live = `https://mermaid.live/edit#base64:${btoa(unescape(enc))}`;
    return (
      `<pre><code class="lang-mermaid">${escapeHtml(code)}</code></pre>` +
      `<p><a href="${live}" target="_blank" rel="noopener noreferrer">Open in mermaid.live →</a></p>`
    );
  }

  function renderCodeBlock(lang, code) {
    if (lang && lang.toLowerCase() === 'mermaid') return renderMermaidBlock(code);
    const langClass = lang ? ` class="lang-${escapeHtml(lang)}"` : '';
    return `<pre><code${langClass}>${escapeHtml(code)}</code></pre>`;
  }

  function renderMarkdown(md) {
    if (!md) return '';
    const lines = md.replace(/\r\n/g, '\n').split('\n');
    const html = [];
    let i = 0;

    const flushList = (items, ordered) => {
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>` + items.map((it) => `<li>${renderInline(it)}</li>`).join('') + `</${tag}>`);
    };

    while (i < lines.length) {
      const line = lines[i];

      const fence = line.match(/^```(\S*)\s*$/);
      if (fence) {
        const lang = fence[1];
        const buf = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          buf.push(lines[i]);
          i++;
        }
        i++;
        html.push(renderCodeBlock(lang, buf.join('\n')));
        continue;
      }

      if (/^\s*---+\s*$/.test(line)) {
        html.push('<hr/>');
        i++;
        continue;
      }

      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        const level = h[1].length;
        html.push(`<h${level}>${renderInline(h[2].trim())}</h${level}>`);
        i++;
        continue;
      }

      if (/^\s*>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          buf.push(lines[i].replace(/^\s*>\s?/, ''));
          i++;
        }
        html.push(`<blockquote>${renderInline(buf.join(' '))}</blockquote>`);
        continue;
      }

      if (/^\s*[-*+]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*[-*+]\s+/, ''));
          i++;
        }
        flushList(items, false);
        continue;
      }

      if (/^\s*\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
          items.push(lines[i].replace(/^\s*\d+\.\s+/, ''));
          i++;
        }
        flushList(items, true);
        continue;
      }

      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }

      const buf = [line];
      i++;
      while (
        i < lines.length &&
        lines[i].trim() !== '' &&
        !/^(#{1,6})\s+/.test(lines[i]) &&
        !/^```/.test(lines[i]) &&
        !/^\s*[-*+]\s+/.test(lines[i]) &&
        !/^\s*\d+\.\s+/.test(lines[i]) &&
        !/^\s*>\s?/.test(lines[i]) &&
        !/^\s*---+\s*$/.test(lines[i])
      ) {
        buf.push(lines[i]);
        i++;
      }
      html.push(`<p>${renderInline(buf.join(' '))}</p>`);
    }

    return html.join('\n');
  }

  window.renderMarkdown = renderMarkdown;
})();
