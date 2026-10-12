/** Text direction and shape helpers ported from qym_safe.js. */
const ARABIC_LETTERS = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g;

export function isRTL(text: unknown): boolean {
  const value = String(text ?? '');
  const rtl = (value.match(ARABIC_LETTERS) ?? []).length;
  if (!rtl) return false;
  const latin = (value.match(/[A-Za-z]/g) ?? []).length;
  return rtl > latin;
}

export interface TextDirAttrs {
  dir: 'rtl' | 'auto';
  lang?: 'ar';
}

export function textDirAttrs(text: unknown): TextDirAttrs {
  return isRTL(text) ? { dir: 'rtl', lang: 'ar' } : { dir: 'auto' };
}

const SQL_STATEMENT =
  /^[ \t]*(?:select\b(?:[^\n]|\n(?![ \t]*\n)){0,2000}?\bfrom\b|select\b[^\n]{0,2000};[ \t]*$|with\s+(?:recursive\s+)?[\w"`]+\s*(?:\([^)\n]{0,200}\)\s*)?as\s*\(|insert\s+into\b|update\s+[\w."`]+\s+set\s+[\w."`]+\s*=|delete\s+from\b|create\s+(?:table|view|index|or\s+replace)\b|alter\s+table\b|drop\s+(?:table|view|index)\b|explain\s+(?:(?:analyze|verbose)\s+)*(?:select|with|insert|update|delete)\b)/im;
const CODE_LINE =
  /(?:[;{}]\s*$|^\s*(?:def|class|import|from\s+\S+\s+import|function|const|let|var|return|if\s*\(|for\s*\(|while\s*\(|#include|public|private|package)\b|=>|^\s*(?:\/\/|#!|--\s))/;

export function looksLikeCode(text: unknown): boolean {
  const value = String(text ?? '');
  if (!value.trim()) return false;
  if (SQL_STATEMENT.test(value.replace(/```[\s\S]*?```/g, ''))) return true;
  if (/^\s*```/.test(value) && /```\s*$/.test(value)) return true;
  const lines = value.split('\n').filter((l) => l.trim());
  if (lines.length < 2) return false;
  const codeLines = lines.filter((l) => CODE_LINE.test(l)).length;
  const indented = lines.filter((l) => /^(?: {2,}|\t)\S/.test(l)).length;
  return codeLines / lines.length >= 0.5 || (codeLines >= 2 && (codeLines + indented) / lines.length >= 0.6);
}

export type TextMode = 'raw' | 'rendered';
const TEXT_MODE_KEY = 'qym.textMode';

export function getTextMode(): TextMode {
  try {
    const stored = localStorage.getItem(TEXT_MODE_KEY);
    return stored === 'rendered' ? 'rendered' : 'raw';
  } catch {
    return 'raw';
  }
}

export function setTextMode(mode: TextMode): void {
  try {
    localStorage.setItem(TEXT_MODE_KEY, mode);
  } catch {
    /* private mode */
  }
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function safeUrl(value: unknown): string | null {
  const v = String(value ?? '').trim();
  return /^https?:\/\//i.test(v) ? v : null;
}

/**
 * Safe markdown subset (qym_safe.js renderMarkdown): headings, bold, italic,
 * inline code, http(s) links, fenced code. Every text run is escaped.
 */
export function renderMarkdown(text: unknown): string {
  const source = String(text ?? '');
  const parts = source.split(/```/);
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    let part = parts[i] ?? '';
    if (i % 2 === 1 && i < parts.length - 1) {
      const body = part.replace(/^[\w+-]*\n/, '');
      out += `<pre class="qym-text__pre"><code>${escapeHtml(body.replace(/\n$/, ''))}</code></pre>`;
    } else {
      if (i % 2 === 1) out += '```';
      if (i % 2 === 0 && i > 0) part = part.replace(/^\n/, '');
      if (i % 2 === 0 && i + 1 < parts.length - 1) part = part.replace(/\n$/, '');
      out += part
        .split('\n')
        .map((line) => {
          const heading = /^(#{1,6})\s+(.*)$/.exec(line);
          if (heading) return `<strong class="qym-text__heading">${renderInline(heading[2] ?? '')}</strong>`;
          return renderInline(line);
        })
        .join('\n');
    }
  }
  return out;
}

function renderInline(line: string): string {
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(https?:\/\/[^\s<>"')\]]+)/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(line))) {
    out += escapeHtml(line.slice(last, m.index));
    const token = m[0];
    if (m[1]) out += `<code class="qym-text__code">${escapeHtml(token.slice(1, -1))}</code>`;
    else if (m[2]) out += `<strong>${escapeHtml(token.slice(2, -2))}</strong>`;
    else if (m[3]) out += `<em>${escapeHtml(token.slice(1, -1))}</em>`;
    else
      out += `<a class="qym-text__link" href="${escapeHtml(token)}" rel="noopener noreferrer" target="_blank">${escapeHtml(token)}</a>`;
    last = m.index + token.length;
  }
  return out + escapeHtml(line.slice(last));
}
