/**
 * Item field values: the stored type tag, the Text/JSON editing contract
 * (strings are never coerced; JSON mode parses explicitly), previews.
 */
export type StoredType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

export function storedType(value: unknown): StoredType {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  const t = typeof value;
  if (t === 'string') return 'string';
  if (t === 'number') return 'number';
  if (t === 'boolean') return 'boolean';
  return 'object';
}

export type EditorMode = 'text' | 'json';

/** Initial editor mode for a stored value: strings edit as text, everything else as JSON. */
export function defaultMode(value: unknown): EditorMode {
  return typeof value === 'string' ? 'text' : 'json';
}

/** Editor text for a stored value in a mode. */
export function valueToEditorText(value: unknown, mode: EditorMode): string {
  if (mode === 'text') return typeof value === 'string' ? value : value == null ? '' : formatJson(value);
  return formatJson(value);
}

export function formatJson(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch {
    return String(value);
  }
}

export interface ParsedEditor {
  ok: boolean;
  value?: unknown;
  error?: string;
}

/** Editor text → value. Text mode is always the string as typed; JSON mode must parse. */
export function editorTextToValue(text: string, mode: EditorMode): ParsedEditor {
  if (mode === 'text') return { ok: true, value: text };
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(trimmed) };
  } catch (e) {
    return { ok: false, error: (e as Error).message.replace(/^JSON\.parse: /, '') };
  }
}

/** Sniff whether a typed value looks like JSON ("Add item" dialog: `{`, `[`, `"`, true/false/null, numbers). */
export function sniffJson(text: string): unknown {
  const t = text.trim();
  if (!t) return text;
  if (/^[[{"]/.test(t) || /^(true|false|null)$/.test(t) || /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(t)) {
    try {
      return JSON.parse(t);
    } catch {
      return text;
    }
  }
  return text;
}

/** Deep structural equality for touched-field detection (\r\n normalised for strings). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string')
    return a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

/** One-line preview of any value for table cells. */
export function previewValue(value: unknown, max = 160): string {
  let s: string;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') s = value;
  else {
    try {
      s = JSON.stringify(value) ?? '';
    } catch {
      s = String(value);
    }
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export function pluralize(n: number, noun: string, plural = `${noun}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? noun : plural}`;
}

export function formatDate(iso: string | null | undefined, opts: 'date' | 'datetime' = 'datetime'): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return opts === 'date'
    ? d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    : d.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso);
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return formatDate(iso, 'date');
}

/** UUID-like item ids read as `Item #n` in compare lists. */
export function itemIdentity(itemId: string, index: number | null | undefined): string {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(itemId) && index != null)
    return `Item #${index}`;
  return itemId;
}
