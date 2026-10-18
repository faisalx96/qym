/** Pure label rules of the bar plot (round 3 P1): which axis labels show, how a count is written. */

/** Gap between two columns of a bar plot (CSS px). */
export const COLUMN_GAP = 4;

/** Rough width of one mono character at `--font-sm` (px). */
export const CHAR_PX = 7;

/** Column pitch (column width plus gap) for `n` columns in a plot `width` px wide. */
export function columnPitch(n: number, width: number): number {
  if (n <= 0) return width + COLUMN_GAP;
  return (width - COLUMN_GAP * (n - 1)) / n + COLUMN_GAP;
}

/** Show the label of every k-th column (0, k, 2k ...): the smallest k whose labels do not touch (round 5 R1). */
export function labelEvery(pitch: number, labelWidth: number): number {
  if (!Number.isFinite(pitch) || pitch <= 0) return 1;
  return Math.max(1, Math.ceil(labelWidth / pitch));
}

/** Which axis labels are shown: every k-th, k from the longest label; column 0 is always shown. */
export function axisLabelShown(labels: string[], width: number): boolean[] {
  const longest = labels.reduce((m, l) => Math.max(m, l.length), 0);
  const every = labelEvery(columnPitch(labels.length, width), longest * CHAR_PX + 6);
  return labels.map((_, i) => i % every === 0);
}

/** Counts of two or more digits in columns narrower than the text: the plot raises every second count one tier. */
export function isDenseCounts(pitch: number, digits: number): boolean {
  return pitch < digits * CHAR_PX + 2;
}

/** `1234` -> `1.2k` (and `12000` -> `12k`) when the plain text would be wider than the column; other counts stay whole. */
export function abbreviateCount(count: number, columnWidth: number = Infinity): string {
  const plain = String(count);
  if (count < 1000 || plain.length * CHAR_PX <= columnWidth) return plain;
  const k = count / 1000;
  return `${k < 10 ? (Math.round(k * 10) / 10).toString() : Math.round(k).toString()}k`;
}

/**
 * The text printed on top of a bar. A score histogram prints nothing for an empty bucket (`zero: 'hide'`);
 * pass/fail bars and "Passes passed" print `0` (`zero: 'show'`) because "nobody always fails" is information.
 */
export function countText(count: number, columnWidth: number, zero: 'hide' | 'show'): string {
  if (count === 0) return zero === 'show' ? '0' : '';
  return abbreviateCount(count, columnWidth);
}

/** Cell side of the correlation matrix: `clamp(20px, column / (n + 1), 44px)`. */
export function matrixCellSide(columnWidth: number, n: number): number {
  return Math.round(Math.min(44, Math.max(20, columnWidth / (n + 1))));
}

/** A matrix cell prints its number only when it is this wide (px) or wider. */
export const MATRIX_NUMBER_MIN = 32;

/**
 * Count tiers of a dense plot (counts wider than the pitch). A count sits on its bar, so neighbours at similar heights
 * collide: left to right each count takes the lowest tier (0, 1, 2) whose 16px box clears every earlier count it overlaps
 * horizontally. `p` is count / max per column; `plotH` the free height the bars share (about 120px).
 */
export function countTiers(p: number[], pitch: number, countW: number, plotH = 120, tierH = 18): number[] {
  const reach = Math.max(1, Math.ceil(countW / Math.max(pitch, 1)) - 1 + 1);
  const tiers: number[] = [];
  p.forEach((v, i) => {
    const top = (1 - v) * plotH;
    for (let t = 0; t < 3; t++) {
      const y = top - t * tierH;
      const clash = tiers.slice(Math.max(0, i - reach), i).some((pt, k) => {
        const j = Math.max(0, i - reach) + k;
        return Math.abs(y - ((1 - p[j]!) * plotH - pt * tierH)) < 16;
      });
      if (!clash || t === 2) {
        tiers.push(t);
        return;
      }
    }
  });
  return tiers;
}
