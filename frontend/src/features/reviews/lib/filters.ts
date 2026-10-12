/**
 * Reviews view state ↔ URL (brief 07 §2.14 / §8): every filter is a query
 * param; multiselects use `__none__` for "none selected"; `status` defaults to
 * pending and `all` is the All tab. Sort moves from localStorage into `?sort=`.
 */
import type { BulkAction, CorrectionRow, CorrectionStatus, ReviewFilters, ReviewSort, ReviewSource } from '@/api/reviews';

export const REVIEW_NONE = '__none__';
export const PRIORITY_WAIT_DAYS = 14;

export const MULTI_PARAMS = ['task', 'dataset', 'model', 'run'] as const;
export type MultiParam = (typeof MULTI_PARAMS)[number];

const SOURCES = new Set<string>(['ai_only', 'human_only', 'corrected']);
const SORTS = new Set<string>(['newest', 'oldest', 'confidence']);
const STATUSES = new Set<string>(['pending', 'approved', 'rejected', 'all']);

function clampPct(raw: string | null, fallback: number): number {
  if (raw === null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.round(n)));
}

export function filtersFromParams(params: URLSearchParams, projectSlug: string | null): ReviewFilters {
  const status = params.get('status') ?? 'pending';
  const multi = (key: MultiParam): string[] | null => {
    const values = params.getAll(key).filter((v) => v !== '');
    if (!values.length) return null;
    if (values.includes(REVIEW_NONE)) return [];
    return values;
  };
  const sort = params.get('sort') ?? '';
  const source = params.get('source') ?? '';
  let confMin = clampPct(params.get('conf_min'), 0);
  let confMax = clampPct(params.get('conf_max'), 100);
  if (confMin > confMax) [confMin, confMax] = [confMax, confMin];
  return {
    projectSlug,
    status: (STATUSES.has(status) ? status : 'pending') as CorrectionStatus | 'all',
    source: SOURCES.has(source) ? (source as ReviewSource) : null,
    confMin,
    confMax,
    search: params.get('q') ?? '',
    task: multi('task'),
    dataset: multi('dataset'),
    model: multi('model'),
    run: multi('run'),
    sort: SORTS.has(sort) ? (sort as ReviewSort) : 'oldest',
  };
}

/** URL updates for `replaceUrlQuery`-style setters (arrays become repeated params). */
export function paramsFromFilters(f: ReviewFilters): Record<string, string | string[] | null> {
  const out: Record<string, string | string[] | null> = {
    status: f.status === 'pending' ? 'pending' : f.status,
    source: f.source,
    conf_min: f.confMin > 0 ? String(f.confMin) : null,
    conf_max: f.confMax < 100 ? String(f.confMax) : null,
    q: f.search || null,
    sort: f.sort === 'oldest' ? null : f.sort,
  };
  for (const key of MULTI_PARAMS) {
    const value = f[key];
    out[key] = value === null ? null : value.length ? value : [REVIEW_NONE];
  }
  return out;
}

export function applyFilterParams(params: URLSearchParams, f: ReviewFilters): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const [key, value] of Object.entries(paramsFromFilters(f))) {
    next.delete(key);
    if (value === null) continue;
    if (Array.isArray(value)) for (const v of value) next.append(key, v);
    else next.set(key, value);
  }
  return next;
}

export function hasActiveFilters(f: ReviewFilters): boolean {
  return Boolean(
    f.source || f.confMin > 0 || f.confMax < 100 || f.search || f.task || f.dataset || f.model || f.run,
  );
}

export function clearedFilters(f: ReviewFilters): ReviewFilters {
  return {
    ...f,
    status: 'pending',
    source: null,
    confMin: 0,
    confMax: 100,
    search: '',
    task: null,
    dataset: null,
    model: null,
    run: null,
  };
}

export interface Priority {
  level: 'high' | 'medium';
  label: string;
  reasons: string[];
}

function issueKey(i: { category?: string | null; subcategory?: string | null; finding?: string | null }) {
  return [i.category ?? '', i.subcategory ?? '', i.finding ?? ''].map((s) => s.trim().toLowerCase()).join('\u0001');
}

/** Human issues differ from the AI issues (the reviewer changed the diagnosis). */
export function issuesChanged(c: CorrectionRow): boolean {
  const ai = c.ai_root_cause_issues ?? [];
  const human = c.human_root_cause_issues ?? [];
  if (!human.length) return false;
  if (!ai.length) return true;
  if (ai.length !== human.length) return true;
  const a = ai.map(issueKey).sort();
  const h = human.map(issueKey).sort();
  return a.some((k, i) => k !== h[i]);
}

export function correctionPriority(c: CorrectionRow, now = Date.now()): Priority | null {
  if ((c.status ?? 'pending') !== 'pending') return null;
  const changed = issuesChanged(c);
  const reasons: string[] = [];
  const raw = c.ai_confidence == null ? NaN : Number(c.ai_confidence);
  const confidence = Number.isFinite(raw) ? raw : null;
  if (confidence != null && confidence < 0.75) reasons.push(`AI confidence ${Math.round(confidence * 100)}%`);
  if (changed) reasons.push('A reviewer changed the AI diagnosis');
  const created = c.created_at ? Date.parse(c.created_at) : NaN;
  const days = Number.isFinite(created) ? Math.floor((now - created) / 86_400_000) : 0;
  if (days >= PRIORITY_WAIT_DAYS) reasons.push(`Waiting ${days} days`);
  const high = (confidence != null && confidence < 0.5) || (changed && confidence != null && confidence < 0.75);
  if (high) return { level: 'high', label: 'High priority', reasons };
  if (reasons.length) return { level: 'medium', label: 'Medium priority', reasons };
  return null;
}

export const BULK_FITS: Record<
  Exclude<BulkAction, 'delete'>,
  { label: string; fits: (c: CorrectionRow) => boolean; rule: string }
> = {
  approve: { label: 'Approve', fits: (c) => c.status === 'pending', rule: 'Approve works on pending corrections only.' },
  reject: { label: 'Reject', fits: (c) => c.status === 'pending', rule: 'Reject works on pending corrections only.' },
  reset: {
    label: 'Reset',
    fits: (c) => c.status === 'approved' || c.status === 'rejected',
    rule: 'Reset works on approved or rejected corrections only.',
  },
};

export function bulkSelection(rows: CorrectionRow[], selected: Set<number>, action: Exclude<BulkAction, 'delete'>) {
  const byId = new Map(rows.map((c) => [c.id, c] as const));
  const ids: number[] = [];
  for (const id of selected) {
    const c = byId.get(id);
    if (c && BULK_FITS[action].fits(c)) ids.push(id);
  }
  return { ids, selected: selected.size, skipped: selected.size - ids.length };
}

/** Human-readable name of the current view for the bulk comment dialog. */
export function describeView(f: ReviewFilters): string {
  const parts: string[] = [];
  if (f.status !== 'all') parts.push(f.status === 'pending' ? 'to review' : f.status);
  if (f.source) parts.push({ ai_only: 'AI only', human_only: 'human only', corrected: 'AI+human corrected' }[f.source]);
  if (f.search) parts.push(`matching “${f.search}”`);
  return parts.length ? parts.join(', ') : 'all corrections';
}

export function statusLabel(status: CorrectionStatus | 'all'): string {
  return { pending: 'To review', approved: 'Approved', rejected: 'Rejected', all: 'All' }[status];
}

/** Whether a row still belongs to the current status tab after a decision. */
export function fitsStatusTab(c: CorrectionRow, status: CorrectionStatus | 'all'): boolean {
  return status === 'all' || c.status === status;
}
