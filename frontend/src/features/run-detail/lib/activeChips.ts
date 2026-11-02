/** "Set on the page" chips: every filter that did not come from the rule builder, removable one by one (brief 04 J7). */
import { formatPercent } from '@/lib/metrics';
import { datasetKeyLabel } from './datasetFilter';
import { latencyFilterLabel } from './latencyModel';
import { emptyFilters, filterRuleCount, type FieldDef, type RunView } from './filterRules';
import { ERROR_SLOTS, type ErrorSlot } from './rowErrors';

export interface ActiveChip {
  key: string;
  label: string;
  /** The view with this one filter removed. */
  clear: (view: RunView) => RunView;
}

const SHOW_LABELS: Record<string, string> = {
  passed: 'Passing',
  failed: 'Failing',
  metric_errors: 'With errors',
  errors: 'With any error',
  edited_metrics: 'With edited scores',
  retries: 'With retries',
  trace_errors: 'With trace errors',
};

const list = (values: string[]) => (values.length ? values.join(', ') : 'none');

export function activeChips(view: RunView, defs: FieldDef[], metric: string | null): ActiveChip[] {
  const f = view.filters;
  const chips: ActiveChip[] = [];
  const withFilters = (v: RunView, patch: Partial<typeof f>): RunView => ({
    ...v,
    page: 1,
    filters: { ...v.filters, ...patch },
  });
  if (view.show !== 'all') {
    chips.push({
      key: 'show',
      label: `${SHOW_LABELS[view.show] ?? view.show}${metric && ['passed', 'failed', 'metric_errors'].includes(view.show) ? ` · ${metric}` : ''}`,
      clear: (v) => ({ ...v, show: 'all', page: 1 }),
    });
  }
  if (view.dataset !== null)
    chips.push({
      key: 'dataset',
      label: `Dataset: ${datasetKeyLabel(view.dataset)}`,
      clear: (v) => ({ ...v, dataset: null, page: 1 }),
    });
  const rules = filterRuleCount(f.rules, new Map(defs.map((d) => [d.id, d])));
  if (rules > 0)
    chips.push({
      key: 'rules',
      label: `${rules} rule${rules === 1 ? '' : 's'}`,
      clear: (v) => withFilters(v, { rules: emptyFilters().rules }),
    });
  if (f.approval)
    chips.push({
      key: 'approval',
      label: f.approval === 'approved' ? 'Approved' : 'Not approved',
      clear: (v) => withFilters(v, { approval: null }),
    });
  if (f.complexity)
    chips.push({
      key: 'complexity',
      label: `Complexity: ${list(f.complexity)}`,
      clear: (v) => withFilters(v, { complexity: null }),
    });
  if (f.domain) {
    chips.push({
      key: 'domain',
      label: `Domain ${f.domainMode === 'exclude' ? 'excluding' : ''}: ${list(f.domain)}`.replace('  ', ' '),
      clear: (v) => withFilters(v, { domain: null, domainMode: 'include', domainOnly: [] }),
    });
  }
  if (f.rootCause) {
    chips.push({
      key: 'rootCause',
      label: `Root cause: ${list(f.rootCause.map((x) => (x === '__none__' ? 'none' : x)))}`,
      clear: (v) => withFilters(v, { rootCause: null, rootCauseMetric: 'all' }),
    });
  }
  ERROR_SLOTS.forEach(([slot, kind]) => {
    const e = f.errors[slot];
    if (!e) return;
    chips.push({
      key: `error:${slot}`,
      label: `${kind}: ${e.label.length > 48 ? e.label.slice(0, 47) + '…' : e.label}`,
      clear: (v) => {
        const errors = { ...v.filters.errors };
        delete errors[slot as ErrorSlot];
        return withFilters(v, { errors });
      },
    });
  });
  if (f.score) {
    chips.push({
      key: 'score',
      label: `${metric ?? 'Score'} ${formatPercent(f.score.min, 0)}–${formatPercent(Math.min(f.score.max, 1), 0)}`,
      clear: (v) => withFilters(v, { score: null }),
    });
  }
  if (f.repeat) {
    chips.push({
      key: 'repeat',
      label: `${f.repeat.bucket} of ${f.repeat.samples} passes passed · ${f.repeat.metric}`,
      clear: (v) => withFilters(v, { repeat: null }),
    });
  }
  if (f.latency)
    chips.push({
      key: 'latency',
      label: latencyFilterLabel(f.latency),
      clear: (v) => withFilters(v, { latency: null }),
    });
  Object.entries(f.categories).forEach(([key, values]) => {
    chips.push({
      key: `cat:${key}`,
      label: `${key}: ${list(values)}`,
      clear: (v) => {
        const categories = { ...v.filters.categories };
        delete categories[key];
        return withFilters(v, { categories });
      },
    });
  });
  return chips;
}
