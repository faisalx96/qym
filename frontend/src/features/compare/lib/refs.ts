/**
 * Run references and the selection contract of the compare URL (brief 05 §2 J1/J2):
 * `runs[]`, `cohortA[]`/`cohortB[]` (+ labels) and the `sessionStorage` handoff
 * written by the runs list. A ref is a run id, or `"<run_id>::pass<N>"` for one
 * execution of a repeat run.
 */
export const PASS_REF_SEP = '::pass';
export const MAX_COMPARE_RUNS = 20;
export const MIN_COMPARE_RUNS = 2;

export function passRefBase(ref: string): string {
  const at = ref.indexOf(PASS_REF_SEP);
  return at < 0 ? ref : ref.slice(0, at);
}

/** The pass a ref addresses, or null for a whole run. */
export function passRefNumber(ref: string): number | null {
  const base = passRefBase(ref);
  if (base === ref) return null;
  const n = parseInt(ref.slice(base.length + PASS_REF_SEP.length), 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

export function makePassRef(base: string, pass: number): string {
  return `${base}${PASS_REF_SEP}${pass}`;
}

export interface Cohorts {
  left: string[];
  right: string[];
  leftLabel: string;
  rightLabel: string;
}

/** Both sides need the same, non-zero number of refs (a cohort pairs executions). */
export function normalizeCohorts(payload: unknown): Cohorts | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v.map(String).filter(Boolean) : []);
  const left = list(p.left);
  const right = list(p.right);
  if (left.length < 1 || right.length < 1 || left.length !== right.length) return null;
  return {
    left,
    right,
    leftLabel: String(p.leftLabel ?? '').trim(),
    rightLabel: String(p.rightLabel ?? '').trim(),
  };
}

export interface Selection {
  /** Every ref, cohort A first. */
  refs: string[];
  cohorts: Cohorts | null;
  source: 'url' | 'session' | 'none';
}

function readSession<T>(storage: Pick<Storage, 'getItem'> | null, key: string): T | null {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Precedence of the vanilla page (compare.html loadComparisonData):
 * cohortA/cohortB > runs (>= 2) > sessionStorage.compareCohorts > sessionStorage.compareRuns.
 */
export function readSelection(params: URLSearchParams, storage: Pick<Storage, 'getItem'> | null): Selection {
  const fromUrl = normalizeCohorts({
    left: params.getAll('cohortA'),
    right: params.getAll('cohortB'),
    leftLabel: params.get('cohortALabel'),
    rightLabel: params.get('cohortBLabel'),
  });
  if (fromUrl) return { refs: [...fromUrl.left, ...fromUrl.right], cohorts: fromUrl, source: 'url' };
  const runs = params.getAll('runs').filter(Boolean);
  if (runs.length >= MIN_COMPARE_RUNS) return { refs: dedupe(runs), cohorts: null, source: 'url' };
  const stored = normalizeCohorts(readSession(storage, 'compareCohorts'));
  if (stored) return { refs: [...stored.left, ...stored.right], cohorts: stored, source: 'session' };
  const list = readSession<unknown>(storage, 'compareRuns');
  if (Array.isArray(list)) {
    const refs = dedupe(list.map(String).filter(Boolean));
    if (refs.length >= MIN_COMPARE_RUNS) return { refs, cohorts: null, source: 'session' };
  }
  return { refs: [], cohorts: null, source: 'none' };
}

export function dedupe<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

/** Distinct base run ids to request (pass refs resolve to their run). */
export function baseRunIds(refs: string[]): string[] {
  return dedupe(refs.map(passRefBase));
}

export interface RunSummaryLite {
  run_id: string;
  file_path?: string;
  samples?: number;
  metadata?: { has_repeat_pass_context?: boolean } | null;
}

/**
 * Whole repeat runs expand into one ref per pass; explicit pass refs stay;
 * refs whose run was not returned are dropped (compare.html expandPassRefIds).
 */
export function expandRefs(requested: string[], loaded: RunSummaryLite[]): string[] {
  const byId = new Map(loaded.map((r) => [r.file_path || r.run_id, r]));
  const out: string[] = [];
  for (const ref of requested) {
    const base = passRefBase(ref);
    const run = byId.get(base);
    if (!run) continue;
    if (ref === base) {
      const samples = Number(run.samples) || 1;
      if (samples > 1 || run.metadata?.has_repeat_pass_context) {
        for (let n = 1; n <= samples; n++) out.push(makePassRef(base, n));
      } else out.push(ref);
    } else if (passRefNumber(ref) !== null) out.push(ref);
  }
  return dedupe(out);
}

/** Query params for a selection (the compare URL, `/compare?...`). */
export function selectionParams(refs: string[], cohorts: Cohorts | null): URLSearchParams {
  const p = new URLSearchParams();
  if (cohorts) {
    cohorts.left.forEach((r) => p.append('cohortA', r));
    cohorts.right.forEach((r) => p.append('cohortB', r));
    p.set('cohortALabel', cohorts.leftLabel);
    p.set('cohortBLabel', cohorts.rightLabel);
  } else refs.forEach((r) => p.append('runs', r));
  return p;
}
