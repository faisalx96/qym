/**
 * Latency and traces section math (latency_traces.js): response-time
 * quantiles and histogram bins, the time budget per phase/sub-agent/kind
 * family, the kind panels and the steps interval plot rows.
 */
import type { StepLatencyGroup, StepLatencyPayload } from '../types';

export type Family = 'LLM' | 'RETRIEVAL' | 'TOOL' | 'GUARD' | 'OTHER' | 'EVAL';
export const FAMILY_ORDER: Family[] = ['LLM', 'RETRIEVAL', 'TOOL', 'GUARD', 'OTHER'];
const FAMILY_OF: Record<string, Family> = {
  LLM: 'LLM',
  TOOL: 'TOOL',
  RETRIEVER: 'RETRIEVAL',
  EMBEDDING: 'RETRIEVAL',
  RERANKER: 'RETRIEVAL',
  GUARDRAIL: 'GUARD',
};
export const familyOf = (kind: string | null | undefined): Family => FAMILY_OF[String(kind ?? '')] ?? 'OTHER';
export const FAMILY_LABEL: Record<Family, string> = {
  LLM: 'LLM',
  RETRIEVAL: 'Retrieval',
  TOOL: 'Tools',
  GUARD: 'Guardrails',
  OTHER: 'Other',
  EVAL: 'Eval',
};
/** CSS token per family (tokens.css --k-*). */
export const FAMILY_TONE: Record<Family, string> = {
  LLM: 'var(--k-llm)',
  RETRIEVAL: 'var(--k-retrieval)',
  TOOL: 'var(--k-tool)',
  GUARD: 'var(--k-guard)',
  OTHER: 'var(--k-other)',
  EVAL: 'var(--k-eval)',
};
export const PHASE_LABEL = { task: 'Agent', eval: 'Eval' } as const;
export const PHASE_TONE = { task: 'var(--k-agent)', eval: 'var(--k-eval)' } as const;

/* ── numbers ── */

export function quantile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

const trimNum = (v: number) => String(Number(v.toFixed(2)));
export const tickLabel = (t: number): string =>
  t === 0 ? '0' : t >= 1000 ? trimNum(t / 1000) + 's' : trimNum(t) + 'ms';

/** The smallest round step (1, 2, 2.5, 5 × 10ⁿ) that fits `range` in at most `count` steps. */
export function niceStep(range: number, count: number): number {
  const raw = Math.max(range, 1e-9) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  return [1, 2, 2.5, 5, 10].map((f) => f * mag).find((s) => s >= raw - 1e-12) ?? 10 * mag;
}

export function durParts(ms: number): [string, string] {
  if (!Number.isFinite(ms)) return ['—', ''];
  if (ms >= 60_000) return [(ms / 60_000).toFixed(1), 'min'];
  if (ms >= 1000) return [(ms / 1000).toFixed(1), 's'];
  return [String(Math.round(ms)), 'ms'];
}
export const durText = (ms: number): string => durParts(ms).join(' ');
export const fmtK = (n: number): string =>
  n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
export const pct = (a: number, b: number): number => (b ? (100 * a) / b : 0);

/* ── response time ── */

export interface LatencyItem {
  itemId: string;
  latency: number;
  error: boolean;
  score: number | null;
  passed: boolean | null;
}

export interface LatencySummary {
  min: number;
  max: number;
  p50: number;
  p90: number;
  p95: number;
  mean: number;
  count: number;
}

export function latencySummary(items: LatencyItem[]): LatencySummary | null {
  if (!items.length) return null;
  const lat = items.map((it) => it.latency).sort((a, b) => a - b);
  return {
    min: lat[0]!,
    max: lat[lat.length - 1]!,
    p50: quantile(lat, 0.5),
    p90: quantile(lat, 0.9),
    p95: quantile(lat, 0.95),
    mean: lat.reduce((a, b) => a + b, 0) / lat.length,
    count: lat.length,
  };
}

export interface LatencyBin {
  a: number;
  b: number;
  items: LatencyItem[];
  errors: number;
  /** Items per band: [below p50, p50–p90, p90–p95, p95+]. */
  counts: [number, number, number, number];
  tone: 'p95' | 'p90' | null;
}

export interface LatencyHistogram {
  bins: LatencyBin[];
  lo: number;
  hi: number;
  width: number;
  max: number;
  ticks: number[];
  xPct: (ms: number) => number;
}

/** About 16 bins across the run's range, on a round width (renderDistribution). */
export function latencyHistogram(items: LatencyItem[], L: LatencySummary): LatencyHistogram {
  const span = L.max - L.min;
  const W = span > 0 ? niceStep(span, 16) : Math.max(1, niceStep(Math.max(L.max, 1), 4));
  const lo = Math.floor(L.min / W) * W;
  const hi = (Math.floor(L.max / W) + 1) * W;
  const bins: LatencyBin[] = [];
  for (let a = lo; a < hi - W / 2; a += W)
    bins.push({ a, b: a + W, items: [], errors: 0, counts: [0, 0, 0, 0], tone: null });
  const cuts = [L.p50, L.p90, L.p95];
  items.forEach((it) => {
    const bin = bins[Math.max(0, Math.min(bins.length - 1, Math.floor((it.latency - lo) / W)))]!;
    bin.items.push(it);
    if (it.error) bin.errors++;
    const band = cuts.filter((c) => it.latency >= c).length as 0 | 1 | 2 | 3;
    bin.counts[band] += 1;
  });
  bins.forEach((b) => {
    b.tone = b.counts[3] ? 'p95' : b.counts[2] ? 'p90' : null;
  });
  const max = Math.max(1, ...bins.map((b) => b.items.length));
  const tickStep = niceStep(hi - lo, 6);
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / tickStep) * tickStep; t <= hi + 1e-9; t += tickStep) ticks.push(t);
  return { bins, lo, hi, width: W, max, ticks, xPct: (ms) => (100 * (ms - lo)) / (hi - lo) };
}

export function latencyFilterLabel(f: { min: number; max: number }): string {
  return (
    'Latency ' +
    (Number.isFinite(f.max)
      ? (f.min > 0 ? durText(f.min) + '–' : '< ') + durText(f.max)
      : '≥ ' + durText(f.min))
  );
}

/* ── inside the traces ── */

export interface StepStats {
  n: number;
  err: number;
  mean: number;
  p5: number;
  p25: number;
  med: number;
  p75: number;
  p95: number;
  tok: number;
}

export interface Step extends StepStats {
  phase: 'task' | 'eval';
  agent: string | null;
  kind: string;
  name: string;
  model: string | null;
}

export interface LatencyData {
  steps: Step[];
  phases: Partial<Record<'task' | 'eval', StepStats>>;
  agents: Array<StepStats & { name: string }>;
  traces: number;
  failed: number;
  avgTrace: number | null;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

function statsOf(g: Partial<StepLatencyGroup>): StepStats {
  return {
    n: g.n ?? 0,
    err: g.error_count ?? 0,
    mean: num(g.mean_ms),
    p5: num(g.p5_ms),
    p25: num(g.p25_ms),
    med: num(g.median_ms),
    p75: num(g.p75_ms),
    p95: num(g.p95_ms),
    tok: g.tokens_total ?? 0,
  };
}

export function normalizeLatency(payload: StepLatencyPayload): LatencyData {
  const keep = (g: Partial<StepLatencyGroup> | null | undefined): g is StepLatencyGroup =>
    !!g && ((g.n ?? 0) > 0 || (g.error_count ?? 0) > 0);
  const steps: Step[] = (payload.groups ?? []).filter(keep).map((g) => ({
    ...statsOf(g),
    phase: g.phase === 'eval' ? 'eval' : 'task',
    agent: g.agent ?? null,
    kind: g.kind ?? 'OTHER',
    name: g.step_type ?? g.kind ?? 'step',
    model: g.model ?? null,
  }));
  const phases: LatencyData['phases'] = {};
  (payload.phases ?? []).filter(keep).forEach((p) => {
    phases[p.phase === 'eval' ? 'eval' : 'task'] = statsOf(p);
  });
  const agents = ((payload.agents ?? []) as unknown as Array<StepLatencyGroup & { name?: string }>)
    .filter((a) => !!a && typeof a === 'object' && keep(a))
    .map((a) => ({ ...statsOf(a), name: String(a.name ?? a.agent ?? '') }));
  const traces = payload.traces ?? {};
  return {
    steps,
    phases,
    agents,
    traces: Number(payload.trace_count) || 0,
    failed: Number(traces?.error_count) || 0,
    avgTrace: Number.isFinite(traces?.mean_ms) ? (traces!.mean_ms as number) : null,
  };
}

export interface BudgetSegment {
  phase: 'task' | 'eval' | null;
  agent: string | null;
  family: Family;
  ms: number;
  overhead?: boolean;
  steps: Step[];
}

export function budgetSegments(D: LatencyData): BudgetSegment[] {
  const segs: BudgetSegment[] = [];
  const per = (g: StepStats) => (Number.isFinite(g.mean) && D.traces ? (g.mean * g.n) / D.traces : 0);
  (['task', 'eval'] as const).forEach((phase) => {
    const steps = D.steps.filter((g) => g.phase === phase);
    if (!steps.length) return;
    const groups = new Map<string, BudgetSegment & { raw: number }>();
    const agentOrder: Array<string | null> = [...D.agents.map((a): string | null => a.name), null];
    steps.forEach((g) => {
      const key = (g.agent ?? '') + '|' + familyOf(g.kind);
      if (!groups.has(key))
        groups.set(key, { phase, agent: g.agent, family: familyOf(g.kind), raw: 0, ms: 0, steps: [] });
      const x = groups.get(key)!;
      x.raw += per(g);
      x.steps.push(g);
    });
    const list = Array.from(groups.values()).sort(
      (a, b) =>
        agentOrder.indexOf(a.agent) - agentOrder.indexOf(b.agent) ||
        FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family),
    );
    D.agents.forEach((a) => {
      const own = list.filter((x) => x.agent === a.name);
      const raw = own.reduce((t, x) => t + x.raw, 0);
      const spanMs = per(a);
      if (raw > spanMs && spanMs > 0) own.forEach((x) => (x.raw *= spanMs / raw));
    });
    const raw = list.reduce((t, x) => t + x.raw, 0);
    const ph = D.phases[phase];
    const phMean = ph && Number.isFinite(ph.mean) ? ph.mean : raw;
    const scale = raw > 0 ? Math.min(1, phMean / raw) : 1;
    list.forEach((x) => {
      x.ms = x.raw * scale;
      segs.push(x);
    });
    const rest = phMean - raw * scale;
    if (rest > phMean * 0.015)
      segs.push({ phase, agent: null, family: 'OTHER', ms: rest, overhead: true, steps: [] });
  });
  const phaseTotal = (['task', 'eval'] as const).reduce(
    (t, p) => t + (D.phases[p] && Number.isFinite(D.phases[p]!.mean) ? D.phases[p]!.mean : 0),
    0,
  );
  const outside = D.avgTrace != null ? D.avgTrace - phaseTotal : 0;
  if (phaseTotal > 0 && D.avgTrace != null && outside > D.avgTrace * 0.01) {
    segs.push({ phase: null, agent: null, family: 'OTHER', ms: outside, overhead: true, steps: [] });
  }
  return segs.filter((s) => s.ms > 0);
}

export interface KindStat {
  key: string;
  label: string;
  value: string;
  unit?: string;
  bad?: boolean;
}

export interface KindPanel {
  family: Family;
  unitWord: string;
  rows: Step[];
  stats: KindStat[];
}

export function kindPanels(D: LatencyData): KindPanel[] {
  if (!D.traces) return [];
  const task = D.steps.filter((g) => g.phase === 'task');
  const of = (f: Family) => task.filter((g) => familyOf(g.kind) === f);
  const calls = (rows: Step[]) => rows.reduce((t, g) => t + g.n + g.err, 0);
  const timed = (rows: Step[]) => rows.reduce((t, g) => t + g.n, 0);
  const avgCall = (rows: Step[]) => {
    const n = timed(rows);
    return n ? rows.reduce((t, g) => t + (Number.isFinite(g.mean) ? g.mean : 0) * g.n, 0) / n : NaN;
  };
  const tokens = (rows: Step[]) => rows.reduce((t, g) => t + (g.tok || 0), 0);
  const callsStat = (rows: Step[]): KindStat => ({
    key: 'calls',
    label: 'calls / trace',
    value: (calls(rows) / D.traces).toFixed(1),
  });
  const avgStat = (rows: Step[]): KindStat => {
    const [v, u] = durParts(avgCall(rows));
    return { key: 'avg', label: 'avg call', value: v, unit: u };
  };
  const tokStat = (rows: Step[]): KindStat => ({
    key: 'tokens',
    label: 'tokens / trace',
    value: fmtK(tokens(rows) / D.traces),
  });
  const panels: KindPanel[] = [];
  const llm = of('LLM');
  if (llm.length)
    panels.push({
      family: 'LLM',
      unitWord: 'call sites',
      rows: llm,
      stats: [callsStat(llm), avgStat(llm), ...(tokens(llm) ? [tokStat(llm)] : [])],
    });
  const tools = of('TOOL');
  if (tools.length) {
    const all = calls(tools);
    panels.push({
      family: 'TOOL',
      unitWord: 'tools',
      rows: tools,
      stats: [
        callsStat(tools),
        avgStat(tools),
        {
          key: 'success',
          label: 'succeeded',
          value: (all ? 100 * (1 - tools.reduce((t, g) => t + g.err, 0) / all) : 100).toFixed(1),
          unit: '%',
        },
      ],
    });
  }
  const ret = of('RETRIEVAL');
  if (ret.length)
    panels.push({ family: 'RETRIEVAL', unitWord: 'steps', rows: ret, stats: [callsStat(ret), avgStat(ret)] });
  const ev = D.steps.filter((g) => g.phase === 'eval');
  if (ev.length)
    panels.push({
      family: 'EVAL',
      unitWord: 'evaluators',
      rows: ev,
      stats: [callsStat(ev), avgStat(ev), ...(tokens(ev) ? [tokStat(ev)] : [])],
    });
  return panels;
}

/* ── steps interval plot ── */

export function aggregateSteps(steps: StepStats[]): StepStats {
  const timed = steps.filter((g) => g.n > 0 && Number.isFinite(g.mean));
  const n = timed.reduce((t, g) => t + g.n, 0);
  const wavg = (f: keyof StepStats) => (n ? timed.reduce((t, g) => t + (g[f] as number) * g.n, 0) / n : NaN);
  return {
    n,
    err: steps.reduce((t, g) => t + g.err, 0),
    mean: wavg('mean'),
    p5: timed.length ? Math.min(...timed.map((g) => g.p5)) : NaN,
    p25: wavg('p25'),
    med: wavg('med'),
    p75: wavg('p75'),
    p95: timed.length ? Math.max(...timed.map((g) => g.p95)) : NaN,
    tok: steps.reduce((t, g) => t + (g.tok || 0), 0),
  };
}

export interface StepNode {
  type: 'phase' | 'agent' | 'step';
  id: string;
  phase: 'task' | 'eval';
  label: string;
  stats: StepStats;
  model?: string | null;
  kind?: string;
  family?: Family;
  agentName?: string;
  children?: StepNode[];
  forcedOpen?: boolean;
}

export interface StepsOptions {
  group: 'step' | 'kind';
  query: string;
}

export function stepId(g: Step): string {
  return ['s', g.phase, g.agent ?? '', g.kind, g.name, g.model ?? ''].join(':');
}

export function buildStepsTree(D: LatencyData, opts: StepsOptions): StepNode[] {
  const q = opts.query.trim().toLowerCase();
  const leaf = (g: Step, phase: 'task' | 'eval', extra: Partial<StepNode> = {}): StepNode => ({
    type: 'step',
    id: stepId(g),
    phase,
    stats: g,
    label: g.name,
    model: g.model,
    kind: g.kind,
    ...extra,
  });
  const match = (node: StepNode) =>
    !q || [node.label, node.model, node.agentName].some((t) => t && t.toLowerCase().includes(q));
  return (['task', 'eval'] as const)
    .map((phase): StepNode | null => {
      const steps = D.steps.filter((g) => g.phase === phase);
      if (!steps.length) return null;
      let children: StepNode[];
      if (opts.group === 'kind') {
        children = FAMILY_ORDER.map((f): StepNode | null => {
          const fs = steps.filter((g) => familyOf(g.kind) === f);
          if (!fs.length) return null;
          return {
            type: 'step',
            id: 'k:' + phase + ':' + f,
            phase,
            label: FAMILY_LABEL[f],
            stats: aggregateSteps(fs),
            family: f,
            model: null,
            kind: f,
          };
        }).filter((x): x is StepNode => !!x);
      } else if (phase === 'task' && D.agents.length) {
        const named = new Set(D.agents.map((a) => a.name));
        children = D.agents
          .map((a): StepNode => ({
            type: 'agent',
            id: 'a:' + a.name,
            phase,
            label: a.name,
            stats: a,
            children: steps
              .filter((g) => g.agent === a.name)
              .map((g) => leaf(g, phase, { agentName: a.name })),
          }))
          .concat(steps.filter((g) => !g.agent || !named.has(g.agent)).map((g) => leaf(g, phase)));
      } else {
        children = steps.map((g) => leaf(g, phase));
      }
      const root: StepNode = {
        type: 'phase',
        id: 'p:' + phase,
        phase,
        label: PHASE_LABEL[phase],
        stats: D.phases[phase] ?? aggregateSteps(steps),
        children,
      };
      if (!q) return root;
      const prune = (node: StepNode): StepNode | null => {
        if (!node.children) return match(node) ? node : null;
        const kids = node.children.map(prune).filter((k): k is StepNode => !!k);
        if (!kids.length && !match(node)) return null;
        return { ...node, children: kids, forcedOpen: true };
      };
      return prune(root);
    })
    .filter((x): x is StepNode => !!x);
}

export type StepSortKey = 'time' | 'med' | 'calls' | 'err';
const finite0 = (v: number) => (Number.isFinite(v) ? v : 0);
const SORTS: Record<StepSortKey, (n: StepNode, D: LatencyData) => number> = {
  time: (n, D) =>
    n.type === 'phase'
      ? finite0(n.stats.mean)
      : D.traces
        ? (finite0(n.stats.mean) * n.stats.n) / D.traces
        : 0,
  med: (n) => finite0(n.stats.med),
  calls: (n, D) => (D.traces ? (n.stats.n + n.stats.err) / D.traces : 0),
  err: (n) => n.stats.err,
};

export interface StepRow {
  node: StepNode;
  depth: number;
  isGroup: boolean;
  open: boolean;
}

export function flattenSteps(
  D: LatencyData,
  tree: StepNode[],
  open: Set<string>,
  sort: { key: StepSortKey; dir: 1 | -1 },
): StepRow[] {
  const rows: StepRow[] = [];
  const sortKids = (kids: StepNode[]) =>
    kids.slice().sort((a, b) => sort.dir * (SORTS[sort.key](a, D) - SORTS[sort.key](b, D)));
  const walk = (node: StepNode, depth: number) => {
    const isGroup = !!node.children;
    const isOpen = isGroup && (!!node.forcedOpen || open.has(node.id));
    rows.push({ node, depth, isGroup, open: isOpen });
    if (isOpen) sortKids(node.children!).forEach((k) => walk(k, depth + 1));
  };
  tree.forEach((t) => walk(t, 0));
  return rows;
}

export interface StepsAxis {
  x: (v: number) => number;
  ticks: number[];
}

export function stepsAxis(rows: StepRow[], scale: 'linear' | 'log'): StepsAxis {
  const timed = rows
    .map((r) => r.node.stats)
    .filter((st) => Number.isFinite(st.p5) && Number.isFinite(st.p95));
  const lo = timed.length ? Math.min(...timed.map((st) => st.p5)) : 1;
  const hi = timed.length ? Math.max(...timed.map((st) => st.p95), 1) : 10;
  if (scale === 'log') {
    const round = (v: number, up: boolean) => {
      const m = Math.pow(10, Math.floor(Math.log10(v)));
      const fs = [1, 2, 3, 5, 10].map((f) => f * m);
      return up ? (fs.find((x) => x >= v) ?? fs[fs.length - 1]!) : (fs.reverse().find((x) => x <= v) ?? m);
    };
    const a = round(Math.max(lo, 1), false);
    const b = Math.max(round(Math.max(hi, 1), true), a * 10);
    const ticks = new Set<number>([a, b]);
    for (let d = Math.pow(10, Math.floor(Math.log10(a))); d <= b; d *= 10) {
      [d, d * 3].forEach((t) => {
        if (t > a * 1.15 && t < b / 1.15) ticks.add(t);
      });
    }
    return {
      x: (v) => (100 * (Math.log10(Math.max(v, a)) - Math.log10(a))) / (Math.log10(b) - Math.log10(a)),
      ticks: Array.from(ticks).sort((p, q) => p - q),
    };
  }
  const step = niceStep(hi * 1.02, 6);
  const top = Math.ceil((hi * 1.02) / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-6; v += step) ticks.push(v);
  return { x: (v) => (100 * v) / top, ticks };
}

export function stepTone(node: StepNode): string {
  if (node.type === 'phase') return PHASE_TONE[node.phase];
  if (node.type === 'agent') return 'var(--k-agent)';
  return FAMILY_TONE[node.family ?? familyOf(node.kind)];
}
