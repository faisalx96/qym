import { describe, expect, it } from 'vitest';
import type { StepLatencyGroup, StepLatencyPayload } from '../../types';
import { buildStepsTree, flattenSteps, normalizeLatency, stepsAxis, type StepSortKey } from '../latencyModel';

/** One distribution; every percentile equals `ms` so a test can read it back. */
function group(over: Partial<StepLatencyGroup> = {}, ms = 222): StepLatencyGroup {
  return {
    phase: 'task',
    kind: 'LLM',
    step_type: 'llm:test',
    n: 2,
    error_count: 0,
    mean_ms: ms,
    median_ms: ms,
    min_ms: ms,
    max_ms: ms,
    p5_ms: ms,
    p25_ms: ms,
    p75_ms: ms,
    p95_ms: ms,
    cv: 0,
    tokens_total: 500,
    ...over,
  };
}

const payload = (over: Partial<StepLatencyPayload> = {}): StepLatencyPayload => ({
  run_ids: ['run-1'],
  rollup: 'site',
  passes: [1, 2],
  trace_count: 1,
  groups: [group()],
  ...over,
});

describe('normalizeLatency: a step needs observations, zero and errors count', () => {
  it('keeps a zero-latency step and an errors-only step, drops a step with no samples', () => {
    expect(normalizeLatency(payload({ groups: [group({}, 0)] })).steps).toHaveLength(1);
    expect(normalizeLatency(payload({ groups: [group({}, 0)] })).steps[0]!.mean).toBe(0);
    const errorsOnly = normalizeLatency(
      payload({ groups: [group({ n: 0, error_count: 3, mean_ms: undefined, median_ms: undefined })] }),
    );
    expect(errorsOnly.steps).toHaveLength(1);
    expect(errorsOnly.steps[0]!.err).toBe(3);
    expect(Number.isNaN(errorsOnly.steps[0]!.mean)).toBe(true);
    expect(normalizeLatency(payload({ groups: [group({ n: 0, error_count: 0 })] })).steps).toEqual([]);
    expect(normalizeLatency(payload({ groups: [] })).steps).toEqual([]);
  });

  it('keeps step names as plain strings (markup is never interpreted)', () => {
    const name = '</title><image href="data:," onerror="window.injected=true"/> & "B"';
    expect(normalizeLatency(payload({ groups: [group({ step_type: name })] })).steps[0]!.name).toBe(name);
  });

  it('reads the phase parent spans from `phases`', () => {
    const D = normalizeLatency(payload({ phases: [group({ phase: 'task', n: 1 }, 900)] }));
    expect(D.phases.task?.mean).toBe(900);
    expect(D.phases.eval).toBeUndefined();
  });
});

describe('buildStepsTree / flattenSteps', () => {
  const sort = { key: 'time' as StepSortKey, dir: -1 as const };

  it('a kind that repeats its phase adds no extra level', () => {
    const D = normalizeLatency(
      payload({ groups: [group({ kind: 'AGENT', step_type: 'agent:planner' }, 300)] }),
    );
    const tree = buildStepsTree(D, { group: 'step', query: '' });
    expect(tree).toHaveLength(1);
    expect(tree[0]!.type).toBe('phase');
    expect(tree[0]!.children!.map((c) => [c.type, c.label])).toEqual([['step', 'agent:planner']]);
  });

  it('phase headers carry their own parent bar; collapsed phases hide their steps', () => {
    const D = normalizeLatency(payload({ phases: [group({ phase: 'task', n: 1 }, 900)] }));
    const tree = buildStepsTree(D, { group: 'step', query: '' });
    const collapsed = flattenSteps(D, tree, new Set(), sort);
    expect(collapsed.map((r) => r.node.label)).toEqual(['Agent']);
    expect(collapsed[0]!.node.stats.mean).toBe(900);
    const expanded = flattenSteps(D, tree, new Set(['p:task']), sort);
    expect(expanded.map((r) => r.node.label)).toEqual(['Agent', 'llm:test']);
    expect(expanded[1]!.depth).toBe(1);
  });

  it('a search keeps only matching steps and forces their phase open', () => {
    const D = normalizeLatency(
      payload({ groups: [group(), group({ step_type: 'tool:search', kind: 'TOOL' }, 50)] }),
    );
    const tree = buildStepsTree(D, { group: 'step', query: 'search' });
    const rows = flattenSteps(D, tree, new Set(), sort);
    expect(rows.map((r) => r.node.label)).toEqual(['Agent', 'tool:search']);
    expect(buildStepsTree(D, { group: 'step', query: 'zzz' })).toEqual([]);
  });

  it('By kind rolls steps up into one row per kind family', () => {
    const D = normalizeLatency(
      payload({
        groups: [
          group(),
          group({ step_type: 'llm:b' }, 100),
          group({ step_type: 'tool:x', kind: 'TOOL' }, 50),
        ],
      }),
    );
    const tree = buildStepsTree(D, { group: 'kind', query: '' });
    expect(tree[0]!.children!.map((c) => c.label)).toEqual(['LLM', 'Tools']);
    expect(tree[0]!.children![0]!.stats.n).toBe(4);
  });
});

describe('stepsAxis', () => {
  it('shares one axis between the phase parent bar and the step bars', () => {
    const D = normalizeLatency(payload({ phases: [group({ phase: 'task', n: 1 }, 30000)] }));
    const tree = buildStepsTree(D, { group: 'step', query: '' });
    const rows = flattenSteps(D, tree, new Set(['p:task']), { key: 'time', dir: -1 });
    for (const scale of ['linear', 'log'] as const) {
      const axis = stepsAxis(rows, scale);
      // A 30s phase bar fits the axis rather than running off the plot.
      expect(axis.x(30000)).toBeLessThanOrEqual(100.0001);
      expect(axis.x(222)).toBeLessThan(axis.x(30000));
      expect(axis.ticks[axis.ticks.length - 1]).toBeGreaterThanOrEqual(
        30000 * (scale === 'linear' ? 1 : 0.99),
      );
    }
  });
});
