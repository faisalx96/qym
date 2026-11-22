/**
 * RD12: the Overview metric grid fills every row. The section width gives the most cards a row can hold (a card is
 * at least 330px, so 1 to 6 per row); the cards then split into the fewest rows, as even as possible (5 in rows of 3
 * show 3 + 2, 4 show 2 + 2, 7 show 3 + 2 + 2), the fuller rows first, and the cards of a row share its full width.
 * No column track stays empty and no card sits alone beside empty space.
 *
 * CSS cannot count the cards of a row, so this model gives, for each possible column count, the number of grid
 * tracks (the least common multiple of the row sizes) and each card's span; the stylesheet picks the column count
 * with container queries on the section width.
 */
import type { CSSProperties } from 'react';

/** The most cards a row ever holds (a 330px card in the widest section). */
export const METRIC_GRID_MAX_COLUMNS = 6;

/** Row sizes for `count` cards when a row holds at most `columns`: the fewest rows, sizes differ by at most one. */
export function balancedRows(count: number, columns: number): number[] {
  if (count <= 0) return [];
  const cols = Math.max(1, Math.floor(columns));
  const rows = Math.ceil(count / cols);
  const base = Math.floor(count / rows);
  const extra = count % rows;
  return Array.from({ length: rows }, (_, r) => (r < extra ? base + 1 : base));
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
const lcm = (a: number, b: number) => (a * b) / gcd(a, b);

export interface MetricGridLayout {
  /** `tracks[c - 1]`: the grid's column tracks when a row holds at most `c` cards. */
  tracks: number[];
  /** `spans[i][c - 1]`: the tracks card `i` spans when a row holds at most `c` cards. */
  spans: number[][];
}

/** Tracks and spans of `count` cards for every column count from 1 to `maxColumns`. */
export function metricGridLayout(count: number, maxColumns = METRIC_GRID_MAX_COLUMNS): MetricGridLayout {
  const tracks: number[] = [];
  const spans: number[][] = Array.from({ length: Math.max(0, count) }, () => []);
  for (let c = 1; c <= maxColumns; c += 1) {
    const rows = balancedRows(count, c);
    const t = rows.reduce(lcm, 1);
    tracks.push(t);
    let i = 0;
    for (const size of rows) {
      for (let k = 0; k < size; k += 1) spans[i++]!.push(t / size);
    }
  }
  return { tracks, spans };
}

/** The custom properties the stylesheet reads: `--mg-tracks-c` on the grid, `--mg-span-c` on each card. */
export function metricGridStyles(count: number, maxColumns = METRIC_GRID_MAX_COLUMNS) {
  const { tracks, spans } = metricGridLayout(count, maxColumns);
  const grid = Object.fromEntries(tracks.map((t, c) => [`--mg-tracks-${c + 1}`, t])) as CSSProperties;
  const items = spans.map(
    (s) => Object.fromEntries(s.map((v, c) => [`--mg-span-${c + 1}`, v])) as CSSProperties,
  );
  return { grid, items };
}
