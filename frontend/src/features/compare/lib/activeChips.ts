/** "Set on the page" filters as removable chips (compare.html comparePageFilterEntries). */
import { formatFieldName } from '@/features/run-detail/lib/rowMeta';
import { kindLabel, type DeltaKind } from './baseline';
import { emptyFilters, GROUPED_PREFIX, type CompareView } from './filters';
import type { CompareModel } from './model';

export interface ChipEntry {
  key: string;
  label: string;
  /** The view patch that removes this filter. */
  clear: (v: CompareView) => Partial<CompareView>;
}

const list = (values: string[]) => (values.length ? values.slice(0, 3).join(', ') + (values.length > 3 ? ` +${values.length - 3}` : '') : 'none selected');

const SHOW_LABEL: Record<string, string> = {
  different: 'Different outputs',
  errors: 'With errors',
  edited_metrics: 'With edited metrics',
  all_correct: 'All runs correct',
  all_wrong: 'No run correct',
  partially_correct: 'Partially correct',
  rarely_solved: 'Rarely solved',
  unique_solve: 'Uniquely solved',
};
const BUCKET_LABEL: Record<string, string> = { a_sweeps_b: 'A sweeps B', b_sweeps_a: 'B sweeps A', both_pass: 'Both pass', both_fail: 'Both fail' };

export function activeChips(view: CompareView, model: CompareModel, columnLabel: (key: string) => string): ChipEntry[] {
  const f = view.filters;
  const out: ChipEntry[] = [];
  const setF = (patch: Partial<typeof f>) => (v: CompareView) => ({ filters: { ...v.filters, ...patch } });
  if (view.show !== 'all')
    out.push({
      key: 'show',
      label: view.show.startsWith(GROUPED_PREFIX) ? `Cohorts: ${BUCKET_LABEL[view.show.slice(GROUPED_PREFIX.length)] ?? view.show}` : (SHOW_LABEL[view.show] ?? formatFieldName(view.show)),
      clear: () => ({ show: 'all' }),
    });
  if (view.winner !== 'any') {
    const [kind, idx] = view.winner.split('_');
    const name = idx !== undefined ? (model.runs[Number(idx)]?.label ?? `run ${idx}`) : '';
    out.push({ key: 'winner', label: kind === 'win' ? `${name} won` : kind === 'only' ? `Only ${name} solved` : 'Ties only', clear: () => ({ winner: 'any' }) });
  }
  if (f.baseline) {
    const verb = { improved: 'improved', regressed: 'regressed', same: 'did not change' }[f.baseline.kind as DeltaKind] ?? f.baseline.kind;
    const word = model.directions[f.baseline.metric] ? verb : kindLabel(f.baseline.kind as DeltaKind, null);
    out.push({ key: 'baseline', label: `${columnLabel(f.baseline.columnKey)} ${word} on ${f.baseline.metric}`, clear: setF({ baseline: null }) });
  }
  if (f.passRate) {
    const symbol = { gte: '≥', lte: '≤', eq: '=' }[f.passRate[0]];
    out.push({ key: 'pass_rate', label: `Passing runs ${symbol} ${f.passRate[1]} of ${model.runs.length}`, clear: setF({ passRate: null }) });
  }
  (['task', 'metric', 'trace', 'analysis'] as const).forEach((slot) => {
    const e = f.errors[slot];
    if (e) out.push({ key: `err:${slot}`, label: `${e.kind}: ${e.label}`, clear: (v) => { const errors = { ...v.filters.errors }; delete errors[slot]; return { filters: { ...v.filters, errors } }; } });
  });
  if (f.approval !== null) out.push({ key: 'approval', label: `Approval: ${f.approval === 'approved' ? 'Approved' : 'Not approved'}`, clear: setF({ approval: null }) });
  if (f.complexity !== null) out.push({ key: 'cat:complexity', label: `Complexity: ${list(f.complexity)}`, clear: setF({ complexity: null }) });
  if (f.domain !== null)
    out.push({ key: 'cat:domain', label: `Domain: ${f.domainMode === 'exclude' ? 'not ' : ''}${list(f.domain)}${f.domainOnly.length ? ' (only)' : ''}`, clear: setF({ domain: null, domainMode: 'include', domainOnly: [] }) });
  if (f.rootCause !== null) out.push({ key: 'cat:root_cause', label: `Root cause: ${list(f.rootCause)}`, clear: setF({ rootCause: null }) });
  Object.entries(f.categories).forEach(([key, values]) =>
    out.push({ key: `cat:${key}`, label: `${formatFieldName(key)}: ${list(values)}`, clear: (v) => { const categories = { ...v.filters.categories }; delete categories[key]; return { filters: { ...v.filters, categories } }; } }),
  );
  return out;
}

/** Everything a Clear press removes: search, show, winner and every filter (sort stays). */
export function clearedView(): Partial<CompareView> {
  return { q: '', show: 'all', winner: 'any', filters: emptyFilters(), page: 1, item: null };
}
