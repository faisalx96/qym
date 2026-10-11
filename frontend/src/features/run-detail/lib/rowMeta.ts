/** Item metadata, root-cause and approval readers (run.html helpers, C068). */
import type { MetricAnalysis, RootCauseIssue, Row } from '../types';

export function categoryValueText(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function parseMetaList(val: unknown): string[] {
  if (val == null || val === '') return [];
  if (Array.isArray(val))
    return val.filter((v) => v != null && v !== 'null' && v !== '').map(categoryValueText);
  const s = categoryValueText(val).trim();
  if (s.startsWith('[') && s.endsWith(']')) {
    try {
      const p = JSON.parse(s);
      if (Array.isArray(p)) return p.filter((v) => v != null).map(categoryValueText);
    } catch {
      /* not JSON */
    }
    try {
      const f = s.replace(/'/g, '"').replace(/"null"/g, 'null');
      const p2 = JSON.parse(f);
      if (Array.isArray(p2)) return p2.filter((v) => v != null).map(categoryValueText);
    } catch {
      /* not a python list either */
    }
  }
  return [s];
}

export function isListCategoryKey(key: string): boolean {
  return key === 'domain' || key === 'patterns';
}

export function getMetadataCategoryValues(
  md: Record<string, unknown> | null | undefined,
  key: string,
): string[] {
  const raw = md && typeof md === 'object' ? md[key] : null;
  if (raw == null || raw === '') return [];
  if (isListCategoryKey(key) || Array.isArray(raw)) return parseMetaList(raw);
  return [categoryValueText(raw)];
}

export const ITEM_METADATA_BADGE_KEYS = ['complexity', 'domain'];

/** Badge values for complexity/domain: scalars only, never "[object Object]". */
export function itemMetadataBadgeValues(key: string, value: unknown): string[] {
  if (value == null || value === '') return [];
  if (Array.isArray(value))
    return value.filter((v) => v != null && v !== '' && typeof v !== 'object').map(String);
  if (typeof value === 'object') return [];
  return isListCategoryKey(key) ? parseMetaList(value) : [String(value)];
}

export function itemMetadataDisplayValue(value: unknown): string {
  if (value !== null && typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '';
    }
  }
  return String(value);
}

export function formatFieldName(name: string): string {
  return name.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Keys that are bookkeeping, never shown as metadata or offered as categories. */
export const HIDDEN_METADATA_KEYS = new Set([
  'root_cause',
  'root_causes',
  'root_cause_categories',
  'root_cause_issues',
  'root_cause_detail',
  'root_cause_reason',
  'root_cause_note',
  'root_cause_source',
  'root_cause_confidence',
  'root_cause_metric_name',
  'solution',
  'solution_note',
  'solution_source',
  'metric_analyses',
  'analysis_error',
  'analysis_warning',
  'task_started_at_ms',
  'trace_stats',
  'retry_count',
]);

/* ── root cause issues ── */

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

export function rootCauseIssues(value: unknown, legacyFallback = true): RootCauseIssue[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const v = value as MetricAnalysis;
  if (Array.isArray(v.root_cause_issues)) {
    const issues = v.root_cause_issues
      .map((raw) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
        const issue = raw as Record<string, unknown>;
        const rawConfidence = issue.confidence;
        const confidence = rawConfidence == null || rawConfidence === '' ? NaN : Number(rawConfidence);
        const normalized: RootCauseIssue = {
          category: String(issue.category ?? issue.root_cause ?? '').trim(),
          subcategory: String(issue.subcategory ?? issue.root_cause_detail ?? '').trim(),
          finding: String(issue.finding ?? issue.root_cause_note ?? '').trim(),
          category_reason: String(issue.category_reason ?? issue.root_cause_reason ?? '').trim(),
        };
        (
          ['issue_id', 'solution', 'solution_note', 'review_status', 'source', 'reviewed_at'] as const
        ).forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(issue, key)) normalized[key] = String(issue[key] ?? '');
        });
        if (Number.isFinite(confidence)) normalized.confidence = clamp01(confidence);
        return normalized.category || normalized.subcategory || normalized.finding ? normalized : null;
      })
      .filter((x): x is RootCauseIssue => !!x);
    if (issues.length) {
      const topReason = String(v.root_cause_reason ?? '').trim();
      if (!issues[0]!.category_reason && topReason) issues[0]!.category_reason = topReason;
      const rawTop = v.confidence ?? v.root_cause_confidence;
      const topConfidence = rawTop == null || rawTop === '' ? NaN : Number(rawTop);
      if (issues[0]!.confidence == null && Number.isFinite(topConfidence))
        issues[0]!.confidence = clamp01(topConfidence);
    }
    return issues;
  }
  if (!legacyFallback) return [];
  const rawCategories = Object.prototype.hasOwnProperty.call(v, 'root_causes')
    ? v.root_causes
    : Object.prototype.hasOwnProperty.call(v, 'root_cause_categories')
      ? v.root_cause_categories
      : v.root_cause;
  const categories = (Array.isArray(rawCategories) ? rawCategories : rawCategories ? [rawCategories] : [])
    .map((c) => String(c ?? '').trim())
    .filter(Boolean);
  const subcategory = String(v.root_cause_detail ?? '').trim();
  const finding = String(v.root_cause_note ?? '').trim();
  const reason = String(v.root_cause_reason ?? '').trim();
  const confidence = Number(v.confidence ?? v.root_cause_confidence);
  if (!categories.length && !subcategory && !finding) return [];
  return (categories.length ? categories : ['']).map((category, index) => ({
    category,
    subcategory,
    finding,
    category_reason: index === 0 ? reason : '',
    ...(index === 0 && Number.isFinite(confidence) ? { confidence: clamp01(confidence) } : {}),
  }));
}

export function rootCauseCategories(value: unknown): string[] {
  const hasCanonical =
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Array.isArray((value as MetricAnalysis).root_cause_issues);
  const issues = rootCauseIssues(value, false);
  if (hasCanonical || issues.length) {
    const out: string[] = [];
    const seen = new Set<string>();
    issues.forEach((issue) => {
      const category = String(issue.category ?? '').trim();
      const key = category.toLocaleLowerCase();
      if (!category || seen.has(key)) return;
      seen.add(key);
      out.push(category);
    });
    return out;
  }
  const obj = value && typeof value === 'object' && !Array.isArray(value) ? (value as MetricAnalysis) : null;
  const raw = obj
    ? Object.prototype.hasOwnProperty.call(obj, 'root_causes')
      ? obj.root_causes
      : Object.prototype.hasOwnProperty.call(obj, 'root_cause_categories')
        ? obj.root_cause_categories
        : obj.root_cause
    : value;
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const seen = new Set<string>();
  return values
    .map((x) => String(x ?? '').trim())
    .filter((x) => {
      const key = x.toLocaleLowerCase();
      if (!x || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export interface RootCauseAnalysisEntry extends MetricAnalysis {
  root_causes: string[];
  root_cause: string;
  metric_name: string;
  pass_number?: number;
}

/** The analyses of a row (per metric; per pass in the all-passes view of a repeat run). */
export function getRowRootCauseAnalyses(
  row: Row,
  metricFilter: string | 'all',
  repeatAggregate: boolean,
): RootCauseAnalysisEntry[] {
  const md = row.item_metadata ?? {};
  const decorate = (
    analysis: MetricAnalysis,
    metricName: string,
    passNumber?: number,
  ): RootCauseAnalysisEntry => {
    const cats = rootCauseCategories(analysis);
    return {
      ...analysis,
      root_causes: cats,
      root_cause: cats[0] ?? '',
      metric_name: metricName,
      ...(passNumber ? { pass_number: passNumber } : {}),
    };
  };
  const isValid = (analysis: unknown): analysis is MetricAnalysis =>
    !!analysis &&
    typeof analysis === 'object' &&
    !(analysis as MetricAnalysis).error &&
    rootCauseCategories(analysis).length > 0;
  if (repeatAggregate) {
    const passAnalyses = row.pass_metric_analyses;
    if (passAnalyses && typeof passAnalyses === 'object' && Object.keys(passAnalyses).length) {
      const entries: RootCauseAnalysisEntry[] = [];
      Object.entries(passAnalyses).forEach(([metricName, values]) => {
        if (!Array.isArray(values)) return;
        values.forEach((analysis, index) => {
          if (metricFilter !== 'all' && metricFilter !== metricName) return;
          if (isValid(analysis)) entries.push(decorate(analysis, metricName, index + 1));
        });
      });
      return entries;
    }
  }
  const metricAnalyses =
    md.metric_analyses && typeof md.metric_analyses === 'object' ? md.metric_analyses : {};
  const metricEntries = Object.entries(metricAnalyses).filter(([, a]) => isValid(a));
  if (metricFilter === 'all' && metricEntries.length)
    return metricEntries.map(([name, a]) => decorate(a, name));
  if (metricFilter !== 'all') {
    const analysis = metricAnalyses[metricFilter];
    return isValid(analysis) ? [decorate(analysis, metricFilter)] : [];
  }
  // legacy item-level diagnosis
  if (isValid(md)) return [decorate(md as MetricAnalysis, '')];
  return [];
}

export function itemRootCauses(row: Row, repeatAggregate: boolean): string[] {
  return getRowRootCauseAnalyses(row, 'all', repeatAggregate).flatMap((a) => rootCauseCategories(a));
}

/* ── approval / edits ── */

export function getApprovalState(
  row: Row | null | undefined,
  metricName?: string | null,
): 'approved' | 'not_approved' | '' {
  if (!row) return '';
  const itemStatus = String(row.review_correction_status ?? '').toLowerCase();
  const metricReviews =
    row.review_corrections && typeof row.review_corrections === 'object' ? row.review_corrections : {};
  if (metricName) {
    const metricStatus = String(metricReviews[metricName]?.status ?? '').toLowerCase();
    if (metricStatus) return metricStatus === 'approved' ? 'approved' : 'not_approved';
    if (itemStatus) return itemStatus === 'approved' ? 'approved' : 'not_approved';
    return 'not_approved';
  }
  if (itemStatus === 'approved') return 'approved';
  if (Object.values(metricReviews).some((r) => String(r?.status ?? '').toLowerCase() === 'approved'))
    return 'approved';
  return 'not_approved';
}

export function isMetricMetaEdited(meta: unknown): boolean {
  if (!meta || typeof meta !== 'object') return false;
  const raw = (meta as Record<string, unknown>).modified;
  if (raw === true || raw === 1) return true;
  const normalized = String(raw ?? '')
    .trim()
    .toLowerCase();
  return normalized === 'true' || normalized === '1' || normalized === 'yes';
}

export function rowHasEditedMetric(row: Row): boolean {
  const metricMeta = row.metric_meta;
  if (!metricMeta || typeof metricMeta !== 'object') return false;
  return Object.values(metricMeta).some(isMetricMetaEdited);
}
