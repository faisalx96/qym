/**
 * Word diff with budgets (brief 07 §8 risks: 400k chars, 20k tokens, 1500
 * edits). Common leading/trailing tokens are trimmed first so a small edit
 * inside a long RAG context costs almost nothing; past the budget it gives up
 * (returns null) and the caller shows both sides without highlights.
 */
export const DIFF_CHAR_BUDGET = 400_000;
export const DIFF_TOKEN_BUDGET = 20_000;
export const DIFF_EDIT_BUDGET = 1_500;

export type DiffKind = 'same' | 'add' | 'del';
export interface DiffOp {
  kind: DiffKind;
  text: string;
}

export function diffTokens(text: string): string[] {
  return String(text ?? '')
    .split(/(\s+)/)
    .filter((t) => t !== '');
}

function myersDiff(a: string[], b: string[], maxD: number): DiffOp[] | null {
  const n = a.length;
  const m = b.length;
  const trace: Int32Array[] = [];
  let vPrev: Int32Array | null = null;
  const limit = Math.min(n + m, maxD);
  for (let d = 0; d <= limit; d++) {
    const v = new Int32Array(2 * d + 1);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (d === 0) x = 0;
      else if (vPrev && (k === -d || (k !== d && (vPrev[k - 1 + d - 1] ?? 0) < (vPrev[k + 1 + d - 1] ?? 0))))
        x = vPrev[k + 1 + d - 1] ?? 0;
      else x = (vPrev?.[k - 1 + d - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + d] = x;
      if (x >= n && y >= m) {
        trace.push(v);
        return backtrack(trace, a, b, d);
      }
    }
    trace.push(v);
    vPrev = v;
  }
  return null;
}

function backtrack(trace: Int32Array[], a: string[], b: string[], dEnd: number): DiffOp[] {
  let x = a.length;
  let y = b.length;
  const ops: DiffOp[] = [];
  for (let d = dEnd; d > 0; d--) {
    const vPrev = trace[d - 1];
    if (!vPrev) break;
    const k = x - y;
    const prevK =
      k === -d || (k !== d && (vPrev[k - 1 + d - 1] ?? 0) < (vPrev[k + 1 + d - 1] ?? 0)) ? k + 1 : k - 1;
    const prevX = vPrev[prevK + d - 1] ?? 0;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push({ kind: 'same', text: a[x - 1] ?? '' });
      x--;
      y--;
    }
    if (x === prevX) {
      ops.push({ kind: 'add', text: b[y - 1] ?? '' });
      y--;
    } else {
      ops.push({ kind: 'del', text: a[x - 1] ?? '' });
      x--;
    }
  }
  while (x > 0 && y > 0) {
    ops.push({ kind: 'same', text: a[x - 1] ?? '' });
    x--;
    y--;
  }
  return ops.reverse();
}

/** Word operations, or null when the pair is over budget. */
export function wordDiff(a: string, b: string): DiffOp[] | null {
  const sa = String(a ?? '');
  const sb = String(b ?? '');
  if (sa.length + sb.length > DIFF_CHAR_BUDGET) return null;
  const aw = diffTokens(sa);
  const bw = diffTokens(sb);
  let start = 0;
  while (start < aw.length && start < bw.length && aw[start] === bw[start]) start++;
  let endA = aw.length;
  let endB = bw.length;
  while (endA > start && endB > start && aw[endA - 1] === bw[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = aw.slice(start, endA);
  const midB = bw.slice(start, endB);
  if (midA.length + midB.length > DIFF_TOKEN_BUDGET) return null;
  const mid = myersDiff(midA, midB, DIFF_EDIT_BUDGET);
  if (mid === null) return null;
  const same = (list: string[]): DiffOp[] => list.map((text) => ({ kind: 'same', text }));
  return [...same(aw.slice(0, start)), ...mid, ...same(aw.slice(endA))];
}

/** One side of a diff: 'before' keeps same+del, 'after' keeps same+add. */
export function diffSide(ops: DiffOp[], side: 'before' | 'after'): DiffOp[] {
  return ops.filter((op) => (side === 'before' ? op.kind !== 'add' : op.kind !== 'del'));
}

/** Stable text form of any item field for diffing (strings as-is, else pretty JSON). */
export function diffText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
