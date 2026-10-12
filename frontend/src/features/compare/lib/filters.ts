/**
 * Item filtering for the compare page: the rule tree, the filters set by
 * clicking the page, the view params and their URL codec (compare.html
 * getFilteredItems / compareFilterFieldDefs / compareViewFiltersParam /
 * applyCompareViewFiltersParam, brief 05 J6). The `filters` JSON stays
 * byte-compatible with the vanilla page (`tests/platform/test_compare_filter_fields_javascript.py`).
 */
import { SKIPPED_METADATA } from './skipMetadata';
import type { metricDirection } from '@/lib/metrics';
import { isErrorRow } from '@/lib/metrics';
import type { Row } from '@/features/run-detail/types';
import {
  errorFilterUrlValue,
  errorLabelFromUrlValue,
  rowMatchesErrorFilter,
  type ErrorFilter,
  type ErrorSlot,
} from '@/features/run-detail/lib/rowErrors';
import {
  formatFieldName,
  getApprovalState,
  getMetadataCategoryValues,
  getRowRootCauseAnalyses,
  parseMetaList,
  rootCauseCategories,
  rowHasEditedMetric,
} from '@/features/run-detail/lib/rowMeta';
import { columnItemScores, deltaKind, metricColumns, type DeltaKind, type PassColumns } from './baseline';
import { computeGroupedComparison, type CohortGroups } from './cohort';
import type { CompareModel } from './model';
import { itemOutcomes, metricCtx, type MetricCtx } from './scoring';
import { computeComparisonStats, type ComparisonStats } from './stats';

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

export const isFilterGroup = (n: FilterNode): n is FilterGroup => Array.isArray((n as FilterGroup).children);

export interface BaselineFilter {
  metric: string;
  columnKey: string;
  baselineKey: string;
  kind: string;
}

export interface CompareFilters {
  rules: FilterGroup;
  approval: 'approved' | 'not_approved' | null;
  complexity: string[] | null;
  domain: string[] | null;
  domainMode: 'include' | 'exclude';
  domainOnly: string[];
  rootCause: string[] | null;
  rootCauseMetric: string;
  errors: Partial<Record<ErrorSlot, ErrorFilter>>;
  passRate: ['gte' | 'lte' | 'eq', number] | null;
  baseline: BaselineFilter | null;
  categories: Record<string, string[]>;
}

export const SORT_VALUES = ['score_asc', 'score_desc', 'latency_asc', 'latency_desc'] as const;
export type SortBy = 'index' | (typeof SORT_VALUES)[number];
export const SHOW_VALUES = [
  'different',
  'errors',
  'edited_metrics',
  'all_correct',
  'all_wrong',
  'rarely_solved',
  'unique_solve',
  'partially_correct',
] as const;
export const GROUPED_PREFIX = 'grouped:';

export interface CompareView {
  metric: string | null;
  show: string;
  winner: string;
  q: string;
  sort: SortBy;
  page: number;
  tab: 'compare' | 'sweep';
  item: string | null;
  filters: CompareFilters;
  baseline: string | null;
  columns: PassColumns;
  /** `thr=metric:0.7` (new, additive: shareable pass thresholds, Q9). */
  thresholds: Record<string, number>;
}

export const emptyGroup = (): FilterGroup => ({ op: 'and', children: [] });
export const emptyFilters = (): CompareFilters => ({
  rules: emptyGroup(),
  approval: null,
  complexity: null,
  domain: null,
  domainMode: 'include',
  domainOnly: [],
  rootCause: null,
  rootCauseMetric: 'all',
  errors: {},
  passRate: null,
  baseline: null,
  categories: {},
});
export const emptyView = (): CompareView => ({
  metric: null,
  show: 'all',
  winner: 'any',
  q: '',
  sort: 'index',
  page: 1,
  tab: 'compare',
  item: null,
  filters: emptyFilters(),
  baseline: null,
  columns: 'run',
  thresholds: {},
});

/* ── URL codec ── */

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.length <= 500 && v.every((i) => typeof i === 'string');

export function validFilterRule(node: unknown, depth = 0): node is FilterNode {
  if (!node || typeof node !== 'object' || depth > 6) return false;
  const n = node as Record<string, unknown>;
  if (Array.isArray(n.children)) {
    return (
      (n.op === 'and' || n.op === 'or') &&
      n.children.length <= 50 &&
      n.children.every((c) => validFilterRule(c, depth + 1))
    );
  }
  const value = n.value;
  return (
    typeof n.field === 'string' &&
    typeof n.oper === 'string' &&
    (typeof value === 'string' || typeof value === 'number' || isStringList(value))
  );
}

export function filterRuleCountRaw(node: FilterNode, complete: (c: FilterCondition) => boolean): number {
  return isFilterGroup(node)
    ? node.children.reduce((s, c) => s + filterRuleCountRaw(c, complete), 0)
    : complete(node)
      ? 1
      : 0;
}

/** A condition is complete when it carries a usable value (field existence is checked at evaluation). */
export function conditionHasValue(c: FilterCondition): boolean {
  if (!c.field) return false;
  if (Array.isArray(c.value)) return c.value.length > 0;
  if (c.oper === 'is')
    return c.value === 'true' || c.value === 'false' || c.value === 'passed' || c.value === 'failed';
  return String(c.value ?? '').trim().length > 0;
}

export function encodeFiltersParam(f: CompareFilters): string | null {
  const out: Record<string, unknown> = {};
  // Draft (incomplete) rules are kept so the builder can be edited; they are ignored when filtering.
  if (f.rules.children.length > 0) out.rules = f.rules;
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
  (['task', 'metric', 'trace', 'analysis'] as ErrorSlot[]).forEach((slot) => {
    const e = f.errors[slot];
    if (e) errors[slot] = errorFilterUrlValue(e);
  });
  if (Object.keys(errors).length) out.errors = errors;
  if (f.passRate) out.passRate = f.passRate;
  if (f.baseline) out.baseline = f.baseline;
  if (Object.keys(f.categories).length) out.categories = f.categories;
  return Object.keys(out).length ? JSON.stringify(out) : null;
}

export interface DecodeContext {
  metrics: string[];
  metadataKeys: string[];
  runCount: number;
  rows: Row[];
}

/** Invalid or unknown parts are dropped silently (a stale link must still open). */
export function decodeFiltersParam(raw: string | null | undefined, ctx: DecodeContext): CompareFilters {
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
  if (validFilterRule(p.rules, 0) && isFilterGroup(p.rules as FilterNode)) f.rules = p.rules as FilterGroup;
  if (p.approval === 'approved' || p.approval === 'not_approved') f.approval = p.approval;
  if (isStringList(p.complexity)) f.complexity = p.complexity;
  if (isStringList(p.domain)) {
    f.domain = p.domain;
    f.domainMode = p.domainMode === 'exclude' ? 'exclude' : 'include';
    if (f.domainMode === 'include' && isStringList(p.domainOnly)) f.domainOnly = p.domainOnly;
  }
  if (isStringList(p.rootCause)) {
    f.rootCause = p.rootCause;
    if (typeof p.rootCauseMetric === 'string' && ctx.metrics.includes(p.rootCauseMetric))
      f.rootCauseMetric = p.rootCauseMetric;
  }
  const errors = p.errors && typeof p.errors === 'object' ? (p.errors as Record<string, unknown>) : {};
  (['task', 'metric', 'trace', 'analysis'] as ErrorSlot[]).forEach((slot) => {
    const v = errors[slot] as Record<string, unknown> | undefined;
    if (!v || typeof v.kind !== 'string') return;
    if (typeof v.label === 'string') f.errors[slot] = { kind: v.kind, label: v.label };
    else if (typeof v.prefix === 'string' && typeof v.hash === 'string') {
      const label = errorLabelFromUrlValue(ctx.rows, false, v.kind, v.prefix, v.hash);
      if (label !== null) f.errors[slot] = { kind: v.kind, label };
    }
  });
  const pr = p.passRate;
  if (
    Array.isArray(pr) &&
    ['gte', 'lte', 'eq'].includes(pr[0] as string) &&
    Number.isInteger(pr[1]) &&
    (pr[1] as number) >= 0 &&
    (pr[1] as number) <= ctx.runCount
  )
    f.passRate = [pr[0] as 'gte' | 'lte' | 'eq', pr[1] as number];
  const b = p.baseline as Record<string, unknown> | undefined;
  if (
    b &&
    typeof b === 'object' &&
    typeof b.metric === 'string' &&
    ctx.metrics.includes(b.metric) &&
    ['columnKey', 'baselineKey', 'kind'].every((k) => typeof b[k] === 'string')
  )
    f.baseline = {
      metric: b.metric,
      columnKey: b.columnKey as string,
      baselineKey: b.baselineKey as string,
      kind: b.kind as string,
    };
  const cats = p.categories;
  if (cats && typeof cats === 'object' && !Array.isArray(cats)) {
    for (const [key, value] of Object.entries(cats as Record<string, unknown>)) {
      if (!isStringList(value) || key === '__proto__' || !ctx.metadataKeys.includes(key)) continue;
      if (['approval', 'complexity', 'domain', 'root_cause'].includes(key)) continue;
      f.categories[key] = value;
    }
  }
  return f;
}

function parseThresholds(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) {
    const at = v.lastIndexOf(':');
    if (at <= 0) continue;
    const n = Number(v.slice(at + 1));
    if (Number.isFinite(n) && n >= 0 && n <= 1) out[v.slice(0, at)] = n;
  }
  return out;
}

export function readView(params: URLSearchParams, ctx: DecodeContext): CompareView {
  const v = emptyView();
  const metric = params.get('metric');
  if (metric && ctx.metrics.includes(metric)) v.metric = metric;
  v.show = params.get('filter') || 'all';
  v.winner = params.get('winner') || 'any';
  v.q = params.get('q') ?? '';
  const sort = params.get('sort');
  if (sort && (SORT_VALUES as readonly string[]).includes(sort)) v.sort = sort as SortBy;
  const page = parseInt(params.get('page') ?? '', 10);
  v.page = Number.isFinite(page) && page > 1 ? page : 1;
  v.tab = params.get('tab') === 'sweep' ? 'sweep' : 'compare';
  v.item = params.get('item') || null;
  v.baseline = params.get('baseline') || null;
  v.columns = params.get('columns') === 'passes' ? 'each' : 'run';
  v.thresholds = parseThresholds(params.getAll('thr'));
  v.filters = decodeFiltersParam(params.get('filters'), ctx);
  return v;
}

/** Updates for `replaceUrlQuery`: defaults drop their key. */
export function writeView(
  v: CompareView,
  defaultMetric: string | null,
): Record<string, string | string[] | null> {
  return {
    metric: v.metric && v.metric !== defaultMetric ? v.metric : null,
    filter: v.show && v.show !== 'all' ? v.show : null,
    winner: v.winner && v.winner !== 'any' ? v.winner : null,
    q: v.q || null,
    sort: v.sort !== 'index' ? v.sort : null,
    page: v.page > 1 ? String(v.page) : null,
    tab: v.tab === 'sweep' ? 'sweep' : null,
    item: v.item,
    filters: encodeFiltersParam(v.filters),
    baseline: v.baseline,
    columns: v.columns === 'each' ? 'passes' : null,
    thr: Object.entries(v.thresholds).map(([m, t]) => `${m}:${t}`),
  };
}

/* ── evaluation ── */

export type FieldKind = 'number' | 'enum' | 'bool' | 'text';
export interface FieldChoice {
  value: string;
  label: string;
}
export interface FieldDef {
  id: string;
  label: string;
  group: 'Comparison' | 'Scores' | 'Metadata' | 'Review' | 'State' | 'Content' | 'Performance';
  kind: FieldKind;
  percent?: boolean;
  choices?: FieldChoice[];
  get: (c: ItemContext) => unknown;
}

export interface ItemContext {
  itemId: string;
  rows: Array<Row | null>;
  scores: Array<number | null>;
  outcomes: string[];
  winners: string[];
  passCount: number;
  hasError: boolean;
  hasEditedMetric: boolean;
  approvals: string[];
  outputText: string;
  maxLatency: number;
  rootCauses: string[];
}

const COMPLEXITY_ORDER = ['easy', 'medium', 'hard'];
const rank = (v: string) => {
  const i = COMPLEXITY_ORDER.indexOf(v.toLowerCase());
  return i < 0 ? COMPLEXITY_ORDER.length : i;
};

export function runRowRootCauses(row: Row | null, metric: string | 'all' = 'all'): string[] {
  return row ? getRowRootCauseAnalyses(row, metric, false).flatMap((a) => rootCauseCategories(a)) : [];
}

const defsCache = new WeakMap<CompareModel, Map<string, FieldDef[]>>();
/** Field definitions scan every row's metadata once per model + metric. */
export function fieldDefsFor(model: CompareModel, metric: string | null): FieldDef[] {
  let byMetric = defsCache.get(model);
  if (!byMetric) defsCache.set(model, (byMetric = new Map()));
  const key = metric ?? '';
  let defs = byMetric.get(key);
  if (!defs) byMetric.set(key, (defs = buildFieldDefs(model, metric)));
  return defs;
}

const statsCache = new WeakMap<CompareModel, Map<string, ComparisonStats>>();
/** Stats over every item (winners), memoised per metric/threshold. */
export function fullStatsFor(model: CompareModel, ctx: MetricCtx): ComparisonStats {
  let byKey = statsCache.get(model);
  if (!byKey) statsCache.set(model, (byKey = new Map()));
  const key = `${ctx.metric}|${ctx.direction ?? ''}|${ctx.threshold}`;
  let stats = byKey.get(key);
  if (!stats) byKey.set(key, (stats = computeComparisonStats(model, ctx)));
  return stats;
}

export function buildFieldDefs(model: CompareModel, metric: string | null): FieldDef[] {
  const choices = (list: Array<string | FieldChoice>): FieldChoice[] =>
    list.map((c) => (typeof c === 'string' ? { value: c, label: c } : c));
  const defs: FieldDef[] = [
    {
      id: 'outcome',
      label: 'Outcome',
      group: 'Comparison',
      kind: 'enum',
      choices: choices([
        { value: 'different', label: 'Different outputs' },
        { value: 'errors', label: 'With errors' },
        { value: 'edited_metrics', label: 'With edited metrics' },
        { value: 'all_correct', label: 'All runs correct' },
        { value: 'all_wrong', label: 'No run correct' },
        { value: 'partially_correct', label: 'Partially correct' },
        { value: 'rarely_solved', label: 'Rarely solved (≤25%)' },
        { value: 'unique_solve', label: 'Uniquely solved' },
      ]),
      get: (c) => c.outcomes,
    },
  ];
  const winnerChoices: FieldChoice[] = [{ value: 'tie', label: 'Tie' }];
  model.runs.forEach((run, i) => {
    winnerChoices.push({ value: `win_${i}`, label: `${run.label} won` });
    winnerChoices.push({ value: `only_${i}`, label: `Only ${run.label} solved` });
  });
  defs.push({
    id: 'winner',
    label: 'Winner',
    group: 'Comparison',
    kind: 'enum',
    choices: winnerChoices,
    get: (c) => c.winners,
  });
  defs.push({
    id: 'pass_count',
    label: 'Passing runs',
    group: 'Comparison',
    kind: 'number',
    get: (c) => c.passCount,
  });
  const percent = (model.types[metric ?? ''] ?? 'score') === 'score';
  model.runs.forEach((run, i) =>
    defs.push({
      id: `score:${i}`,
      label: `${run.label} · ${metric ?? 'score'}`,
      group: 'Scores',
      kind: 'number',
      percent,
      get: (c) => c.scores[i],
    }),
  );
  const rc = new Set<string>();
  model.runs.forEach((r) => r.rows.forEach((row) => runRowRootCauses(row).forEach((v) => rc.add(v))));
  if (rc.size)
    defs.push({
      id: 'cat:root_cause',
      label: 'Root cause',
      group: 'Metadata',
      kind: 'enum',
      choices: choices(Array.from(rc).sort((a, b) => a.localeCompare(b))),
      get: (c) => c.rootCauses,
    });
  const seen = new Map<string, { values: Set<string>; numeric: boolean }>();
  model.runs.forEach((r) =>
    r.rows.forEach((row) => {
      const md = row.item_metadata;
      if (!md || typeof md !== 'object') return;
      Object.keys(md).forEach((key) => {
        if (SKIPPED_METADATA.has(key)) return;
        let info = seen.get(key);
        if (!info) seen.set(key, (info = { values: new Set(), numeric: true }));
        getMetadataCategoryValues(md, key).forEach((value) => {
          info!.values.add(value);
          if (info!.numeric && (!value.trim() || !Number.isFinite(Number(value)))) info!.numeric = false;
        });
      });
    }),
  );
  Array.from(seen.keys())
    .sort()
    .forEach((key) => {
      const info = seen.get(key)!;
      const values = Array.from(info.values);
      if (!values.length) return;
      const base = { id: `cat:${key}`, label: formatFieldName(key), group: 'Metadata' as const };
      const valuesOf = (c: ItemContext) =>
        c.rows.flatMap((row) => (row ? getMetadataCategoryValues(row.item_metadata, key) : []));
      if (values.length <= 40) {
        values.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, undefined, { numeric: true }));
        defs.push({ ...base, kind: 'enum', choices: choices(values), get: valuesOf });
      } else if (info.numeric)
        defs.push({ ...base, kind: 'number', get: (c) => valuesOf(c).map(Number).filter(Number.isFinite) });
      else defs.push({ ...base, kind: 'text', get: (c) => valuesOf(c).join(', ') });
    });
  defs.push({
    id: 'approval',
    label: 'Approval',
    group: 'Review',
    kind: 'enum',
    choices: choices([
      { value: 'approved', label: 'Approved' },
      { value: 'not_approved', label: 'Not approved' },
    ]),
    get: (c) => c.approvals,
  });
  defs.push({ id: 'error', label: 'Has error', group: 'State', kind: 'bool', get: (c) => c.hasError });
  defs.push({
    id: 'edited',
    label: 'Edited metrics',
    group: 'State',
    kind: 'bool',
    get: (c) => c.hasEditedMetric,
  });
  defs.push({ id: 'output', label: 'Output text', group: 'Content', kind: 'text', get: (c) => c.outputText });
  defs.push({
    id: 'latency',
    label: 'Max latency (ms)',
    group: 'Performance',
    kind: 'number',
    get: (c) => c.maxLatency,
  });
  return defs;
}

function numCompare(oper: string, v: unknown, target: unknown): boolean {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return false;
  const a = Number(v);
  const t = Number(target) || 0;
  if (oper === 'gte') return a >= t;
  if (oper === 'gt') return a > t;
  if (oper === 'lte') return a <= t;
  if (oper === 'lt') return a < t;
  if (oper === 'eq') return a === t;
  if (oper === 'neq') return a !== t;
  return true;
}

export type TextMatcher = (field: 'content' | 'output', needle: string, c: ItemContext) => boolean;

export function evalFilterNode(
  node: FilterNode,
  c: ItemContext,
  defs: Map<string, FieldDef>,
  match?: TextMatcher,
): boolean {
  if (isFilterGroup(node)) {
    const active = node.children.filter(
      (ch) => filterRuleCountRaw(ch, (x) => conditionHasValue(x) && defs.has(x.field)) > 0,
    );
    if (!active.length) return true;
    return node.op === 'or'
      ? active.some((ch) => evalFilterNode(ch, c, defs, match))
      : active.every((ch) => evalFilterNode(ch, c, defs, match));
  }
  if (!conditionHasValue(node)) return true;
  const f = defs.get(node.field);
  if (!f) return true;
  const value = f.get(c);
  if (f.kind === 'number')
    return (Array.isArray(value) ? value : [value]).some((x) => numCompare(node.oper, x, node.value));
  if (f.kind === 'enum') {
    const wanted = (Array.isArray(node.value) ? node.value : [node.value]).map((x) =>
      String(x).toLowerCase(),
    );
    const have = (Array.isArray(value) ? value : [value]).map((x) => String(x).toLowerCase());
    const hit = have.some((x) => wanted.includes(x));
    return node.oper === 'notin' ? !hit : hit;
  }
  if (f.kind === 'bool') return node.value === 'false' ? !value : !!value;
  const needle = String(node.value ?? '');
  const hit =
    f.id === 'output' && match
      ? match('output', needle, c)
      : String(value ?? '')
          .toLowerCase()
          .includes(needle.toLowerCase());
  return node.oper === 'notcontains' ? !hit : hit;
}

/* ── the filtered item list ── */

export interface FilteredItem {
  itemId: string;
  rows: Array<Row | null>;
  /** Score of each run on the item metric (null = none). */
  scores: Array<number | null>;
}

export interface ApplyInput {
  model: CompareModel;
  view: CompareView;
  /** Item metric: view.metric, else the model default. */
  metric: string | null;
  thresholds: Record<string, number>;
  groups: CohortGroups | null;
  /** Server-side or body-based text match; default searches ids, previews and loaded bodies. */
  match?: TextMatcher;
}

export interface ApplyResult {
  items: FilteredItem[];
  /** Stats over every item, for winners (independent of the filters). */
  stats: ComparisonStats | null;
  defs: FieldDef[];
}

function outputIdentity(row: Row | null): string {
  if (!row) return '';
  if (row.output_digest === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855') return '';
  return String(row.output_digest ?? (row.output_full || row.output || ''));
}

export function rowText(row: Row | null): string {
  if (!row) return '';
  const part = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  return [
    part(row.compare_item_id || row.item_id || row.index),
    part(row.input_full ?? row.input ?? row.input_preview),
    part(row.expected_full ?? row.expected),
    part(row.output_full ?? row.output),
  ].join('\n');
}

/** Default matcher: item ids, previews and whatever bodies are loaded. */
export const localMatcher: TextMatcher = (field, needle, c) => {
  const q = needle.toLowerCase();
  if (field === 'output') return c.outputText.toLowerCase().includes(q);
  return c.itemId.toLowerCase().includes(q) || c.rows.some((r) => rowText(r).toLowerCase().includes(q));
};

export function buildItemContext(
  model: CompareModel,
  itemId: string,
  ctx: MetricCtx,
  stats: ComparisonStats | null,
  groupsRoot?: undefined,
): ItemContext {
  void groupsRoot;
  const { scores, verdicts, rows } = itemOutcomes(model, itemId, ctx);
  const judged = verdicts.filter((v) => v !== undefined);
  const correct = verdicts.map((v, i) => (v === true ? i : -1)).filter((i) => i >= 0);
  const hasDirection = !!ctx.direction;
  const outcomes: string[] = [];
  const identities = rows.map(outputIdentity).filter(Boolean);
  if (new Set(identities).size > 1) outcomes.push('different');
  const hasError = rows.some((r) => !!r && isErrorRow(r));
  const hasEditedMetric = rows.some((r) => !!r && rowHasEditedMetric(r));
  if (hasError) outcomes.push('errors');
  if (hasEditedMetric) outcomes.push('edited_metrics');
  if (hasDirection && judged.length >= 2 && judged.every((v) => v === true)) outcomes.push('all_correct');
  if (hasDirection && judged.length >= 2 && judged.every((v) => v === false)) outcomes.push('all_wrong');
  if (judged.length >= 2 && correct.length > 0 && correct.length < judged.length)
    outcomes.push('partially_correct');
  const rare = Math.max(1, Math.floor(model.runs.length * 0.25));
  if (correct.length > 0 && correct.length <= rare) outcomes.push('rarely_solved');
  if (correct.length === 1) outcomes.push('unique_solve');
  const winners: string[] = [];
  const w = stats?.winners.get(itemId) ?? null;
  if (w === 'tie') winners.push('tie');
  else if (typeof w === 'number') winners.push(`win_${w}`);
  if (correct.length === 1) winners.push(`only_${correct[0]}`);
  // approvals / output text / root causes are read only when a filter asks (lazy getters).
  return {
    itemId,
    rows,
    scores,
    outcomes,
    winners,
    passCount: correct.length,
    hasError,
    hasEditedMetric,
    get approvals() {
      return rows
        .filter((r): r is Row => !!r)
        .map((r) => (getApprovalState(r, ctx.metric) === 'approved' ? 'approved' : 'not_approved'));
    },
    get outputText() {
      return rows
        .map((r) => String((r && (r.output_full ?? r.output)) ?? ''))
        .filter(Boolean)
        .join('\n');
    },
    maxLatency: Math.max(0, ...rows.map((r) => Number(r?.latency_ms) || 0)),
    get rootCauses() {
      return rows.flatMap((r) => runRowRootCauses(r));
    },
  };
}

export function applyFilters(input: ApplyInput): ApplyResult {
  const { model, view, groups } = input;
  const metric = input.metric;
  if (!metric || model.alignment.status !== 'aligned') return { items: [], stats: null, defs: [] };
  const ctx = metricCtx(model, metric, input.thresholds);
  const stats = fullStatsFor(model, ctx);
  const defs = fieldDefsFor(model, metric);
  const defMap = new Map(defs.map((d) => [d.id, d]));
  const f = view.filters;
  const match = input.match ?? localMatcher;

  const bucketKey = view.show.startsWith(GROUPED_PREFIX) ? view.show.slice(GROUPED_PREFIX.length) : null;
  const bucketItems =
    bucketKey && groups && ctx.direction && model.types[metric] !== 'numeric'
      ? new Set(computeGroupedComparison(model, groups, ctx).buckets[bucketKey as 'both_pass']?.itemIds ?? [])
      : null;

  let baseScores: {
    col: Map<string, number>;
    base: Map<string, number>;
    kind: DeltaKind;
    dir: ReturnType<typeof metricDirection>;
  } | null = null;
  if (f.baseline) {
    const columns = metricColumns(model, view.columns);
    const col = columns.find((c) => c.key === f.baseline!.columnKey);
    const base = columns.find((c) => c.key === f.baseline!.baselineKey);
    const bctx = metricCtx(model, f.baseline.metric, input.thresholds);
    if (col && base)
      baseScores = {
        col: columnItemScores(model, col, bctx),
        base: columnItemScores(model, base, bctx),
        kind: (f.baseline.kind === 'unchanged' ? 'same' : f.baseline.kind) as DeltaKind,
        dir: bctx.direction,
      };
  }

  const out: FilteredItem[] = [];
  for (const itemId of model.itemIds) {
    const c = buildItemContext(model, itemId, ctx, stats);
    if (view.q && !match('content', view.q, c)) continue;
    const md = (c.rows.find((r) => r)?.item_metadata ?? {}) as Record<string, unknown>;
    if (f.complexity !== null) {
      if (!f.complexity.length) continue;
      const v = String(md.complexity ?? '').toLowerCase();
      if (!f.complexity.some((x) => x.toLowerCase() === v)) continue;
    }
    if (f.domain !== null) {
      const vals = parseMetaList(md.domain).map((x) => x.toLowerCase());
      if (f.domainMode === 'exclude') {
        if (f.domain.some((x) => vals.includes(x.toLowerCase()))) continue;
      } else {
        if (!f.domain.length) continue;
        // Q3: "is any of" (was AND); "only" keeps the sole-value rule.
        if (!f.domain.some((x) => vals.includes(x.toLowerCase()))) continue;
        if (f.domainOnly.some((ex) => vals.includes(ex.toLowerCase()) && vals.length > 1)) continue;
      }
    }
    if (f.rootCause !== null) {
      if (!f.rootCause.length) continue;
      const wantNone = f.rootCause.includes('__none__');
      const named = f.rootCause.filter((x) => x !== '__none__').map((x) => x.toLowerCase());
      const per = c.rows.map((r) => runRowRootCauses(r, f.rootCauseMetric).map((x) => x.toLowerCase()));
      const matchesNamed = named.length > 0 && per.some((vals) => named.some((x) => vals.includes(x)));
      const matchesNone = wantNone && (c.rows.some((r) => !r) || per.some((vals) => vals.length === 0));
      if (!matchesNamed && !matchesNone) continue;
    }
    let catFail = false;
    for (const [key, vals] of Object.entries(f.categories)) {
      const have = getMetadataCategoryValues(md, key).map((x) => x.toLowerCase());
      const eff = have.length ? have : ['unknown'];
      if (!vals.length || !vals.some((x) => eff.includes(String(x).toLowerCase()))) {
        catFail = true;
        break;
      }
    }
    if (catFail) continue;
    if (f.approval !== null && !c.approvals.includes(f.approval)) continue;
    const errSlots = Object.entries(f.errors) as Array<[ErrorSlot, ErrorFilter]>;
    if (
      errSlots.length &&
      !c.rows.some((r) => !!r && errSlots.every(([, e]) => rowMatchesErrorFilter(r, e, false)))
    )
      continue;

    if (view.show === 'different') {
      if (c.outcomes.indexOf('different') < 0) continue;
    } else if ((SHOW_VALUES as readonly string[]).includes(view.show)) {
      if (!c.outcomes.includes(view.show)) continue;
    } else if (bucketKey && (!bucketItems || !bucketItems.has(itemId))) continue;

    if (f.passRate) {
      const [op, n] = f.passRate;
      if (op === 'lte' && c.passCount > n) continue;
      if (op === 'gte' && c.passCount < n) continue;
      if (op === 'eq' && c.passCount !== n) continue;
    }
    if (view.winner !== 'any' && !c.winners.includes(view.winner)) continue;
    if (baseScores) {
      const s = baseScores.col.get(itemId);
      const b = baseScores.base.get(itemId);
      if (s === undefined || b === undefined) continue;
      if (deltaKind(s - b, baseScores.dir) !== baseScores.kind) continue;
    }
    if (!evalFilterNode(f.rules, c, defMap, match)) continue;
    out.push({ itemId, rows: c.rows, scores: c.scores });
  }

  if (view.sort === 'score_asc' || view.sort === 'score_desc') {
    const best = (item: FilteredItem) => {
      const vals = item.scores.filter((s): s is number => s !== null);
      return vals.length ? Math.max(...vals) : -1;
    };
    const keyed = out.map((item) => [best(item), item] as const);
    keyed.sort((a, b) => (view.sort === 'score_asc' ? a[0] - b[0] : b[0] - a[0]));
    return { items: keyed.map((k) => k[1]), stats, defs };
  }
  if (view.sort === 'latency_asc' || view.sort === 'latency_desc') {
    const low = (item: FilteredItem) => {
      const vals = item.rows.filter((r) => r?.latency_ms).map((r) => r!.latency_ms as number);
      return vals.length ? Math.min(...vals) : Infinity;
    };
    const keyed = out.map((item) => [low(item), item] as const);
    keyed.sort((a, b) => (view.sort === 'latency_asc' ? a[0] - b[0] : b[0] - a[0]));
    return { items: keyed.map((k) => k[1]), stats, defs };
  }
  return { items: out, stats, defs };
}

/** Rules + page filters, for the badge on the Filters button. */
export function activeFilterCount(view: CompareView, defs: FieldDef[]): number {
  const known = new Set(defs.map((d) => d.id));
  const f = view.filters;
  let n = filterRuleCountRaw(f.rules, (c) => conditionHasValue(c) && known.has(c.field));
  if (view.show !== 'all') n += 1;
  if (view.winner !== 'any') n += 1;
  if (f.baseline) n += 1;
  if (f.passRate) n += 1;
  n += Object.keys(f.errors).length;
  if (f.approval !== null) n += 1;
  if (f.complexity !== null) n += 1;
  if (f.domain !== null) n += 1;
  if (f.rootCause !== null) n += 1;
  n += Object.keys(f.categories).length;
  return n;
}
