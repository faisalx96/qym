/**
 * Pure geometry of the sticky table header (round 3 P4). All numbers are viewport y coordinates in px.
 *
 * The header sticks at `line` while the table scrolls; it is translated by `shift` from its resting place at `tableTop`.
 * An expanded detail renders inside the table but is not laid out in its columns, so the header must never sit over it:
 * it stops when its bottom touches the detail's top and scrolls away with the content until the line crosses the
 * detail's bottom, where it returns to the line at once.
 */
export interface DetailSpan {
  top: number;
  bottom: number;
}

export interface ShiftInput {
  line: number;
  tableTop: number;
  tableH: number;
  headH: number;
  details: DetailSpan[];
}

export function computeShift({ line, tableTop, tableH, headH, details }: ShiftInput): number {
  const max = Math.max(0, tableH - headH);
  let shift = Math.min(Math.max(0, line - tableTop), max);
  // The first detail the line has not passed caps the header (header bottom <= detail top); passed details do not.
  const ordered = [...details].sort((a, b) => a.top - b.top);
  for (const d of ordered) {
    if (line >= d.bottom) continue;
    const cap = d.top - tableTop - headH;
    if (cap >= 0) {
      shift = Math.min(shift, cap);
      break;
    }
  }
  return shift;
}

/** True while the header is held above a detail the line is inside of (it scrolls away with the page). */
export function isSuspended(input: ShiftInput): boolean {
  const free = Math.min(Math.max(0, input.line - input.tableTop), Math.max(0, input.tableH - input.headH));
  return computeShift(input) < free;
}
