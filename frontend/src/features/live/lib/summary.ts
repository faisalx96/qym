import { splitBilingual } from '@/lib/text';
import type { LiveMetricSpec } from '@/api/live';
import type { LiveChartImage } from '@/api/live';

/** Optional producer evidence is unvalidated JSON; never coerce missing or malformed facts. */
export function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export const stringOf = (value: unknown): string | null => (typeof value === 'string' ? value : null);
export const numberOf = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
export const booleanOf = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);
const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const recordsOf = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.flatMap((item) => {
        const record = recordOf(item);
        return record ? [record] : [];
      })
    : [];

export interface SqlResult {
  rows: number | null;
  columns: string[];
  columnsTotal: number | null;
  sample: (string | null)[][];
}

export interface SqlPart extends SqlResult {
  text: string | null;
  executed: boolean | null;
  error: string | null;
  replay: (SqlResult & { error: string | null; skipped: 'privacy' | 'not_runnable' | null }) | null;
  status: 'ok' | 'error' | 'blocked' | null;
  blocked: 'privacy' | 'table_permission' | 'validation' | null;
  subQuestion: string | null;
  agentIndex: number | null;
  semanticEquivalent: boolean | null;
  resultSetMatch: boolean | null;
  textSimilarity: number | null;
}

function sqlResultOf(part: Record<string, unknown>): SqlResult {
  return {
    rows: numberOf(part.rows),
    columns:
      Array.isArray(part.columns) && part.columns.every((column) => typeof column === 'string')
        ? part.columns
        : [],
    columnsTotal: numberOf(part.columns_total),
    sample: Array.isArray(part.sample)
      ? part.sample.filter(Array.isArray).map((row) => row.map(stringOf))
      : [],
  };
}

export function sqlPartsOf(value: unknown): SqlPart[] {
  return recordsOf(value).map((part) => {
    const replay = recordOf(part.replay);
    return {
      ...sqlResultOf(part),
      text: stringOf(part.text),
      executed: booleanOf(part.executed),
      error: stringOf(part.error),
      status: enumOf(part.status, ['ok', 'error', 'blocked']),
      blocked: enumOf(part.blocked, ['privacy', 'table_permission', 'validation']),
      subQuestion: stringOf(part.sub_question),
      agentIndex: indexOf(part.agent_index),
      semanticEquivalent: booleanOf(part.semantic_equivalent),
      resultSetMatch: booleanOf(part.result_set_match),
      textSimilarity: numberOf(part.text_similarity),
      replay: replay
        ? {
            ...sqlResultOf(replay),
            error: stringOf(replay.error),
            skipped: enumOf(replay.skipped, ['privacy', 'not_runnable']),
          }
        : null,
    };
  });
}

interface Coverage {
  covered: number | null;
  total: number | null;
}
function coverageOf(value: unknown): Coverage | null {
  const coverage = recordOf(value);
  return coverage ? { covered: numberOf(coverage.covered), total: numberOf(coverage.total) } : null;
}

export interface Judge {
  model: string | null;
  compliance: { sql: number | null; response: number | null; overall: number | null };
  reasoning: string | null;
  reasoningEn: string | null;
  reasoningAr: string | null;
  checks: {
    followedManifest: boolean | null;
    sqlWellFormed: boolean | null;
    responseCorrect: boolean | null;
  } | null;
  deviations: JudgeDeviation[];
  sqlReasoningEn: string | null;
  sqlReasoningAr: string | null;
  privacyViolation: boolean | null;
  routeReview: {
    verdict: 'correct' | 'wrong' | 'unsure' | null;
    reasoningEn: string | null;
    reasoningAr: string | null;
  } | null;
  sqlParts: SqlPart[];
  vsAgent: { equivalent: boolean | null; resultSetMatch: boolean | null; coverage: Coverage | null } | null;
}

export function judgeOf(summary: Record<string, unknown>, key: 'a' | 'b'): Judge | null {
  const judge = recordOf(recordOf(recordOf(summary)?.judges)?.[key]);
  if (!judge) return null;
  const compliance = recordOf(judge.compliance);
  const vs = recordOf(judge.vs_agent);
  const reasoning = bilingualOf(judge, 'reasoning');
  const sqlReasoning = bilingualOf(judge, 'sql_reasoning');
  const checks = recordOf(judge.checks);
  const route = recordOf(judge.route_review);
  const routeReasoning = route ? bilingualOf(route, 'reasoning') : null;
  const deviations = Object.hasOwn(judge, 'deviations')
    ? recordsOf(judge.deviations)
    : recordsOf(recordOf(summary)?.deviations).filter((item) => item.judge === key);
  return {
    model: stringOf(judge.model),
    compliance: {
      sql: numberOf(compliance?.sql),
      response: numberOf(compliance?.response),
      overall: numberOf(compliance?.overall),
    },
    reasoning: stringOf(judge.reasoning),
    reasoningEn: reasoning.en,
    reasoningAr: reasoning.ar,
    checks: checks
      ? {
          followedManifest: booleanOf(checks.followed_manifest),
          sqlWellFormed: booleanOf(checks.sql_well_formed),
          responseCorrect: booleanOf(checks.response_correct),
        }
      : null,
    deviations: deviations.map(deviationOf),
    sqlReasoningEn: sqlReasoning.en,
    sqlReasoningAr: sqlReasoning.ar,
    privacyViolation: booleanOf(judge.privacy_violation),
    routeReview: route
      ? {
          verdict: enumOf(route.verdict, ['correct', 'wrong', 'unsure']),
          reasoningEn: routeReasoning!.en,
          reasoningAr: routeReasoning!.ar,
        }
      : null,
    sqlParts: sqlPartsOf(judge.sql_parts),
    vsAgent: vs
      ? {
          equivalent: booleanOf(vs.equivalent),
          resultSetMatch: booleanOf(vs.result_set_match),
          coverage: coverageOf(vs.coverage),
        }
      : null,
  };
}

export function deviationsOf(
  summary: Record<string, unknown>,
): { judge: string; axis: string; text: string }[] {
  return recordsOf(recordOf(summary)?.deviations)
    .flatMap((item) => {
      const judge = stringOf(item.judge);
      const axis = stringOf(item.axis);
      const text = stringOf(item.text);
      return judge && axis && text ? [{ judge, axis, text }] : [];
    })
    .sort((a, b) => a.judge.localeCompare(b.judge));
}

export interface ComparisonRow {
  key: string;
  label: string;
  value: string;
  tone?: 'accent' | 'warning' | 'danger' | 'neutral';
}

const pair = (a: number | null | undefined, b: number | null | undefined) =>
  a == null && b == null ? '—' : `${a ?? '—'} / ${b ?? '—'}`;
const verdict = (value: boolean | null, yes: string, no: string) => (value === null ? '—' : value ? yes : no);

export function comparisonRows(summary: Record<string, unknown>): ComparisonRow[] {
  const evidence = recordOf(summary);
  const coverage = coverageOf(evidence?.coverage);
  const agreement = booleanOf(evidence?.judges_agree);
  const envelope = recordOf(evidence?.envelope);
  const intent = stringOf(envelope?.intent);
  const matched = booleanOf(envelope?.matched);
  const actual = stringsOf(envelope?.actual_tools);
  const tools = toolsOf(summary);
  const judgeRows = (['a', 'b'] as const).map((key): ComparisonRow => {
    const vs = judgeOf(summary, key)?.vsAgent;
    const equivalent = vs?.equivalent ?? null;
    const results = vs?.resultSetMatch ?? null;
    return {
      key,
      label: `Judge ${key.toUpperCase()} own SQL vs agent`,
      value:
        equivalent === null && results === null
          ? '—'
          : `${verdict(equivalent, 'Equivalent', 'Not equivalent')} · ${verdict(results, 'results match', 'results differ')}`,
      tone:
        equivalent === false || results === false
          ? 'danger'
          : equivalent === true && results === true
            ? 'accent'
            : 'neutral',
    };
  });
  return [
    ...judgeRows,
    {
      key: 'agreement',
      label: 'Judges agree with each other',
      value: verdict(agreement, 'Yes', 'No'),
      tone: agreement === null ? 'neutral' : agreement ? 'accent' : 'warning',
    },
    {
      key: 'coverage',
      label: 'Sub-questions covered',
      value: pair(coverage?.covered, coverage?.total),
      tone:
        coverage?.covered != null && coverage.total != null
          ? coverage.covered < coverage.total
            ? 'warning'
            : 'accent'
          : 'neutral',
    },
    {
      key: 'envelope',
      label: 'Intent · tool envelope',
      value:
        !intent && matched === null && !actual.length
          ? '—'
          : [
              intent ?? '—',
              verdict(matched, 'Matched', 'Not matched'),
              ...(actual.length ? [actual.join(', ')] : []),
            ].join(' · '),
      tone: matched === null ? 'neutral' : matched ? 'accent' : 'warning',
    },
    {
      key: 'tools',
      label: 'Tool calls · budget',
      value: pair(tools?.calls, tools?.budget),
      tone:
        tools?.calls != null && tools.budget != null && tools.calls > tools.budget ? 'warning' : 'neutral',
    },
  ];
}

export interface ServiceEvidence {
  reason: string | null;
  name: string;
  status: string | null;
  score: number | null;
  fault: string | null;
  signals: Record<string, unknown> | null;
}

export function servicesOf(
  summary: Record<string, unknown>,
  specs: LiveMetricSpec[] = [],
): ServiceEvidence[] {
  const order = specs.length
    ? [...specs]
        .sort((a, b) => a.position - b.position)
        .filter((spec) => spec.metric_name.startsWith('service.'))
        .map((spec) => spec.metric_name.slice(8))
    : [
        'router',
        'retrieval',
        'sql_generation',
        'sql_execution',
        'viz_agent',
        'finalize_report',
        'eval_health',
        'guardrail',
      ];
  const severity = (status: string | null) => ['failed', 'degraded', 'ok', 'skipped'].indexOf(status ?? '');
  const rank = (name: string) => (order.includes(name) ? order.indexOf(name) : order.length);
  return Object.entries(recordOf(recordOf(summary)?.services) ?? {})
    .flatMap(([name, value]) => {
      const service = recordOf(value);
      return service
        ? [
            {
              name,
              status: stringOf(service.status),
              reason: stringOf(service.reason),
              score: numberOf(service.score),
              fault: stringOf(service.fault),
              signals: recordOf(service.signals),
            },
          ]
        : [];
    })
    .sort(
      (a, b) =>
        (severity(a.status) < 0 ? 4 : severity(a.status)) -
          (severity(b.status) < 0 ? 4 : severity(b.status)) || rank(a.name) - rank(b.name),
    );
}

export interface ToolFailure {
  name: string | null;
  step: number | null;
  error: string | null;
  fault: string | null;
}
export interface ToolCall {
  name: string | null;
  step: number | null;
  ok: boolean | null;
}
export interface ToolsEvidence {
  calls: number | null;
  budget: number | null;
  failures: ToolFailure[];
  list: ToolCall[] | null;
}

export function toolsOf(summary: Record<string, unknown>): ToolsEvidence | null {
  const tools = recordOf(recordOf(summary)?.tools);
  return tools
    ? {
        calls: numberOf(tools.calls),
        budget: numberOf(tools.budget),
        failures: recordsOf(tools.failures).map((item) => ({
          name: stringOf(item.name),
          step: numberOf(item.step),
          error: stringOf(item.error),
          fault: stringOf(item.fault),
        })),
        list: Array.isArray(tools.list)
          ? recordsOf(tools.list).map((item) => ({
              name: stringOf(item.name),
              step: numberOf(item.step),
              ok: booleanOf(item.ok),
            }))
          : null,
      }
    : null;
}

export interface ChartEvidence {
  image: LiveChartImage | null;
  ref: string | null;
  kind: string | null;
  scores: Record<string, number>;
  issues: string[];
  reading: string | null;
}

export function chartsOf(
  summary: Record<string, unknown>,
  images: Record<string, LiveChartImage> = {},
): ChartEvidence[] {
  return recordsOf(recordOf(summary)?.charts).map((chart) => ({
    image:
      typeof chart.ref === 'string' && Object.hasOwn(images, chart.ref) ? (images[chart.ref] ?? null) : null,
    ref: stringOf(chart.ref),
    kind: stringOf(chart.kind),
    scores: Object.fromEntries(
      Object.entries(recordOf(chart.scores) ?? {}).flatMap(([key, value]) => {
        const score = numberOf(value);
        return score === null ? [] : [[key, score]];
      }),
    ),
    issues: stringsOf(chart.issues),
    reading: stringOf(chart.reading),
  }));
}

export interface EvalMeta extends Record<string, unknown> {
  rulesVersion: string | null;
  maxAttempts: number | null;
  stageDurations: Record<string, number> | null;
  visionJudgeModel: string | null;
}
export function evalMetaOf(summary: Record<string, unknown>): EvalMeta | null {
  const meta = recordOf(recordOf(summary)?.eval_meta);
  const durations = recordOf(meta?.stage_durations_s);
  return meta
    ? {
        ...meta,
        rulesVersion: stringOf(meta.rules_version),
        maxAttempts: indexOf(meta.max_attempts),
        visionJudgeModel: stringOf(meta.vision_judge_model),
        stageDurations: durations
          ? Object.fromEntries(
              Object.entries(durations).flatMap(([key, value]) => {
                const number = numberOf(value);
                return number === null ? [] : [[key, number]];
              }),
            )
          : null,
      }
    : null;
}

function enumOf<const T extends string>(value: unknown, options: readonly T[]): T | null {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : null;
}
function indexOf(value: unknown): number | null {
  const number = numberOf(value);
  return number !== null && Number.isInteger(number) && number >= 0 ? number : null;
}
function bilingualOf(value: Record<string, unknown>, key: string) {
  const old = splitBilingual(stringOf(value[key]) ?? '');
  return {
    en: Object.hasOwn(value, `${key}_en`) ? stringOf(value[`${key}_en`]) : old.en,
    ar: Object.hasOwn(value, `${key}_ar`) ? stringOf(value[`${key}_ar`]) : old.ar,
  };
}

export interface JudgeDeviation {
  axis: 'sql' | 'response' | null;
  type: string | null;
  textEn: string | null;
  textAr: string | null;
  dropped: boolean | null;
  droppedReason: string | null;
}
function deviationOf(item: Record<string, unknown>): JudgeDeviation {
  const text = bilingualOf(item, 'text');
  return {
    axis: enumOf(item.axis, ['sql', 'response']),
    type: stringOf(item.type),
    textEn: text.en,
    textAr: text.ar,
    dropped: booleanOf(item.dropped),
    droppedReason: stringOf(item.dropped_reason),
  };
}

export function verdictOf(summary: Record<string, unknown>) {
  const value = recordOf(recordOf(summary)?.verdict);
  return value
    ? {
        label: stringOf(value.label),
        basis: enumOf(value.basis, ['rule', 'judges', 'outcome', 'skipped']),
        reasonEn: stringOf(value.reason_en),
        reasonAr: stringOf(value.reason_ar),
        confidence: numberOf(value.confidence),
        steps: recordsOf(value.steps).map((step) => ({
          kind: stringOf(step.kind),
          textEn: stringOf(step.text_en),
          textAr: stringOf(step.text_ar),
          source: stringOf(step.source),
        })),
      }
    : null;
}
export function turnClassOf(summary: Record<string, unknown>) {
  const value = recordOf(recordOf(summary)?.turn_class);
  return value
    ? { name: stringOf(value.name), stage: stringOf(value.stage), review: stringOf(value.review) }
    : null;
}
export interface AppliedRule {
  id: string | null;
  group: string | null;
  titleEn: string | null;
  titleAr: string | null;
  verdictEn: string | null;
  verdictAr: string | null;
  sources: string[];
  role: 'decided' | 'told_to_judges' | null;
}
export function rulesAppliedOf(summary: Record<string, unknown>): AppliedRule[] {
  return recordsOf(recordOf(summary)?.rules_applied).map((rule) => ({
    id: stringOf(rule.id),
    group: stringOf(rule.group),
    titleEn: stringOf(rule.title_en),
    titleAr: stringOf(rule.title_ar),
    verdictEn: stringOf(rule.verdict_en),
    verdictAr: stringOf(rule.verdict_ar),
    sources: stringsOf(rule.sources),
    role: enumOf(rule.role, ['decided', 'told_to_judges']),
  }));
}
export const rulesVersionOf = (summary: Record<string, unknown>): string | null =>
  stringOf(recordOf(summary)?.rules_version);
export const errorOf = (summary: Record<string, unknown>): string | null =>
  stringOf(recordOf(summary)?.error);

export function crossReviewOf(summary: Record<string, unknown>, key: 'a_on_b' | 'b_on_a') {
  const value = recordOf(recordOf(recordOf(summary)?.cross_review)?.[key]);
  if (!value) return null;
  const text = bilingualOf(value, 'text');
  return {
    textEn: text.en,
    textAr: text.ar,
    agreement: booleanOf(value.agreement),
    betterSql: enumOf(value.better_sql, ['self', 'other', 'tie']),
  };
}
export function judgeFactsOf(summary: Record<string, unknown>) {
  return recordsOf(recordOf(summary)?.judge_facts).map((fact) => ({
    textEn: stringOf(fact.text_en),
    source: stringOf(fact.source),
  }));
}
export function guardrailsOf(summary: Record<string, unknown>) {
  const value = recordOf(recordOf(summary)?.guardrails);
  const granted = recordOf(value?.granted);
  return value
    ? {
        granted: granted
          ? {
              pii: booleanOf(granted.pii),
              internals: booleanOf(granted.internals),
              businessQuestion: booleanOf(granted.business_question),
            }
          : null,
        fired: recordsOf(value.fired).map((item) => ({
          stage: enumOf(item.stage, ['router', 'agent', 'query_blocker', 'final_answer']),
          kind: enumOf(item.kind, [
            'pii',
            'internals',
            'not_business_question',
            'scope',
            'injection',
            'secrets',
          ]),
          ruleId: stringOf(item.rule_id),
          textEn: stringOf(item.text_en),
          source: stringOf(item.source),
        })),
        replayWithheld: booleanOf(value.replay_withheld),
      }
    : null;
}
export function deliveredOf(summary: Record<string, unknown>) {
  const value = recordOf(recordOf(summary)?.delivered);
  return value
    ? {
        charts: recordsOf(value.charts).map((chart) => ({
          kind: enumOf(chart.kind, ['chart', 'map', 'table', 'indicator']),
          type: stringOf(chart.type),
          title: stringOf(chart.title),
          categories: numberOf(chart.categories),
          sourceRows: numberOf(chart.source_rows),
          result: enumOf(chart.result, ['as_asked', 'changed', 'table_instead', 'unknown']),
          shownInAnswer: booleanOf(chart.shown_in_answer),
        })),
        methodology: stringsOf(value.methodology),
        dataNotes: stringsOf(value.data_notes),
        datesShown: booleanOf(value.dates_shown),
        textTrimmedForChart: booleanOf(value.text_trimmed_for_chart),
      }
    : null;
}
export function questionContextOf(summary: Record<string, unknown>) {
  const value = recordOf(recordOf(summary)?.question_context);
  return value
    ? {
        enrichedQuestion: stringOf(value.enriched_question),
        previousQuestion: stringOf(value.previous_question),
        previousAnswer: stringOf(value.previous_answer),
        selectedExcerpt: stringOf(value.selected_excerpt),
      }
    : null;
}
