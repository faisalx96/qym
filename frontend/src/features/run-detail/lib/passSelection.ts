/** Which passes an item shows side by side (round 3 P5): at most three, never none, the oldest pick yields to a new one. */

export const MAX_SHOWN_PASSES = 3;

/** Passes 1, 2, 3 (or all when there are fewer). */
export function defaultSelection(total: number): number[] {
  return Array.from({ length: Math.min(MAX_SHOWN_PASSES, Math.max(0, total)) }, (_, i) => i + 1);
}

/**
 * Toggle one pass. `selected` is in selection order (oldest first). Removing the last one is ignored; selecting a pass
 * beyond `limit` drops the oldest selection.
 */
export function togglePass(selected: number[], pass: number, limit = MAX_SHOWN_PASSES): number[] {
  if (selected.includes(pass)) return selected.length > 1 ? selected.filter((p) => p !== pass) : selected;
  const next = [...selected, pass];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** The selected passes in display order. */
export const shownPasses = (selected: number[]): number[] => [...selected].sort((a, b) => a - b);
