import { describe, expect, it } from 'vitest';
import type { StepLatencyGroup, StepLatencyPayload } from '../../types';
import {
  budgetBrackets,
  budgetSegments,
  buildStepsTree,
  flattenSteps,
  fmtMs,
  latencyPins,
  normalizeLatency,
  pinChips,
  stepsAxis,
  stepsOfFamily,
  type LatencySummary,
  type StepSortKey,
} from '../latencyModel';

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

describe('latency spectrum pins', () => {
  const L = (p50: number, p90: number, p95: number): LatencySummary => ({
    min: 4300,
    max: 32900,
    p50,
    p90,
    p95,
    mean: 18200,
    count: 70,
  });

  it('pins less than 14% apart share one chip before the spectrum is measured', () => {
    const chips = pinChips(latencyPins(L(18300, 29400, 31900)));
    expect(chips.map((c) => c.pins.map((p) => p.key))).toEqual([['p50'], ['p90', 'p95']]);
    expect(chips.every((c) => c.left === null)).toBe(true);
  });

  it('keeps the chips inside the spectrum and clear of each other, over their pins', () => {
    const width = 380;
    const chips = pinChips(latencyPins(L(18300, 29400, 31900)), width);
    expect(chips).toHaveLength(2);
    const [a, b] = chips;
    expect(a!.left!).toBeGreaterThanOrEqual(0);
    expect(b!.left!).toBeGreaterThan(a!.left! + 70);
    expect(b!.left! + 150).toBeLessThanOrEqual(width);
  });

  it('merges chips that cannot stay over their pins in a narrow spectrum', () => {
    const chips = pinChips(latencyPins(L(18300, 29400, 31900)), 300);
    expect(chips.map((c) => c.pins.map((p) => p.key))).toEqual([['p50', 'p90', 'p95']]);
    expect(chips[0]!.join).toBeGreaterThanOrEqual(chips[0]!.pins[0]!.x);
    expect(chips[0]!.join).toBeLessThanOrEqual(chips[0]!.pins[2]!.x);
  });
});

describe('time budget brackets and kinds', () => {
  const D = normalizeLatency(
    payload({
      trace_count: 2,
      groups: [group({ kind: 'LLM', n: 2 }, 1000), group({ phase: 'eval', step_type: 'judge', n: 2 }, 500)],
      phases: [group({ phase: 'task', n: 2 }, 1000), group({ phase: 'eval', n: 2 }, 500)],
    }),
  );

  it('brackets each phase with its own span time', () => {
    const brackets = budgetBrackets(D, budgetSegments(D), 'phase');
    expect(brackets.map((b) => [b.label, b.ms])).toEqual([
      ['Agent', 1000],
      ['Eval', 500],
    ]);
    expect(brackets[0]!.x).toBe(0);
    expect(brackets[1]!.x).toBeCloseTo(brackets[0]!.w);
  });

  it('opens the phase that holds a kind and points at its steps', () => {
    expect(stepsOfFamily(D, 'EVAL')).toEqual({ open: ['p:eval'], ids: ['s:eval::LLM:judge:'] });
    expect(stepsOfFamily(D, 'LLM').open).toEqual(['p:task']);
  });
});

describe('fmtMs', () => {
  it('writes table durations compactly', () => {
    expect(fmtMs(627.4)).toBe('627ms');
    expect(fmtMs(1940)).toBe('1.94s');
    expect(fmtMs(18500)).toBe('18.5s');
    expect(fmtMs(NaN)).toBe('—');
  });
});
