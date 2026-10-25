/**
 * Live refresh keeps row object identity when a row did not change (brief 04
 * §2 J2): rows are compared by an FNV-1a signature of their compact JSON so
 * memoised cards, loaded bodies and scroll survive a refetch.
 *
 * Bodies live in two places: the row's own `input` / `expected` / `output`
 * keys, and, for a repeat run, `pass_attempts[i].output`. A compact refetch
 * ships neither (the server pops them and leaves digests), so a changed row
 * inherits the loaded bodies of its predecessor as long as the digests agree;
 * when a digest moved, the row is marked not loaded and the card fetches the
 * item again (the bug of October 2026: pass outputs replaced by the compact
 * attempts, "No output was recorded" on a row that still counted as loaded).
 */
import type { PassAttempt, Row, RunPayload } from '../types';

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

type Attempts = Row['pass_attempts'];

function attemptWithoutOutput(attempt: PassAttempt | null | undefined): unknown {
  if (!attempt || typeof attempt !== 'object' || !('output' in attempt)) return attempt;
  const { output: _output, ...rest } = attempt;
  return rest;
}

/** Signature over everything but the lazily loaded bodies (the row's and its attempts'). */
export function rowSignature(row: Row): string {
  const slim: Record<string, unknown> = {};
  const source = row as unknown as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (DETAIL_KEYS.has(key)) continue;
    slim[key] =
      key === 'pass_attempts' && Array.isArray(source[key])
        ? (source[key] as PassAttempt[]).map(attemptWithoutOutput)
        : source[key];
  }
  return fnv1a(JSON.stringify(slim));
}

/** The attempt of the same pass (by pass number, or by position when the attempts carry none). */
function attemptFor(attempts: Attempts, wanted: PassAttempt, i: number): PassAttempt | undefined {
  if (!Array.isArray(attempts)) return undefined;
  if (wanted.pass_number != null)
    return attempts.find((a) => a?.pass_number === wanted.pass_number) ?? undefined;
  const positional = attempts[i];
  return positional && positional.pass_number == null ? positional : undefined;
}

/**
 * Full attempts (an items/details answer) laid over their compact twins: the
 * output comes in, the digest and flags of the compact form stay, so a later
 * refetch can tell whether that output is still current.
 */
export function hydrateAttempts(compact: Attempts, full: Attempts): Attempts {
  if (!Array.isArray(full)) return full;
  if (!Array.isArray(compact)) return full;
  return full.map((attempt, i) => {
    if (!attempt) return attempt;
    const twin = attemptFor(compact, attempt, i);
    return twin ? { ...twin, ...attempt } : attempt;
  });
}

/**
 * A fresh row (compact: no bodies, `__details_loaded` false) over the loaded row
 * it replaces. The bodies carry over while their digests agree; otherwise the
 * row comes back not loaded and the card asks for the item again.
 */
export function inheritLoadedBodies(old: Row, next: Row): Row {
  if (!old.__details_loaded || next.__details_loaded) return next;
  let current = true;
  if (old.output_digest && next.output_digest && old.output_digest !== next.output_digest) current = false;
  let attempts = next.pass_attempts;
  if (Array.isArray(attempts)) {
    attempts = attempts.map((attempt, i) => {
      if (!attempt || 'output' in attempt) return attempt;
      const was = attemptFor(old.pass_attempts, attempt, i);
      if (!was || !('output' in was)) {
        if (attempt.__has_output) current = false;
        return attempt;
      }
      if (was.output_digest && attempt.output_digest && was.output_digest !== attempt.output_digest) {
        current = false;
        return attempt;
      }
      return { ...attempt, output: was.output };
    });
  }
  if (!current) return { ...next, pass_attempts: attempts, __details_loaded: false };
  return {
    ...next,
    input: next.input ?? old.input,
    input_full: next.input_full ?? old.input_full,
    expected: next.expected ?? old.expected,
    expected_full: next.expected_full ?? old.expected_full,
    output: next.output ?? old.output,
    output_full: next.output_full ?? old.output_full,
    pass_attempts: attempts,
    __details_loaded: true,
  };
}

/**
 * Merge a fresh payload over the previous one: unchanged rows keep their
 * previous object (and any bodies already loaded into it), changed rows take
 * the new object but inherit loaded bodies when present.
 */
export function reuseRows(previous: RunPayload | undefined, next: RunPayload): RunPayload {
  if (!previous) return next;
  const prevById = new Map<string, Row>();
  previous.snapshot.rows.forEach((row) => {
    prevById.set(row.item_id, row);
  });
  let reused = 0;
  const rows = next.snapshot.rows.map((row) => {
    const old = prevById.get(row.item_id);
    if (!old) return row;
    if (rowSignature(row) === rowSignature(old)) {
      reused++;
      return old;
    }
    return inheritLoadedBodies(old, row);
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
  const merged = inheritLoadedBodies(old, { ...old, ...row });
  const rows = payload.snapshot.rows.slice();
  rows[index] = merged;
  return { ...payload, snapshot: { ...payload.snapshot, rows } };
}
