/** Root-cause value normalisation (three legacy shapes -> issues). Ported from playground.js 787-860. */
import type { RootCauseIssue } from '@/api/analysis';

type Loose = Record<string, unknown>;
const isObj = (v: unknown): v is Loose => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown) => String(v ?? '').trim();

export function rootCauseCategories(value: unknown): string[] {
  let raw: unknown = value;
  if (isObj(value)) {
    if (Array.isArray(value.root_cause_issues)) {
      raw = value.root_cause_issues.map((issue) => (isObj(issue) ? (issue.category ?? issue.root_cause) : ''));
    } else if ('root_causes' in value) raw = value.root_causes;
    else if ('root_cause_categories' in value) raw = value.root_cause_categories;
    else raw = value.root_cause;
  }
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  const seen = new Set<string>();
  return values
    .map((item) => str(item))
    .filter((item) => {
      const key = item.toLocaleLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

const clamp = (n: number) => Math.min(1, Math.max(0, n));
function confidenceOf(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? clamp(n) : null;
}

export function rootCauseIssues(value: unknown): RootCauseIssue[] {
  if (!isObj(value)) return [];
  if (!Array.isArray(value.root_cause_issues)) {
    const categories = rootCauseCategories(value);
    const subcategory = str(value.root_cause_detail);
    const finding = str(value.root_cause_note);
    const reason = str(value.root_cause_reason);
    const confidence = confidenceOf(value.confidence ?? value.root_cause_confidence);
    if (!categories.length && !subcategory && !finding) return [];
    return (categories.length ? categories : ['']).map((category, index) => ({
      category,
      subcategory,
      finding,
      category_reason: index === 0 ? reason : '',
      confidence: index === 0 ? confidence : null,
    }));
  }
  const issues: RootCauseIssue[] = [];
  for (const raw of value.root_cause_issues) {
    if (!isObj(raw)) continue;
    const category = str(raw.category ?? raw.root_cause);
    const subcategory = str(raw.subcategory ?? raw.root_cause_detail);
    const finding = str(raw.finding ?? raw.root_cause_note);
    if (!category && !subcategory && !finding) continue;
    issues.push({
      category,
      subcategory,
      finding,
      category_reason: str(raw.category_reason ?? raw.root_cause_reason),
      confidence: confidenceOf(raw.confidence),
    });
  }
  if (issues.length) {
    const topReason = str(value.root_cause_reason);
    if (!issues[0].category_reason && topReason) issues[0].category_reason = topReason;
    const top = confidenceOf(value.confidence ?? value.root_cause_confidence);
    if (issues[0].confidence == null && top != null) issues[0].confidence = top;
  }
  return issues;
}
