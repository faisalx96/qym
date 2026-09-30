/* qym_safe.js: the one HTML-safety layer shared by every dashboard page.
 *
 * Load it first and synchronously, before any other page script; it has no
 * dependencies. Page-local escape helpers delegate here, so there is exactly
 * one escaping rule. Never re-implement escaping with the textContent ->
 * innerHTML trick: it leaves quotes alone and is unsafe inside attributes.
 *
 *   QymSafe.escapeHtml(value)  Escapes & < > " ' so the result is safe both as
 *                              element text and inside a quoted attribute.
 *                              null, undefined and false render as ''.
 *   QymSafe.escapeAttr(value)  Same function; reads better at attribute sites.
 *   QymSafe.html`<b>${v}</b>`  Tagged template that escapes every interpolation
 *                              unless it is another html`` result or raw(...).
 *                              Arrays are rendered item by item. The result
 *                              stringifies, so `el.innerHTML = html`...`` works.
 *   QymSafe.raw(markup)        Marks trusted markup (icons, builder output).
 *   QymSafe.safeUrl(url)       The URL when it is http(s), mailto or relative;
 *                              '' for javascript:, data: and anything else.
 *
 * Run text (inputs, expected and model outputs) is shown as preformatted text
 * by default, with an opt-in "Rendered" markdown view:
 *
 *   QymSafe.textBlock(text)    Markup for one text value in the current mode.
 *   QymSafe.renderMarkdown(t)  The safe markdown subset used by Rendered mode.
 *   QymSafe.looksLikeCode(t)   True for SQL/code; such text is never rewritten.
 *   QymSafe.getTextMode() / setTextMode(mode) / bindTextModeToggle(group, cb)
 */
(function (global) {
  'use strict';

  var ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

  function escapeHtml(value) {
    if (value === null || value === undefined || value === false) return '';
    return String(value).replace(/[&<>"']/g, function (ch) { return ESCAPES[ch]; });
  }

  function SafeHtml(markup) { this.__qymSafeHtml = markup; }
  SafeHtml.prototype.toString = function () { return this.__qymSafeHtml; };

  function raw(markup) {
    if (markup instanceof SafeHtml) return markup;
    return new SafeHtml(markup === null || markup === undefined ? '' : String(markup));
  }

  function interpolate(value) {
    if (value instanceof SafeHtml) return value.__qymSafeHtml;
    if (Array.isArray(value)) return value.map(interpolate).join('');
    return escapeHtml(value);
  }

  function html(strings) {
    var out = strings[0];
    for (var i = 1; i < strings.length; i++) {
      out += interpolate(arguments[i]) + strings[i];
    }
    return new SafeHtml(out);
  }

  function safeUrl(url) {
    var value = String(url === null || url === undefined ? '' : url).trim();
    if (!value) return '';
    // Browsers ignore tabs/newlines inside a scheme ("java\nscript:"), so do we.
    var compact = value.replace(/[\u0000- ]+/g, '');
    var scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(compact);
    if (!scheme) return value;
    return /^(https?|mailto)$/i.test(scheme[1]) ? value : '';
  }

  // ── Run text: Raw (default) / Rendered ────────────────────────────────

  var TEXT_MODE_KEY = 'qym.textMode';
  var TEXT_MODES = { raw: true, rendered: true };
  var currentTextMode = null;

  function getTextMode() {
    if (currentTextMode) return currentTextMode;
    var stored = null;
    try { stored = global.localStorage && global.localStorage.getItem(TEXT_MODE_KEY); } catch (_) { stored = null; }
    currentTextMode = TEXT_MODES[stored] ? stored : 'raw';
    return currentTextMode;
  }

  function setTextMode(mode) {
    currentTextMode = TEXT_MODES[mode] ? mode : 'raw';
    try { if (global.localStorage) global.localStorage.setItem(TEXT_MODE_KEY, currentTextMode); } catch (_) { /* private mode */ }
    return currentTextMode;
  }

  // A SQL statement at the start of any line, so a query after a short intro
  // ("Here is the query:\nSELECT a.*, b.* FROM ...") is code as well. Keywords
  // that also open English sentences (select, with, update, explain) count only
  // with SQL structure after them: "With the given data, ..." stays prose.
  // Scans are bounded so long outputs stay linear.
  var SQL_STATEMENT = /^[ \t]*(?:select\b(?:[^\n]|\n(?![ \t]*\n)){0,2000}?\bfrom\b|select\b[^\n]{0,2000};[ \t]*$|with\s+(?:recursive\s+)?[\w"`]+\s*(?:\([^)\n]{0,200}\)\s*)?as\s*\(|insert\s+into\b|update\s+[\w."`]+\s+set\s+[\w."`]+\s*=|delete\s+from\b|create\s+(?:table|view|index|or\s+replace)\b|alter\s+table\b|drop\s+(?:table|view|index)\b|explain\s+(?:(?:analyze|verbose)\s+)*(?:select|with|insert|update|delete)\b)/im;
  var CODE_LINE = /(?:[;{}]\s*$|^\s*(?:def|class|import|from\s+\S+\s+import|function|const|let|var|return|if\s*\(|for\s*\(|while\s*\(|#include|public|private|package)\b|=>|^\s*(?:\/\/|#!|--\s))/;

  function looksLikeCode(text) {
    var value = String(text === null || text === undefined ? '' : text);
    if (!value.trim()) return false;
    // Fenced blocks are kept verbatim by Rendered mode, so only unfenced SQL counts.
    if (SQL_STATEMENT.test(value.replace(/```[\s\S]*?```/g, ''))) return true;
    if (/^\s*```/.test(value) && /```\s*$/.test(value)) return true;
    var lines = value.split('\n').filter(function (line) { return line.trim(); });
    if (lines.length < 2) return false;
    var codeLines = lines.filter(function (line) { return CODE_LINE.test(line); }).length;
    var indented = lines.filter(function (line) { return /^(?: {2,}|\t)\S/.test(line); }).length;
    return codeLines / lines.length >= 0.5 || (codeLines >= 2 && (codeLines + indented) / lines.length >= 0.6);
  }

  // Inline markdown on raw text. Every text run is escaped on the way out, so
  // nothing in the source can become markup; links are http(s) only.
  var INLINE = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^()\s]+)\)|\*\*(?=\S)([^\n]*?\S)\*\*|(^|[^\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?![\w*])/g;

  function renderInline(text, depth) {
    var out = '';
    var last = 0;
    var match;
    var source = String(text);
    var matches = [];
    // Collect first: the recursion below reuses the same global regex.
    INLINE.lastIndex = 0;
    while ((match = INLINE.exec(source)) !== null) {
      matches.push({ index: match.index, end: INLINE.lastIndex, m: match.slice() });
    }
    for (var i = 0; i < matches.length; i++) {
      var item = matches[i];
      var m = item.m;
      out += escapeHtml(source.slice(last, item.index));
      if (m[1] !== undefined) {
        out += '<code class="qym-text__code">' + escapeHtml(m[1]) + '</code>';
      } else if (m[2] !== undefined) {
        var href = /^https?:\/\//i.test(m[3]) ? safeUrl(m[3]) : '';
        out += href
          ? '<a class="qym-text__link" href="' + escapeHtml(href) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(m[2]) + '</a>'
          : escapeHtml(m[0]);
      } else if (m[4] !== undefined) {
        out += '<strong>' + (depth < 2 ? renderInline(m[4], depth + 1) : escapeHtml(m[4])) + '</strong>';
      } else {
        out += escapeHtml(m[5]) + '<em>' + (depth < 2 ? renderInline(m[6], depth + 1) : escapeHtml(m[6])) + '</em>';
      }
      last = item.end;
    }
    return out + escapeHtml(source.slice(last));
  }

  function renderMarkdown(text) {
    var source = String(text === null || text === undefined ? '' : text);
    var parts = source.split(/```/);
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      if (i % 2 === 1 && i < parts.length - 1) {
        // Fenced block: drop an optional language tag line, keep the rest verbatim.
        var body = part.replace(/^[\w+-]*\n/, '');
        out += '<pre class="qym-text__pre"><code>' + escapeHtml(body.replace(/\n$/, '')) + '</code></pre>';
      } else {
        // An unclosed fence stays literal text.
        if (i % 2 === 1) out += '```';
        // A fenced block is its own line; drop the newlines that frame it.
        if (i % 2 === 0 && i > 0) part = part.replace(/^\n/, '');
        if (i % 2 === 0 && i + 1 < parts.length - 1) part = part.replace(/\n$/, '');
        out += part.split('\n').map(function (line) {
          var heading = /^(#{1,6})\s+(.*)$/.exec(line);
          if (heading) return '<strong class="qym-text__heading">' + renderInline(heading[2], 0) + '</strong>';
          return renderInline(line, 0);
        }).join('\n');
      }
    }
    return out;
  }

  function textBlock(text, options) {
    var value = String(text === null || text === undefined ? '' : text);
    var opts = options || {};
    var mode = opts.mode || getTextMode();
    var code = looksLikeCode(value);
    var cls = 'qym-text ' + (code ? 'qym-text--code' : 'qym-text--prose') + (opts.className ? ' ' + opts.className : '');
    var dir = opts.dir ? ' dir="' + escapeHtml(opts.dir) + '"' : '';
    var body = (mode === 'rendered' && !code) ? renderMarkdown(value) : escapeHtml(value);
    return '<div class="' + escapeHtml(cls) + '" data-qym-text-mode="' + (mode === 'rendered' && !code ? 'rendered' : 'raw') + '"' + dir + '>' + body + '</div>';
  }

  // Wires a `.qym-segmented` group whose buttons carry data-qym-text-mode.
  function bindTextModeToggle(group, onChange) {
    if (!group || group.__qymTextModeBound) return;
    group.__qymTextModeBound = true;
    function sync() {
      var mode = getTextMode();
      Array.prototype.forEach.call(group.querySelectorAll('[data-qym-text-mode]'), function (button) {
        var active = button.getAttribute('data-qym-text-mode') === mode;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
    group.addEventListener('click', function (event) {
      var button = event.target && event.target.closest ? event.target.closest('[data-qym-text-mode]') : null;
      if (!button || !group.contains(button)) return;
      var next = button.getAttribute('data-qym-text-mode');
      if (next === getTextMode()) return;
      setTextMode(next);
      sync();
      if (typeof onChange === 'function') onChange(getTextMode());
    });
    sync();
  }

  global.QymSafe = {
    escapeHtml: escapeHtml,
    escapeAttr: escapeHtml,
    html: html,
    raw: raw,
    safeUrl: safeUrl,
    looksLikeCode: looksLikeCode,
    renderMarkdown: renderMarkdown,
    textBlock: textBlock,
    getTextMode: getTextMode,
    setTextMode: setTextMode,
    bindTextModeToggle: bindTextModeToggle,
  };
})(typeof window !== 'undefined' ? window : this);
