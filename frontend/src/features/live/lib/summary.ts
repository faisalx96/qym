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

export interface SqlPart {
  text: string | null;
  executed: boolean | null;
  rows: number | null;
  error: string | null;
}

export function sqlPartsOf(value: unknown): SqlPart[] {
  return recordsOf(value).map((part) => ({
    text: stringOf(part.text),
    executed: booleanOf(part.executed),
    rows: numberOf(part.rows),
    error: stringOf(part.error),
  }));
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
  sqlParts: SqlPart[];
  vsAgent: { equivalent: boolean | null; resultSetMatch: boolean | null; coverage: Coverage | null } | null;
}

export function judgeOf(summary: Record<string, unknown>, key: 'a' | 'b'): Judge | null {
  const judge = recordOf(recordOf(recordOf(summary)?.judges)?.[key]);
  if (!judge) return null;
  const compliance = recordOf(judge.compliance);
  const vs = recordOf(judge.vs_agent);
  return {
    model: stringOf(judge.model),
    compliance: {
      sql: numberOf(compliance?.sql),
      response: numberOf(compliance?.response),
      overall: numberOf(compliance?.overall),
    },
    reasoning: stringOf(judge.reasoning),
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
  name: string;
  status: string | null;
  score: number | null;
  fault: string | null;
  signals: Record<string, unknown> | null;
}

export function servicesOf(summary: Record<string, unknown>): ServiceEvidence[] {
  return Object.entries(recordOf(recordOf(summary)?.services) ?? {}).flatMap(([name, value]) => {
    const service = recordOf(value);
    return service
      ? [
          {
            name,
            status: stringOf(service.status),
            score: numberOf(service.score),
            fault: stringOf(service.fault),
            signals: recordOf(service.signals),
          },
        ]
      : [];
  });
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
  ref: string | null;
  kind: string | null;
  scores: Record<string, number>;
  issues: string[];
  reading: string | null;
}

export function chartsOf(summary: Record<string, unknown>): ChartEvidence[] {
  return recordsOf(recordOf(summary)?.charts).map((chart) => ({
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

export function evalMetaOf(summary: Record<string, unknown>): Record<string, unknown> | null {
  return recordOf(recordOf(summary)?.eval_meta);
}
