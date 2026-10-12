/** `{variable}` detection in the additional instructions (reserved: categories). */
const RESERVED = new Set(['categories']);

export function detectCustomVars(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of text.matchAll(/\{(\w+)\}/g)) {
    const name = match[1] ?? '';
    if (!name || RESERVED.has(name) || seen.has(name)) continue;
    seen.add(name);
    out.push(name);
  }
  return out;
}
