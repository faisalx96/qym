/**
 * Mirrors `_slugify` in api/datasets.py: letters and digits of every script
 * stay, combining marks stay with their letter, everything else collapses to
 * one `-`. '' means the server generates a unique fallback.
 */
export const MAX_SLUG_LENGTH = 120;

export function slugifyDatasetName(value: string): string {
  const text = String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase();
  const chars: string[] = [];
  for (const ch of text) {
    const last = chars[chars.length - 1];
    if (/[\p{L}\p{N}]/u.test(ch)) chars.push(ch);
    else if (/\p{M}/u.test(ch) && chars.length && last !== '-') chars.push(ch);
    else if (chars.length && last !== '-') chars.push('-');
  }
  return chars
    .slice(0, MAX_SLUG_LENGTH)
    .join('')
    .replace(/^-+|-+$/g, '');
}

export function nextVersionAfter(version: string | null | undefined): string | null {
  const m = /^v(\d+)$/.exec(String(version ?? ''));
  return m ? `v${parseInt(m[1] ?? '0', 10) + 1}` : null;
}
