import { describe, expect, it } from 'vitest';
import { buildTraceRows } from '../panelData';
import type { CompareModel } from '../model';
import type { MetricColumn } from '../baseline';

const col = (i: number): MetricColumn => ({
  key: `r${i}`,
  base: `r${i}`,
  runIdxs: [i],
  pass: null,
  label: `r${i}`,
  title: `r${i}`,
});
const model = (stats: unknown[]) =>
  ({ runs: stats.map((trace_stats) => ({ run: { trace_stats } })) }) as unknown as CompareModel;

describe('buildTraceRows', () => {
  it('is empty when no run has spans', () => {
    expect(buildTraceRows(model([{ has_spans: false }, null]), [col(0), col(1)])).toEqual([]);
  });
  it('shows a dash (null) for a run that did not capture a stat, never 0, and adds agent-span rows', () => {
    const rows = buildTraceRows(
      model([
        {
          has_spans: true,
          avg_tokens: 120,
          avg_llm_calls: 2,
          avg_llm_ms: 800,
          avg_evaluator_ms: 50,
          outer_scope_parent_spans: [{ name: 'planner', avg_ms: 300 }],
        },
        { has_spans: true, avg_tool_calls: 1, avg_tool_ms: 40, tool_success_rate: 0.5 },
      ]),
      [col(0), col(1)],
    );
    const by = Object.fromEntries(rows.map((r) => [r.id, r.values]));
    expect(by['tokens']).toEqual([120, null]);
    expect(by['tool-ms']).toEqual([null, 40]);
    expect(by['tool-success']).toEqual([null, 0.5]);
    expect(by['agent:planner']).toEqual([300, null]);
    expect(by['evaluator-ms']).toEqual([50, null]);
    expect(by['retriever-ms']).toBeUndefined();
  });
});
