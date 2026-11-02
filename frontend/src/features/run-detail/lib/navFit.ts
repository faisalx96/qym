/**
 * Which section links fit in the run nav row (RF1, C132). Links keep page order. When they do not all fit, room is
 * kept for the More menu, the links that fit stay in the row and the rest go into More. The active link always
 * stays in the row: it takes the place of the last links that fit.
 */
export interface NavFitOptions {
  /** Width of the row that holds the links. */
  available: number;
  /** Gap between two links. */
  gap: number;
  /** Width of the More trigger. */
  more: number;
  /** Index of the active link, or -1. */
  active: number;
}

function used(widths: number[], shown: boolean[], gap: number): number {
  let sum = 0;
  let count = 0;
  widths.forEach((w, i) => {
    if (!shown[i]) return;
    sum += w;
    count += 1;
  });
  return sum + gap * Math.max(0, count - 1);
}

/** One flag per link: true when the link stays in the row. */
export function fitNavLinks(widths: number[], { available, gap, more, active }: NavFitOptions): boolean[] {
  const all = widths.map(() => true);
  if (used(widths, all, gap) <= available) return all;
  const budget = available - more - gap;
  const shown = widths.map(() => false);
  for (let i = 0; i < widths.length; i += 1) {
    shown[i] = true;
    if (used(widths, shown, gap) > budget) {
      shown[i] = false;
      break;
    }
  }
  if (active >= 0 && active < widths.length && !shown[active]) {
    shown[active] = true;
    for (let i = widths.length - 1; i >= 0 && used(widths, shown, gap) > budget; i -= 1)
      if (i !== active && shown[i]) shown[i] = false;
  }
  return shown;
}
