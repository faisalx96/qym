/**
 * Row selection, cohort A, the compare/cohort handoff and the sessionStorage
 * keys the legacy pages share (brief 03 §2 "Persisted state summary").
 */
import { useCallback, useMemo, useState } from 'react';
import type { RunRow } from '@/api/dashboardTypes';

export const PASS_REF_SEP = '::pass';
export const COMPARE_RUNS_KEY = 'compareRuns';
export const COMPARE_COHORTS_KEY = 'compareCohorts';
export const DASHBOARD_RUN_FILE_KEY = 'dashboardRunFile';
export const VISIBLE_COLUMNS_KEY = 'qym_visible_metrics';
export const VISIBLE_COLUMNS_VERSION = 2;

export const selectionKey = (slug: string) => `qym:runs-selection:${slug}`;

export function passRefBase(ref: string): string {
  const i = ref.indexOf(PASS_REF_SEP);
  return i < 0 ? ref : ref.slice(0, i);
}
export function isPassRef(ref: string): boolean {
  return ref.includes(PASS_REF_SEP);
}
export function passRef(runId: string, pass: number): string {
  return `${runId}${PASS_REF_SEP}${pass}`;
}
export function passNumber(ref: string): number | null {
  const i = ref.indexOf(PASS_REF_SEP);
  return i < 0 ? null : Number(ref.slice(i + PASS_REF_SEP.length));
}

function readSession<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeSession(key: string, value: unknown | null): void {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode */
  }
}

export interface StoredSelection {
  selected: string[];
  cohortA: string[];
  passRevisions: Record<string, number>;
}

export function readSelection(slug: string): StoredSelection {
  const s = readSession<Partial<StoredSelection>>(selectionKey(slug), {});
  return {
    selected: Array.isArray(s.selected) ? s.selected.map(String) : [],
    cohortA: Array.isArray(s.cohortA) ? s.cohortA.map(String) : [],
    passRevisions: s.passRevisions && typeof s.passRevisions === 'object' ? s.passRevisions : {},
  };
}

export function writeSelection(slug: string, value: StoredSelection): void {
  if (!value.selected.length && !value.cohortA.length) writeSession(selectionKey(slug), null);
  else writeSession(selectionKey(slug), value);
}

/** A unit = one execution: a run counts 1, a repeat run its k passes, a pass ref 1. */
export function cohortUnitCount(refs: string[], samplesOf: (runId: string) => number): number {
  return refs.reduce((n, ref) => n + (isPassRef(ref) ? 1 : Math.max(1, samplesOf(passRefBase(ref)))), 0);
}

/** A whole repeat run expands to its pass refs for the compare page. */
export function expandComparisonRefs(refs: string[], samplesOf: (runId: string) => number): string[] {
  const out: string[] = [];
  for (const ref of refs) {
    if (isPassRef(ref)) {
      out.push(ref);
      continue;
    }
    const samples = Math.max(1, samplesOf(ref));
    if (samples <= 1) out.push(ref);
    else for (let p = 1; p <= samples; p++) out.push(passRef(ref, p));
  }
  return out;
}

export function cohortRefsConflict(a: string, b: string): boolean {
  if (a === b) return true;
  const baseA = passRefBase(a);
  const baseB = passRefBase(b);
  if (baseA !== baseB) return false;
  // whole run vs any of its passes conflicts; two different passes do not
  return !(isPassRef(a) && isPassRef(b));
}

/** `sessionStorage.compareRuns` handoff; returns the /compare query string. */
export function handoffCompare(refs: string[], samplesOf: (runId: string) => number): string {
  const files = expandComparisonRefs(refs, samplesOf);
  writeSession(COMPARE_COHORTS_KEY, null);
  writeSession(COMPARE_RUNS_KEY, files);
  return files.map((f) => `runs=${encodeURIComponent(f)}`).join('&');
}

export function buildCohortLabel(refs: string[], nameOf: (runId: string) => string): string {
  const names = [...new Set(refs.map((r) => nameOf(passRefBase(r))))];
  return names.length <= 2 ? names.join(' + ') : `${names[0]} +${names.length - 1}`;
}

export function handoffCohorts(
  left: string[],
  right: string[],
  samplesOf: (runId: string) => number,
  nameOf: (runId: string) => string,
): string {
  const payload = {
    left: expandComparisonRefs(left, samplesOf),
    right: expandComparisonRefs(right, samplesOf),
    leftLabel: buildCohortLabel(left, nameOf),
    rightLabel: buildCohortLabel(right, nameOf),
  };
  writeSession(COMPARE_COHORTS_KEY, payload);
  writeSession(COMPARE_RUNS_KEY, [...payload.left, ...payload.right]);
  const params = new URLSearchParams();
  payload.left.forEach((f) => params.append('cohortA', f));
  payload.right.forEach((f) => params.append('cohortB', f));
  params.set('cohortALabel', payload.leftLabel);
  params.set('cohortBLabel', payload.rightLabel);
  return params.toString();
}

export function rememberRunFile(runId: string): void {
  try {
    sessionStorage.setItem(DASHBOARD_RUN_FILE_KEY, runId);
  } catch {
    /* ignore */
  }
}

/** Selection state hook: persisted per project; drops runs that vanished. */
export function useRunsSelection(slug: string) {
  const [state, setState] = useState<StoredSelection>(() => readSelection(slug));
  const update = useCallback(
    (fn: (prev: StoredSelection) => StoredSelection) => {
      setState((prev) => {
        const next = fn(prev);
        writeSelection(slug, next);
        return next;
      });
    },
    [slug],
  );
  const api = useMemo(
    () => ({
      selected: new Set(state.selected),
      cohortA: state.cohortA,
      passRevisions: state.passRevisions,
      toggle: (ref: string) =>
        update((p) => ({
          ...p,
          selected: p.selected.includes(ref) ? p.selected.filter((r) => r !== ref) : [...p.selected, ref],
        })),
      setMany: (refs: string[], on: boolean) =>
        update((p) => ({
          ...p,
          selected: on
            ? [...p.selected, ...refs.filter((r) => !p.selected.includes(r))]
            : p.selected.filter((r) => !refs.includes(r)),
        })),
      clear: () => update(() => ({ selected: [], cohortA: [], passRevisions: {} })),
      clearSelected: () => update((p) => ({ ...p, selected: [] })),
      lockCohortA: () => update((p) => ({ ...p, cohortA: p.selected, selected: [] })),
      releaseCohortA: () => update((p) => ({ ...p, cohortA: [] })),
      notePassRevision: (runId: string, revision: number) =>
        update((p) => ({ ...p, passRevisions: { ...p.passRevisions, [runId]: revision } })),
      /** Drop refs of runs that the page no longer knows (deleted) and stale pass picks. */
      reconcile: (rows: RunRow[], known: Set<string>) =>
        update((p) => {
          const revisions = new Map(rows.map((r) => [r.run_id, r.pass_revision]));
          const keep = (ref: string) => {
            const base = passRefBase(ref);
            if (!known.has(base)) return false;
            if (isPassRef(ref)) {
              const seen = p.passRevisions[base];
              const now = revisions.get(base);
              if (seen !== undefined && now !== undefined && seen !== now) return false;
            }
            return true;
          };
          const selected = p.selected.filter(keep);
          const cohortA = p.cohortA.filter(keep);
          if (selected.length === p.selected.length && cohortA.length === p.cohortA.length) return p;
          return { ...p, selected, cohortA };
        }),
    }),
    [state, update],
  );
  return api;
}

export interface VisibleColumns {
  version: number;
  visible: string[];
}

export const baseColumnKey = (column: string) => `__runs_col_${column}__`;

/** null = "every column" (nothing saved yet). */
export function readVisibleColumns(): Set<string> | null {
  const s = readSession<Partial<VisibleColumns> | null>(VISIBLE_COLUMNS_KEY, null);
  if (!s || s.version !== VISIBLE_COLUMNS_VERSION || !Array.isArray(s.visible)) return null;
  return new Set(s.visible.map(String));
}

export function writeVisibleColumns(visible: Set<string> | null): void {
  if (visible === null) writeSession(VISIBLE_COLUMNS_KEY, null);
  else writeSession(VISIBLE_COLUMNS_KEY, { version: VISIBLE_COLUMNS_VERSION, visible: [...visible] });
}
