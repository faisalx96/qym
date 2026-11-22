import { describe, expect, it } from 'vitest';
import { KIND_ICON, KIND_TONE } from '../../components/traces/spanKinds';
import type { StepLatencyGroup, StepLatencyPayload, StepLatencyTreeNode } from '../../types';
import {
  allStepRows,
  budgetBrackets,
  budgetSegments,
  FAMILY_ICON,
  FAMILY_TONE,
  flattenSteps,
  fmtMs,
  kindWord,
  latencyPins,
  mergeModels,
  normalizeLatency,
  PHASE_TONE,
  pinChips,
  stepFacts,
  stepIcon,
  stepsAxis,
  stepsCsv,
  stepsModel,
  stepsOfFamily,
  stepsSvg,
  stepTone,
  toSpanKind,
  walkSteps,
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

/** One node of the server's average trace; every quantile equals `ms`. */
function tnode(
  name: string | null,
  kind: string,
  ms: number,
  over: Partial<StepLatencyTreeNode> = {},
  children: StepLatencyTreeNode[] = [],
): StepLatencyTreeNode {
  const { phase: _phase, step_type: _st, ...g } = group({}, ms);
  return {
    ...g,
    name,
    kind,
    phase: 'task',
    step: !children.length,
    models: [],
    in_traces: 4,
    calls: 4,
    time_per_trace_ms: ms,
    tokens_total: 0,
    children,
    ...over,
  };
}

/** A run of 4 traces: an agent (an LLM step, a tool in 2 of the 4 traces, twice there) then an eval. */
const treePayload = () =>
  payload({
    trace_count: 4,
    tree: tnode(null, 'CHAIN', 5000, { step: false }, [
      tnode('planner', 'AGENT', 4000, { step: false }, [
        tnode('answer', 'LLM', 1000, { models: ['model-a', 'model-b'] }),
        tnode('Tool: search', 'TOOL', 600, { in_traces: 2, calls: 4, time_per_trace_ms: 300 }),
      ]),
      tnode('judge', 'EVALUATOR', 800, { phase: 'eval' }),
    ]),
    kinds: [
      { ...group({}, 1000), kind: 'LLM', calls: 4, in_traces: 4, avg_call_ms: 1000, time_per_trace_ms: 1000 },
      { ...group({}, 600), kind: 'TOOL', calls: 4, in_traces: 2, avg_call_ms: 300, time_per_trace_ms: 300 },
      {
        ...group({}, 800),
        kind: 'EVALUATOR',
        calls: 4,
        in_traces: 4,
        avg_call_ms: 800,
        time_per_trace_ms: 800,
      },
    ],
  });

const ORDER = { key: 'order' as StepSortKey, dir: -1 as const };
const allOpen = () => true;

describe('stepsModel: By step is the average trace', () => {
  it('keeps the server tree in trace order, with the whole trace on top', () => {
    const M = stepsModel(normalizeLatency(treePayload()));
    expect(M.perTrace).toBe(true);
    expect(M.traces).toBe(4);
    const rows = flattenSteps(M.roots, { query: '', sort: ORDER, isOpen: allOpen, traces: 4 });
    expect(rows.map((r) => [r.node.name, r.depth, r.isGroup])).toEqual([
      ['Whole trace', 0, true],
      ['planner', 1, true],
      ['answer', 2, false],
      ['Tool: search', 2, false],
      ['judge', 1, false],
    ]);
    expect(rows[0]!.node.id).toBe('t:');
    expect(rows[2]!.node.id).toBe('t:›planner›answer');
    // One row per step, whatever the model: the models are quiet text on the row.
    expect(rows[2]!.node.models).toEqual(['model-a', 'model-b']);
  });

  it('reads the kind of each row as the trace does', () => {
    const M = stepsModel(normalizeLatency(treePayload()));
    const kinds = walkSteps(M.roots).map((n) => [n.name, n.kind, stepTone(n), stepIcon(n)]);
    expect(kinds).toContainEqual(['Tool: search', 'TOOL', KIND_TONE.TOOL, KIND_ICON.TOOL]);
    expect(kinds).toContainEqual(['planner', 'AGENT', KIND_TONE.AGENT, KIND_ICON.AGENT]);
  });

  it('says when a step runs in only some traces, or more than once in one', () => {
    const M = stepsModel(normalizeLatency(treePayload()));
    const byName = Object.fromEntries(walkSteps(M.roots).map((n) => [n.name, n]));
    expect(byName['Tool: search']!.facts).toBe('in 2 of 4 traces · ×2.0 per trace');
    expect(byName['answer']!.facts).toBeNull();
    expect(byName['Whole trace']!.facts).toBeNull();
    expect(stepFacts(62, 62, 103)).toBe('in 62 of 103 traces');
    expect(stepFacts(103, 247, 103)).toBe('×2.4 per trace');
    expect(stepFacts(null, 8, 4)).toBe('×2.0 per trace');
  });

  it('folds a group the reader closes, and trace order reverses', () => {
    const M = stepsModel(normalizeLatency(treePayload()));
    const folded = flattenSteps(M.roots, {
      query: '',
      sort: ORDER,
      isOpen: (n) => n.id !== 't:›planner',
      traces: 4,
    });
    expect(folded.map((r) => r.node.name)).toEqual(['Whole trace', 'planner', 'judge']);
    expect(folded[1]!.open).toBe(false);
    const reversed = flattenSteps(M.roots, {
      query: '',
      sort: { key: 'order', dir: 1 },
      isOpen: allOpen,
      traces: 4,
    });
    expect(reversed.map((r) => r.node.name)).toEqual([
      'Whole trace',
      'judge',
      'planner',
      'Tool: search',
      'answer',
    ]);
  });

  it('sorts siblings by a number column inside their parent', () => {
    const M = stepsModel(normalizeLatency(treePayload()));
    const rows = flattenSteps(M.roots, {
      query: '',
      sort: { key: 'time', dir: -1 },
      isOpen: allOpen,
      traces: 4,
    });
    expect(rows.map((r) => r.node.name)).toEqual([
      'Whole trace',
      'planner',
      'answer',
      'Tool: search',
      'judge',
    ]);
  });

  it('a search keeps the matches and opens the groups that hold them, folds or not', () => {
    const M = stepsModel(normalizeLatency(treePayload()));
    const closed = () => false;
    const byModel = flattenSteps(M.roots, { query: 'model-b', sort: ORDER, isOpen: closed, traces: 4 });
    expect(byModel.map((r) => r.node.name)).toEqual(['Whole trace', 'planner', 'answer']);
    // A group that matches shows all its rows (open as the reader left it).
    const group = flattenSteps(M.roots, { query: 'plann', sort: ORDER, isOpen: allOpen, traces: 4 });
    expect(group.map((r) => r.node.name)).toEqual(['Whole trace', 'planner', 'answer', 'Tool: search']);
    expect(flattenSteps(M.roots, { query: 'zzz', sort: ORDER, isOpen: allOpen, traces: 4 })).toEqual([]);
    expect(allStepRows(M.roots, { query: '', sort: ORDER, traces: 4 })).toHaveLength(5);
  });
});

describe('stepsModel: By kind is each kind’s time in one trace', () => {
  it('one row per kind with its calls per trace and average call, opening to its steps', () => {
    const M = stepsModel(normalizeLatency(treePayload()));
    expect(M.kinds.map((k) => [k.id, k.name, k.facts])).toEqual([
      ['k:LLM', 'LLM', '1.0 calls / trace · 1.0s avg call'],
      ['k:TOOL', 'Tools', '1.0 calls / trace · 300ms avg call'],
      ['k:EVALUATOR', 'Eval', '1.0 calls / trace · 800ms avg call'],
    ]);
    const tools = M.kinds[1]!;
    expect(tools.perTrace).toBe(300);
    expect(tools.children!.map((c) => [c.id, c.name, c.children])).toEqual([
      ['k:TOOL›t:›planner›Tool: search', 'Tool: search', null],
    ]);
  });
});

describe('stepsModel: without an average trace, the step sites', () => {
  it('falls back to phases and steps, one call each', () => {
    const D = normalizeLatency(
      payload({
        trace_count: 2,
        groups: [group({ n: 4 }, 200), group({ step_type: 'tool:x', kind: 'TOOL', n: 2 }, 50)],
        phases: [group({ phase: 'task', n: 2 }, 900)],
      }),
    );
    const M = stepsModel(D);
    expect(M.perTrace).toBe(false);
    const rows = flattenSteps(M.roots, { query: '', sort: ORDER, isOpen: allOpen, traces: 2 });
    expect(rows.map((r) => [r.node.id, r.node.name, r.node.inTraces])).toEqual([
      ['p:task', 'Agent', null],
      ['s:task::LLM:llm:test:', 'llm:test', null],
      ['s:task::TOOL:tool:x:', 'tool:x', null],
    ]);
    expect(rows[0]!.node.perTrace).toBe(900);
    expect(rows[1]!.node.facts).toBe('×2.0 per trace');
    // By kind adds up the calls and sorts by time per trace.
    expect(M.kinds.map((k) => [k.name, k.calls])).toEqual([
      ['LLM', 4],
      ['Tools', 2],
    ]);
  });
});

describe('stepsAxis', () => {
  it('fits every plotted row, the whole trace too', () => {
    const M = stepsModel(normalizeLatency(treePayload()));
    const stats = flattenSteps(M.roots, { query: '', sort: ORDER, isOpen: allOpen, traces: 4 }).map(
      (r) => r.node.stats,
    );
    for (const scale of ['linear', 'log'] as const) {
      const axis = stepsAxis(stats, scale);
      expect(axis.x(5000)).toBeLessThanOrEqual(100.0001);
      expect(axis.x(600)).toBeLessThan(axis.x(5000));
      expect(axis.ticks[axis.ticks.length - 1]).toBeGreaterThanOrEqual(
        5000 * (scale === 'linear' ? 1 : 0.99),
      );
    }
  });

  it('drops a log tick that would print over an end tick', () => {
    const axis = stepsAxis([{ ...normalizeLatency(payload()).steps[0]!, p5: 220, p95: 9000 }], 'log');
    const x = axis.ticks.map(axis.x);
    x.slice(1, -1).forEach((v) => {
      expect(v).toBeGreaterThan(12);
      expect(v).toBeLessThan(88);
    });
  });
});

describe('Step timings export', () => {
  it('writes the rows as CSV with the path, the plot unit and defused formulas', () => {
    const M = stepsModel(normalizeLatency(treePayload()));
    const csv = stepsCsv(allStepRows(M.roots, { query: '', sort: ORDER, traces: 4 }), M);
    const lines = csv.trim().split('\n');
    expect(lines[0]!.split(',').slice(0, 7)).toEqual([
      'path',
      'depth',
      'name',
      'kind',
      'phase',
      'models',
      'plot',
    ]);
    expect(lines).toHaveLength(6);
    expect(lines[4]).toMatch(
      /^Whole trace \/ planner \/ Tool: search,2,Tool: search,TOOL,task,,one trace,2,4,4,1,300,/,
    );
    const evil = stepsModel(
      normalizeLatency(
        payload({ trace_count: 4, tree: tnode(null, 'CHAIN', 10, {}, [tnode('=cmd()', 'LLM', 5)]) }),
      ),
    );
    expect(stepsCsv(allStepRows(evil.roots, { query: '', sort: ORDER, traces: 4 }), evil)).toContain(
      ",1,'=cmd(),LLM,",
    );
  });

  it('draws one kind colour per row and the caption in the SVG', () => {
    const M = stepsModel(normalizeLatency(treePayload()));
    const rows = allStepRows(M.roots, { query: '', sort: ORDER, traces: 4 });
    const svg = stepsSvg(
      rows,
      stepsAxis(
        rows.map((r) => r.node.stats),
        'log',
      ),
      (t) => (t === KIND_TONE.TOOL ? '#123456' : '#000000'),
      'Each plot is one trace.',
    );
    expect(svg).toContain('fill="#123456"');
    expect(svg).toContain('Each plot is one trace.');
    expect(svg).toContain('Tool: search');
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

  it('in the average trace, opens the path to each step of the kind', () => {
    const T = normalizeLatency(treePayload());
    expect(stepsOfFamily(T, 'TOOL')).toEqual({
      open: ['t:', 't:›planner'],
      ids: ['t:›planner›Tool: search'],
    });
    expect(stepsOfFamily(T, 'EVAL')).toEqual({ open: ['t:'], ids: ['t:›judge'] });
  });
});

describe('one colour and one icon per kind: the trace’s', () => {
  it('each budget family and bracket reads its span kind from the trace', () => {
    expect(FAMILY_TONE.LLM).toBe(KIND_TONE.LLM);
    expect(FAMILY_TONE.TOOL).toBe(KIND_TONE.TOOL);
    expect(KIND_TONE.TOOL).toBe('var(--chart-5)');
    expect(FAMILY_TONE.RETRIEVAL).toBe(KIND_TONE.RETRIEVER);
    expect(FAMILY_TONE.GUARD).toBe(KIND_TONE.GUARDRAIL);
    expect(FAMILY_TONE.OTHER).toBe(KIND_TONE.DEFAULT);
    expect(PHASE_TONE).toEqual({ task: KIND_TONE.AGENT, eval: KIND_TONE.EVALUATOR });
    expect(FAMILY_ICON.TOOL).toBe(KIND_ICON.TOOL);
  });

  it('reads a server kind as the trace reads a span kind', () => {
    expect(['llm', 'Tool', 'embedding', 'retrieve', 'mystery', null].map(toSpanKind)).toEqual([
      'LLM',
      'TOOL',
      'EMBED',
      'RETRIEVER',
      'DEFAULT',
      'DEFAULT',
    ]);
    expect(['TOOL', 'RETRIEVER', 'GUARDRAIL', 'mystery', 'OTHER', ''].map(kindWord)).toEqual([
      'Tools',
      'Retrieval',
      'Guardrails',
      'Mystery',
      'Other',
      'Other',
    ]);
  });

  it('merges the models of one step into one row', () => {
    const D = normalizeLatency(
      payload({ groups: [group({ model: 'model-a', n: 2 }, 100), group({ model: 'model-b', n: 6 }, 200)] }),
    );
    const merged = mergeModels(D.steps);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.model).toBe('model-a · model-b');
    expect(merged[0]!.n).toBe(8);
    expect(merged[0]!.mean).toBeCloseTo(175);
  });
});

describe('fmtMs', () => {
  it('writes table durations in the one duration format (C164)', () => {
    expect(fmtMs(627.4)).toBe('627ms');
    expect(fmtMs(1940)).toBe('1.9s');
    expect(fmtMs(75_000)).toBe('1m 15s');
    expect(fmtMs(18500)).toBe('18.5s');
    expect(fmtMs(NaN)).toBe('—');
  });
});
