/**
 * "detailed_reasoning_trace" -> "Detailed reasoning trace"; "judgeModel" -> "Judge model"; "latency-ms" -> "Latency ms".
 * Underscores, hyphens and camelCase boundaries become spaces, the first letter is capitalised, the rest keeps its case
 * (acronyms survive). Keys with no Latin letters (Arabic) are returned untouched.
 */
export function humanizeKey(key: string): string {
  if (!/[A-Za-z]/.test(key)) return key;
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])(?=[a-z])/g, (_m, a: string, b: string) => `${a} ${b.toLowerCase()}`)
    .replace(/\s+/g, ' ')
    .trim();
  if (!spaced) return key;
  const lowered = /^[A-Z0-9 ]+$/.test(spaced) ? spaced.toLowerCase() : spaced;
  return lowered.charAt(0).toUpperCase() + lowered.slice(1);
}
