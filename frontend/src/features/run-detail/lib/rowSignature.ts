/**
 * Live refresh keeps row object identity when a row did not change (brief 04
 * §2 J2): rows are compared by an FNV-1a signature of their compact JSON so
 * memoised cards, loaded bodies and scroll survive a refetch.
 */
import type { Row, RunPayload } from '../types';

export function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
}

const DETAIL_KEYS = new Set([
  'input',
  'input_full',
  'expected',
  'expected_full',
  'output',
  'output_full',
  '__details_loaded',
]);

/** Signature over everything but the lazily loaded bodies. */
export function rowSignature(row: Row): string {
  const slim: Record<string, unknown> = {};
  const source = row as unknown as Record<string, unknown>;
  for (const key of Object.keys(source)) if (!DETAIL_KEYS.has(key)) slim[key] = source[key];
  return fnv1a(JSON.stringify(slim));
}

/**
 * Merge a fresh payload over the previous one: unchanged rows keep their
 * previous object (and any bodies already loaded into it), changed rows take
 * the new object but inherit loaded bodies when present.
 */
export function reuseRows(previous: RunPayload | undefined, next: RunPayload): RunPayload {
  if (!previous) return next;
  const prevById = new Map<string, Row>();
  const prevSig = new Map<string, string>();
  previous.snapshot.rows.forEach((row) => {
    prevById.set(row.item_id, row);
  });
  let reused = 0;
  const rows = next.snapshot.rows.map((row) => {
    const old = prevById.get(row.item_id);
    if (!old) return row;
    const sig = rowSignature(row);
    const oldSig = prevSig.get(row.item_id) ?? rowSignature(old);
    if (sig === oldSig) {
      reused++;
      return old;
    }
    if (old.__details_loaded && !row.__details_loaded) {
      return {
        ...row,
        input: old.input,
        input_full: old.input_full,
        expected: old.expected,
        expected_full: old.expected_full,
        output: row.output ?? old.output,
        output_full: row.output_full ?? old.output_full,
        __details_loaded: true,
      };
    }
    return row;
  });
  if (
    reused === rows.length &&
    rows.length === previous.snapshot.rows.length &&
    JSON.stringify(previous.run) === JSON.stringify(next.run)
  ) {
    return previous;
  }
  return { run: next.run, snapshot: { ...next.snapshot, rows } };
}

/** Merge one server row (mutation result) into the payload by item_id. */
export function mergeRow(payload: RunPayload, row: Row): RunPayload {
  const index = payload.snapshot.rows.findIndex((r) => r.item_id === row.item_id);
  if (index < 0) return payload;
  const old = payload.snapshot.rows[index]!;
  const merged: Row = { ...old, ...row };
  if (old.__details_loaded && !row.__details_loaded) merged.__details_loaded = true;
  const rows = payload.snapshot.rows.slice();
  rows[index] = merged;
  return { ...payload, snapshot: { ...payload.snapshot, rows } };
}
