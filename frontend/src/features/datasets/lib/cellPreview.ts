/**
 * Item text cells in the items table, by row density (cv4 E1): compact shows one line, regular two, and comfortable
 * up to five, with each field of a structured value on its own line so the taller row shows more of the item.
 */
import { promptPreview } from '@/ui';

export type RowDensity = 'compact' | 'regular' | 'comfortable';

/** Text lines a cell shows at each density. */
export const DENSITY_LINES: Record<RowDensity, number> = { compact: 1, regular: 2, comfortable: 5 };

const COMFORTABLE_MAX = 800;

function fieldText(value: unknown): string {
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim();
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * The text of an item cell. Compact and regular keep the one-line preview (the main prompt first, then the other
 * fields after " · "); comfortable puts each field of an object, or each chat message, on its own line.
 */
export function cellPreviewText(value: unknown, density: RowDensity): string {
  if (density !== 'comfortable') return promptPreview(value);
  let data: unknown = value;
  if (typeof value === 'string') {
    const t = value.trim();
    if (t.startsWith('{') || t.startsWith('[')) {
      try {
        data = JSON.parse(t);
      } catch {
        data = value;
      }
    }
  }
  let text: string;
  if (Array.isArray(data)) {
    text = data
      .map((m) =>
        m && typeof m === 'object' && !Array.isArray(m) && 'content' in m
          ? `${String((m as Record<string, unknown>).role ?? 'message')}: ${fieldText((m as Record<string, unknown>).content)}`
          : fieldText(m),
      )
      .join('\n');
  } else if (data && typeof data === 'object') {
    text = Object.entries(data as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${fieldText(v)}`)
      .join('\n');
  } else {
    text = typeof data === 'string' ? data.trim() : promptPreview(data);
  }
  return text.length > COMFORTABLE_MAX ? `${text.slice(0, COMFORTABLE_MAX - 1)}…` : text;
}
