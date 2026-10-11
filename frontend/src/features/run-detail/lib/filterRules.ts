/**
 * Item filters: the rule builder tree, the filters set from charts/cards, the
 * `show`/`sort`/`metric`/`threshold` view params and their URL codec
 * (run.html itemFilterFieldDefs / evalFilterNode / getFilteredItems /
 * runViewFiltersParam / applyRunViewFiltersParam). Encodings are kept
 * byte-compatible so old links keep working.
 */
import {
  getRowScore,
  isErrorRow,
  metricPasses,
  parseScoreValue,
  repeatPassOutcomes,
  rowMetricPasses,
  type RowScore,
} from '@/lib/metrics';
import type { Row } from '../types';
import {
  errorFilterUrlValue,
  errorLabelFromUrlValue,
  ERROR_SLOTS,
  rowMatchesErrorFilter,
  rowTraceErrorCount,
  stringify,
  type ErrorFilter,
  type ErrorSlot,
} from './rowErrors';
import {
  formatFieldName,
  getApprovalState,
  getMetadataCategoryValues,
  getRowRootCauseAnalyses,
  HIDDEN_METADATA_KEYS,
  itemRootCauses,
  parseMetaList,
  rootCauseCategories,
  rowHasEditedMetric,
} from './rowMeta';
import type { RunModel } from './runModel';

/* ── types ── */

export interface FilterCondition {
  field: string;
  oper: string;
  value: string | number | string[];
}
export interface FilterGroup {
  op: 'and' | 'or';
  children: FilterNode[];
}
export type FilterNode = FilterGroup | FilterCondition;

export const ITEM_SHOW_VALUES = [
  'passed',
  'failed',
  'metric_errors',
  'errors',
  'edited_metrics',
  'retries',
  'trace_errors',
] as const;
export type ItemShow = 'all' | (typeof ITEM_SHOW_VALUES)[number];
export const SORT_VALUES = ['score_asc', 'score_desc', 'latency_asc', 'latency_desc'] as const;
export type SortBy = 'index' | (typeof SORT_VALUES)[number];

export interface RepeatDistFilter {
  metric: string;
  bucket: number;
  samples: number;
  threshold: number;
}

/** Filters "set on the page" (chart/card clicks) plus the rule tree — the `filters` URL param. */
export interface PageFilters {
  rules: FilterGroup;
  approval: 'approved' | 'not_approved' | null;
  complexity: string[] | null;
  domain: string[] | null;
  domainMode: 'include' | 'exclude';
  domainOnly: string[];
  rootCause: string[] | null;
  rootCauseMetric: string;
  errors: Partial<Record<ErrorSlot, ErrorFilter>>;
  score: { min: number; max: number } | null;
  repeat: RepeatDistFilter | null;
  latency: { min: number; max: number } | null;
  categories: Record<string, string[]>;
}

export interface RunView {
  q: string;
  sort: SortBy;
  view: 'cards' | 'heatmap';
  metric: string | null;
  /** 0–1 pass threshold for `metric`; null = the metric's default. */
  threshold: number | null;
  show: ItemShow;
  filters: PageFilters;
  page: number;
  hideFields: string[];
  hideMetricFields: string[];
}

export const emptyGroup = (): FilterGroup => ({ op: 'and', children: [] });
export const emptyFilters = (): PageFilters => ({
  rules: emptyGroup(),
  approval: null,
  complexity: null,
  domain: null,
  domainMode: 'include',
  domainOnly: [],
  rootCause: null,
  rootCauseMetric: 'all',
  errors: {},
  score: null,
  repeat: null,
  latency: null,
  categories: {},
});
export const emptyView = (): RunView => ({
  q: '',
  sort: 'index',
  view: 'cards',
  metric: null,
  threshold: null,
  show: 'all',
  filters: emptyFilters(),
  page: 1,
  hideFields: [],
  hideMetricFields: [],
});

export const isFilterGroup = (node: FilterNode): node is FilterGroup =>
  Array.isArray((node as FilterGroup).children);

/* ── field definitions ── */

export type FieldKind = 'metric' | 'number' | 'enum' | 'bool' | 'text';
export interface FieldDef {
  id: string;
  label: string;
  group: 'Metrics' | 'Item' | 'Metadata' | 'State';
  kind: FieldKind;
  percent?: boolean;
  values?: string[];
  get: (row: Row) => unknown;
  verdict?: (row: Row) => boolean | null;
}

export interface FilterContext {
  model: RunModel;
  /** Effective pass thresholds per metric (defaults overridden by the view's `threshold`). */
  thresholds: Record<string, number>;
  selectedMetric: string | null;
  repeatAggregate: boolean;
}

export function effectiveThresholds(
  model: RunModel,
  view: Pick<RunView, 'metric' | 'threshold'>,
): Record<string, number> {
  const out = { ...model.defaultThresholds };
  const metric = view.metric ?? model.defaultMetric;
  if (metric && view.threshold != null) out[metric] = view.threshold;
  return out;
}

export function metricPassesFor(ctx: FilterContext, metric: string, value: number | null): boolean | null {
  return metricPasses(
    value,
    ctx.thresholds[metric] ?? 0.8,
    ctx.model.metricDirections[metric] ?? null,
    !!ctx.model.metricIsBoolean[metric],
  );
}

export function rowScoreFor(ctx: FilterContext, row: Row, metricIndex: number, metric: string): RowScore {
  return getRowScore(row, metricIndex, metric, ctx.model.metricDirections[metric] ?? null);
}

export function rowPassesFor(ctx: FilterContext, metric: string, outcome: RowScore): boolean | null {
  return rowMetricPasses(
    outcome,
    ctx.thresholds[metric] ?? 0.8,
    ctx.model.metricDirections[metric] ?? null,
    !!ctx.model.metricIsBoolean[metric],
  );
}

const MAX_CHOICES = 40;
const COMPLEXITY_ORDER = ['easy', 'medium', 'hard'];
const rank = (value: string) => {
  const i = COMPLEXITY_ORDER.indexOf(value.toLowerCase());
  return i < 0 ? COMPLEXITY_ORDER.length : i;
};

export function metadataFieldDefs(rows: Row[]): FieldDef[] {
  const seen = new Map<string, { values: Set<string>; numeric: boolean }>();
  for (const row of rows) {
    const md = row.item_metadata;
    if (!md || typeof md !== 'object') continue;
    for (const key of Object.keys(md)) {
      if (HIDDEN_METADATA_KEYS.has(key)) continue;
      let info = seen.get(key);
      if (!info) seen.set(key, (info = { values: new Set(), numeric: true }));
      for (const value of getMetadataCategoryValues(md, key)) {
        info.values.add(value);
        if (info.numeric && (!value.trim() || !Number.isFinite(Number(value)))) info.numeric = false;
      }
    }
  }
  return Array.from(seen.keys())
    .sort()
    .flatMap((key): FieldDef[] => {
      const info = seen.get(key)!;
      const values = Array.from(info.values);
      if (!values.length) return [];
      const valuesOf = (row: Row) => getMetadataCategoryValues(row.item_metadata, key);
      const base = { id: 'cat:' + key, label: formatFieldName(key), group: 'Metadata' as const };
      if (values.length <= MAX_CHOICES) {
        values.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }));
        return [{ ...base, kind: 'enum', values, get: valuesOf }];
      }
      if (info.numeric) {
        return [
          {
            ...base,
            kind: 'number',
            get: (row) => {
              const first = valuesOf(row)[0];
              return first === undefined ? null : Number(first);
            },
          },
        ];
      }
      return [{ ...base, kind: 'text', get: (row) => valuesOf(row).join(', ') }];
    });
}

export function buildFieldDefs(ctx: FilterContext): FieldDef[] {
  const { model } = ctx;
  const defs: FieldDef[] = [];
  model.metricNames.forEach((name, i) => {
    const type = model.metricTypes[name] ?? 'score';
    defs.push({
      id: 'metric:' + name,
      label: name,
      group: 'Metrics',
      kind: type === 'numeric' || !model.metricDirections[name] ? 'number' : 'metric',
      percent: type === 'score',
      get: (row) => parseScoreValue((row.metric_values ?? [])[i]),
      verdict: (row) => rowPassesFor(ctx, name, rowScoreFor(ctx, row, i, name)),
    });
  });
  const rootCauses = Array.from(
    new Set(model.rows.flatMap((row) => itemRootCauses(row, ctx.repeatAggregate))),
  ).sort((a, b) => a.localeCompare(b));
  if (rootCauses.length) {
    defs.push({
      id: 'cat:root_cause',
      label: 'Root cause',
      group: 'Item',
      kind: 'enum',
      values: rootCauses,
      get: (row) => itemRootCauses(row, ctx.repeatAggregate),
    });
  }
  defs.push({
    id: 'approval',
    label: 'Approval',
    group: 'Item',
    kind: 'enum',
    values: ['approved', 'not_approved'],
    get: (row) => (getApprovalState(row, ctx.selectedMetric) === 'approved' ? 'approved' : 'not_approved'),
  });
  defs.push({
    id: 'output',
    label: 'Output text',
    group: 'Item',
    kind: 'text',
    get: (row) => stringify(row.output_full ?? row.output ?? ''),
  });
  defs.push(...metadataFieldDefs(model.rows));
  defs.push({ id: 'error', label: 'Has error', group: 'State', kind: 'bool', get: (row) => isErrorRow(row) });
  defs.push({
    id: 'edited',
    label: 'Edited metrics',
    group: 'State',
    kind: 'bool',
    get: (row) => rowHasEditedMetric(row),
  });
  defs.push({
    id: 'retries',
    label: 'Retries',
    group: 'State',
    kind: 'number',
    get: (row) => row.retry_count ?? 0,
  });
  defs.push({
    id: 'traceerr',
    label: 'Trace errors',
    group: 'State',
    kind: 'number',
    get: (row) => rowTraceErrorCount(row),
  });
  defs.push({
    id: 'latency',
    label: 'Latency (ms)',
    group: 'State',
    kind: 'number',
    get: (row) => row.latency_ms ?? 0,
  });
  return defs;
}

export function defaultConditionFor(f: FieldDef | null): FilterCondition {
  if (!f) return { field: '', oper: '', value: '' };
  if (f.kind === 'metric') return { field: f.id, oper: 'is', value: '' };
  if (f.kind === 'enum') return { field: f.id, oper: 'in', value: [] };
  if (f.kind === 'number') return { field: f.id, oper: 'gte', value: '' };
  if (f.kind === 'bool') return { field: f.id, oper: 'is', value: '' };
  return { field: f.id, oper: 'contains', value: '' };
}

/* ── evaluation ── */

export function conditionComplete(node: FilterCondition, defs: Map<string, FieldDef>): boolean {
  const f = defs.get(node.field);
  if (!f) return false;
  if (f.kind === 'enum') return Array.isArray(node.value) && node.value.length > 0;
  if (f.kind === 'metric' && node.oper === 'is') return node.value === 'passed' || node.value === 'failed';
  if (f.kind === 'number' || f.kind === 'metric') {
    return (
      node.value !== '' &&
      node.value !== null &&
      node.value !== undefined &&
      !Number.isNaN(Number(node.value))
    );
  }
  if (f.kind === 'bool') return node.value === 'true' || node.value === 'false';
  return String(node.value ?? '').trim().length > 0;
}

export function filterRuleCount(node: FilterNode, defs: Map<string, FieldDef>): number {
  return isFilterGroup(node)
    ? node.children.reduce((sum, c) => sum + filterRuleCount(c, defs), 0)
    : conditionComplete(node, defs)
      ? 1
      : 0;
}

function numCompare(oper: string, v: unknown, target: unknown): boolean {
  const n = typeof v === 'number' ? v : v === null || v === undefined ? NaN : Number(v);
  if (Number.isNaN(n)) return false;
  const t = Number(target) || 0;
  if (oper === 'gte') return n >= t;
  if (oper === 'gt') return n > t;
  if (oper === 'lte') return n <= t;
  if (oper === 'lt') return n < t;
  if (oper === 'eq') return n === t;
  if (oper === 'neq') return n !== t;
  return true;
}

export type OutputMatcher = (value: string, row: Row) => boolean;

export function evalFilterNode(
  node: FilterNode,
  row: Row,
  defs: Map<string, FieldDef>,
  outputMatcher?: OutputMatcher,
): boolean {
  if (isFilterGroup(node)) {
    const active = node.children.filter((c) => filterRuleCount(c, defs) > 0);
    if (!active.length) return true;
    return node.op === 'or'
      ? active.some((c) => evalFilterNode(c, row, defs, outputMatcher))
      : active.every((c) => evalFilterNode(c, row, defs, outputMatcher));
  }
  if (!conditionComplete(node, defs)) return true;
  const f = defs.get(node.field);
  if (!f) return true;
  const v = f.get(row);
  if (f.kind === 'metric') {
    if (node.oper === 'is') {
      const passed = f.verdict ? f.verdict(row) : null;
      if (passed === null) return false;
      return node.value === 'passed' ? passed : !passed;
    }
    return numCompare(node.oper, v, node.value);
  }
  if (f.kind === 'number') return numCompare(node.oper, v, node.value);
  if (f.kind === 'enum') {
    const wanted = (Array.isArray(node.value) ? node.value : [node.value]).map((x) =>
      String(x).toLowerCase(),
    );
    const have = (Array.isArray(v) ? v : [v]).map((x) => String(x).toLowerCase());
    const hit = have.some((x) => wanted.includes(x));
    return node.oper === 'notin' ? !hit : hit;
  }
  if (f.kind === 'bool') return node.value === 'false' ? !v : !!v;
  if (f.kind === 'text') {
    const needle = String(node.value ?? '');
    const hit =
      node.field === 'output' && outputMatcher
        ? outputMatcher(needle, row)
        : String(v ?? '')
            .toLowerCase()
            .includes(needle.toLowerCase());
    return node.oper === 'notcontains' ? !hit : hit;
  }
  return true;
}

/* ── repeat distribution bucket ── */

export function passValuesFor(ctx: FilterContext, row: Row, metric: string): Array<number | null> {
  const raw = row.pass_scores?.[metric];
  if (!Array.isArray(raw)) return [];
  const leftOut = ctx.model.metricDirections[metric] === 'minimize';
  const outcomes = leftOut ? repeatPassOutcomes(row, metric) : null;
  return raw.map((value, index) => {
    const outcome = outcomes?.[index];
    if (outcome && (outcome.scorerError || outcome.taskError)) return null;
    if (leftOut && (value === null || value === undefined || value === '')) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  });
}

export function repeatDistributionBucket(
  ctx: FilterContext,
  row: Row,
  metric: string,
  samples: number,
  threshold: number,
): number | null {
  if (!Array.isArray(row.pass_scores?.[metric])) return null;
  const direction = ctx.model.metricDirections[metric] ?? 'maximize';
  const correct = passValuesFor(ctx, row, metric).filter(
    (v) => v !== null && metricPasses(v, threshold, direction) === true,
  ).length;
  if (samples <= 10) return Math.min(correct, samples);
  return correct === samples ? 10 : Math.min(9, Math.floor((correct / samples) * 10));
}

/* ── the item pipeline ── */

export interface FilteredItem {
  row: Row;
  score: number | null;
}

export interface ApplyOptions {
  /** Server/precomputed search verdict for lazy snapshots; undefined = client-side text search. */
  searchMatcher?: (row: Row) => boolean;
  outputMatcher?: OutputMatcher;
}

export function applyItemFilters(
  ctx: FilterContext,
  view: RunView,
  defs: FieldDef[],
  opts: ApplyOptions = {},
): FilteredItem[] {
  const { model, repeatAggregate } = ctx;
  const defMap = new Map(defs.map((d) => [d.id, d]));
  const metric = view.metric ?? model.defaultMetric;
  const mIdx = metric ? model.metricNames.indexOf(metric) : -1;
  const f = view.filters;
  const q = view.q.trim().toLowerCase();
  const items: FilteredItem[] = [];

  for (const row of model.rows) {
    if (q) {
      if (opts.searchMatcher) {
        if (!opts.searchMatcher(row)) continue;
      } else {
        const itemId = String(row.item_id ?? row.index ?? '').toLowerCase();
        const inp = stringify(row.input_full ?? row.input ?? row.input_preview ?? '').toLowerCase();
        const exp = stringify(row.expected_full ?? row.expected ?? '').toLowerCase();
        const out = stringify(row.output_full ?? row.output ?? '').toLowerCase();
        if (!itemId.includes(q) && !inp.includes(q) && !exp.includes(q) && !out.includes(q)) continue;
      }
    }
    const md = row.item_metadata && typeof row.item_metadata === 'object' ? row.item_metadata : {};
    if (f.complexity !== null) {
      if (f.complexity.length === 0) continue;
      const val = String(md.complexity ?? '').toLowerCase();
      if (!f.complexity.some((x) => x.toLowerCase() === val)) continue;
    }
    if (f.domain !== null) {
      let domainVals = parseMetaList(md.domain).map((v) => v.toLowerCase());
      if (f.domainMode === 'exclude') {
        if (f.domain.some((x) => domainVals.includes(x.toLowerCase()))) continue;
      } else {
        if (f.domain.length === 0) continue;
        if (!f.domain.every((x) => domainVals.includes(x.toLowerCase()))) continue;
        if (f.domainOnly.length) {
          for (const ex of f.domainOnly) {
            if (domainVals.includes(ex.toLowerCase()) && domainVals.length > 1) {
              domainVals = [];
              break;
            }
          }
          if (domainVals.length === 0) continue;
        }
      }
    }
    if (f.rootCause !== null) {
      if (f.rootCause.length === 0) continue;
      const rcValues = getRowRootCauseAnalyses(row, f.rootCauseMetric, repeatAggregate)
        .flatMap((a) => rootCauseCategories(a))
        .map((v) => v.toLowerCase());
      const wantNone = f.rootCause.includes('__none__');
      const named = f.rootCause.filter((x) => x !== '__none__');
      const matchesNamed = named.length > 0 && named.some((x) => rcValues.includes(x.toLowerCase()));
      if (!matchesNamed && !(wantNone && rcValues.length === 0)) continue;
    }
    if (f.approval !== null) {
      const state = getApprovalState(row, metric);
      if (!state || state !== f.approval) continue;
    }
    let customFail = false;
    for (const [key, values] of Object.entries(f.categories)) {
      if (values === null) continue;
      if (values.length === 0) {
        customFail = true;
        break;
      }
      const itemVals = getMetadataCategoryValues(md, key).map((v) => v.toLowerCase());
      const effective = itemVals.length ? itemVals : ['unknown'];
      if (!values.some((x) => effective.includes(String(x).toLowerCase()))) {
        customFail = true;
        break;
      }
    }
    if (customFail) continue;
    if (!ERROR_SLOTS.every(([slot]) => rowMatchesErrorFilter(row, f.errors[slot], repeatAggregate))) continue;

    let score: number | null = null;
    let scoreIsError = false;
    if (mIdx >= 0 && metric) {
      const result = rowScoreFor(ctx, row, mIdx, metric);
      score = result.score;
      scoreIsError = result.isError;
    }
    if (view.show === 'passed') {
      if (scoreIsError || !metric || metricPassesFor(ctx, metric, score) !== true) continue;
    } else if (view.show === 'failed') {
      if (scoreIsError || !metric || metricPassesFor(ctx, metric, score) !== false) continue;
    } else if (view.show === 'metric_errors') {
      if (!scoreIsError) continue;
    } else if (view.show === 'errors') {
      if (!isErrorRow(row)) continue;
    } else if (view.show === 'edited_metrics') {
      if (!rowHasEditedMetric(row)) continue;
    } else if (view.show === 'retries') {
      if ((row.retry_count ?? 0) <= 0) continue;
    } else if (view.show === 'trace_errors') {
      if (rowTraceErrorCount(row) <= 0) continue;
    }
    if (!evalFilterNode(f.rules, row, defMap, opts.outputMatcher)) continue;
    if (f.score) {
      if (score === null) continue;
      if (score < f.score.min || score >= f.score.max) continue;
    }
    if (f.repeat) {
      const bucket = repeatDistributionBucket(
        ctx,
        row,
        f.repeat.metric,
        f.repeat.samples,
        f.repeat.threshold,
      );
      if (bucket === null || bucket !== f.repeat.bucket) continue;
    }
    if (f.latency) {
      const lat = row.latency_ms ?? 0;
      if (lat < f.latency.min || lat >= f.latency.max) continue;
    }
    items.push({ row, score });
  }

  const byScore = (a: FilteredItem, b: FilteredItem, sign: number) => {
    if (a.score == null || b.score == null) return Number(a.score == null) - Number(b.score == null);
    return sign * (a.score - b.score);
  };
  if (view.sort === 'score_asc') items.sort((a, b) => byScore(a, b, 1));
  else if (view.sort === 'score_desc') items.sort((a, b) => byScore(a, b, -1));
  else if (view.sort === 'latency_asc')
    items.sort((a, b) => (a.row.latency_ms ?? 0) - (b.row.latency_ms ?? 0));
  else if (view.sort === 'latency_desc')
    items.sort((a, b) => (b.row.latency_ms ?? 0) - (a.row.latency_ms ?? 0));
  return items;
}

/** Number of active filters (rule conditions + page filters). Search and sort are not filters. */
export function countActiveFilters(view: RunView, defs: FieldDef[]): number {
  const f = view.filters;
  let n = filterRuleCount(f.rules, new Map(defs.map((d) => [d.id, d])));
  if (view.show !== 'all') n++;
  if (f.approval !== null) n++;
  if (f.complexity !== null) n++;
  if (f.domain !== null) n++;
  if (f.rootCause !== null) n++;
  n += Object.keys(f.errors).filter((k) => f.errors[k as ErrorSlot]).length;
  if (f.score) n++;
  if (f.repeat) n++;
  if (f.latency) n++;
  n += Object.values(f.categories).filter((v) => v !== null).length;
  return n;
}

/* ── URL codec ── */

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 500 && value.every((item) => typeof item === 'string');
const isNumberPair = (value: unknown): value is [number, number | null] =>
  Array.isArray(value) &&
  value.length === 2 &&
  typeof value[0] === 'number' &&
  (typeof value[1] === 'number' || value[1] === null);

export function validFilterRule(node: unknown, depth = 0): node is FilterNode {
  if (!node || typeof node !== 'object' || depth > 6) return false;
  const n = node as Record<string, unknown>;
  if (Array.isArray(n.children)) {
    return (
      (n.op === 'and' || n.op === 'or') &&
      n.children.length <= 50 &&
      n.children.every((child) => validFilterRule(child, depth + 1))
    );
  }
  const value = n.value;
  return (
    typeof n.field === 'string' &&
    typeof n.oper === 'string' &&
    (typeof value === 'string' || typeof value === 'number' || isStringList(value))
  );
}

export function encodeFiltersParam(f: PageFilters, defs: FieldDef[]): string | null {
  const out: Record<string, unknown> = {};
  if (filterRuleCount(f.rules, new Map(defs.map((d) => [d.id, d]))) > 0) out.rules = f.rules;
  if (f.approval !== null) out.approval = f.approval;
  if (f.complexity !== null) out.complexity = f.complexity;
  if (f.domain !== null) {
    out.domain = f.domain;
    if (f.domainMode === 'exclude') out.domainMode = 'exclude';
    if (f.domainOnly.length) out.domainOnly = f.domainOnly;
  }
  if (f.rootCause !== null) {
    out.rootCause = f.rootCause;
    if (f.rootCauseMetric !== 'all') out.rootCauseMetric = f.rootCauseMetric;
  }
  const errors: Record<string, unknown> = {};
  ERROR_SLOTS.forEach(([slot]) => {
    const filter = f.errors[slot];
    if (filter) errors[slot] = errorFilterUrlValue(filter);
  });
  if (Object.keys(errors).length) out.errors = errors;
  if (f.score) out.score = [f.score.min, f.score.max];
  if (f.repeat) out.repeat = f.repeat;
  if (f.latency) out.latency = [f.latency.min, Number.isFinite(f.latency.max) ? f.latency.max : null];
  const categories: Record<string, string[]> = {};
  Object.entries(f.categories).forEach(([k, v]) => {
    if (v !== null) categories[k] = v;
  });
  if (Object.keys(categories).length) out.categories = categories;
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

export interface DecodeContext {
  metricNames: string[];
  metadataKeys: string[];
  rows: Row[];
  repeatAggregate: boolean;
}

export function decodeFiltersParam(raw: string | null | undefined, ctx: DecodeContext): PageFilters {
  const f = emptyFilters();
  if (!raw) return f;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return f;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return f;
  const p = parsed as Record<string, unknown>;
  if (validFilterRule(p.rules) && isFilterGroup(p.rules)) f.rules = p.rules;
  if (p.approval === 'approved' || p.approval === 'not_approved') f.approval = p.approval;
  if (isStringList(p.complexity)) f.complexity = p.complexity;
  if (isStringList(p.domain)) {
    f.domain = p.domain;
    f.domainMode = p.domainMode === 'exclude' ? 'exclude' : 'include';
    if (f.domainMode === 'include' && isStringList(p.domainOnly)) f.domainOnly = p.domainOnly;
  }
  if (isStringList(p.rootCause)) {
    f.rootCause = p.rootCause;
    if (typeof p.rootCauseMetric === 'string' && ctx.metricNames.includes(p.rootCauseMetric))
      f.rootCauseMetric = p.rootCauseMetric;
  }
  const errors =
    p.errors && typeof p.errors === 'object' ? (p.errors as Record<string, Record<string, unknown>>) : {};
  ERROR_SLOTS.forEach(([slot]) => {
    const value = errors[slot];
    if (!value || typeof value.kind !== 'string') return;
    if (typeof value.label === 'string') f.errors[slot] = { kind: value.kind, label: value.label };
    else if (typeof value.prefix === 'string' && typeof value.hash === 'string') {
      const label = errorLabelFromUrlValue(
        ctx.rows,
        ctx.repeatAggregate,
        value.kind,
        value.prefix,
        value.hash,
      );
      if (label !== null) f.errors[slot] = { kind: value.kind, label };
    }
  });
  if (isNumberPair(p.score) && p.score[1] !== null) f.score = { min: p.score[0], max: p.score[1] };
  const repeat = p.repeat as Record<string, unknown> | undefined;
  if (
    repeat &&
    typeof repeat === 'object' &&
    typeof repeat.metric === 'string' &&
    ctx.metricNames.includes(repeat.metric) &&
    (['bucket', 'samples', 'threshold'] as const).every((k) => Number.isFinite(repeat[k]))
  ) {
    f.repeat = {
      metric: repeat.metric,
      bucket: repeat.bucket as number,
      samples: repeat.samples as number,
      threshold: repeat.threshold as number,
    };
  }
  if (isNumberPair(p.latency))
    f.latency = { min: p.latency[0], max: p.latency[1] === null ? Infinity : p.latency[1] };
  if (p.categories && typeof p.categories === 'object' && !Array.isArray(p.categories)) {
    Object.entries(p.categories as Record<string, unknown>).forEach(([key, value]) => {
      if (!isStringList(value) || key === '__proto__' || !ctx.metadataKeys.includes(key)) return;
      if (['approval', 'complexity', 'domain', 'root_cause'].includes(key)) return;
      f.categories[key] = value;
    });
  }
  return f;
}

export interface ViewCodecContext extends DecodeContext {
  model: RunModel;
}

/** Read the view from the query string (applyRunViewUrlState). */
export function readRunView(params: URLSearchParams, ctx: ViewCodecContext): RunView {
  const { model } = ctx;
  const view = emptyView();
  view.q = (params.get('q') ?? '').trim();
  const sort = params.get('sort');
  if (sort && (SORT_VALUES as readonly string[]).includes(sort)) view.sort = sort as SortBy;
  const metric = params.get('metric');
  if (metric && model.metricNames.includes(metric)) view.metric = metric;
  const selected = view.metric ?? model.defaultMetric;
  const thresholdRaw = params.get('threshold');
  if (thresholdRaw !== null && selected) {
    const t = Number(thresholdRaw);
    const applies =
      !model.metricIsBoolean[selected] &&
      model.metricTypes[selected] !== 'numeric' &&
      !!model.metricDirections[selected];
    if (applies && Number.isFinite(t) && t >= 0 && t <= 100) view.threshold = t / 100;
  }
  if (params.get('view') === 'heatmap' && model.samples > 1) view.view = 'heatmap';
  const show = params.get('show');
  if (show && (ITEM_SHOW_VALUES as readonly string[]).includes(show)) view.show = show as ItemShow;
  view.filters = decodeFiltersParam(params.get('filters'), ctx);
  view.hideFields = params.getAll('hide_field').filter((k) => model.allMetadataKeys.includes(k));
  view.hideMetricFields = params
    .getAll('hide_metric_field')
    .filter((k) => model.allMetricMetaKeys.includes(k));
  const page = parseInt(params.get('page') ?? '', 10);
  if (Number.isFinite(page) && page > 1) view.page = page;
  return view;
}

/** The query updates for a view (runViewParams); null removes a key, arrays repeat it. */
export function writeRunView(
  view: RunView,
  model: RunModel,
  defs: FieldDef[],
): Record<string, string | string[] | null> {
  const metric = view.metric ?? model.defaultMetric;
  const defaultThreshold = metric ? model.defaultThresholds[metric] : null;
  const threshold = view.threshold;
  const heatmap = view.view === 'heatmap';
  return {
    q: view.q || null,
    sort: view.sort !== 'index' ? view.sort : null,
    view: heatmap ? 'heatmap' : null,
    metric: view.metric && view.metric !== model.defaultMetric ? view.metric : null,
    threshold:
      threshold != null && defaultThreshold != null && Math.abs(threshold - defaultThreshold) > 1e-9
        ? String(Math.round(threshold * 100))
        : null,
    show: view.show !== 'all' ? view.show : null,
    filters: encodeFiltersParam(view.filters, defs),
    page: !heatmap && view.page > 1 ? String(view.page) : null,
    hide_field: view.hideFields.length ? view.hideFields : null,
    hide_metric_field: view.hideMetricFields.length ? view.hideMetricFields : null,
  };
}
