/**
 * Latency and traces section math (latency_traces.js): response-time
 * quantiles and histogram bins, the time budget per phase/sub-agent/kind
 * family, the kind panels and the steps interval plot rows.
 */
import type { StepLatencyGroup, StepLatencyPayload } from '../types';
import { formatDuration } from '@/lib/format';

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

/** A duration as [value, unit] for a large number with a small unit; past a minute the whole '4m 5s' is the value. */
export function durParts(ms: number): [string, string] {
  if (!Number.isFinite(ms)) return ['—', ''];
  if (ms >= 60_000) return [formatDuration(ms), ''];
  if (ms >= 1000) return [(ms / 1000).toFixed(1), 's'];
  return [String(Math.round(ms)), 'ms'];
}
/** The one duration format (C164): lib/format. */
export const durText = (ms: number): string => (Number.isFinite(ms) ? formatDuration(ms) : '—');
/** Duration for table cells and tooltips: the one format (C164). */
export function fmtMs(ms: number): string {
  return Number.isFinite(ms) ? formatDuration(ms) : '—';
}
export const fmtK = (n: number): string =>
  n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
export const pct = (a: number, b: number): number => (b ? (100 * a) / b : 0);
const finite0 = (v: number) => (Number.isFinite(v) ? v : 0);

/* ── response time ── */

export interface LatencyItem {
  itemId: string;
  latency: number;
  error: boolean;
  /** The page metric's score (0..1), or null when the item has none. */
  score: number | null;
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

export interface LatencyPin {
  key: 'p50' | 'p90' | 'p95';
  ms: number;
  /** Text colour token of the pin's number and stem. */
  tone: string;
  /** Who the pin's filter keeps, for the tooltip title. */
  word: string;
  /** Histogram band index the pin starts (bins count items per band). */
  level: 1 | 2 | 3;
  /** Position on the spectrum, 0 to 100 (fastest to slowest). */
  x: number;
}

/** About how wide a pin chip draws, in px: per pin the padding, the sans key, the gap and the mono value. */
const pinChipWidth = (set: LatencyPin[]) =>
  set.reduce((t, p) => t + 46 + 8 * formatDuration(p.ms).length, 2 + (set.length - 1));

/** The p50, p90 and p95 pins of the latency spectrum, at their positions from fastest (0) to slowest (100). */
export function latencyPins(L: LatencySummary): LatencyPin[] {
  const span = L.max - L.min;
  const pos = (ms: number) => (span > 0 ? (100 * (ms - L.min)) / span : 50);
  return [
    { key: 'p50', ms: L.p50, tone: 'var(--text-primary)', word: 'Slower half', level: 1, x: pos(L.p50) },
    { key: 'p90', ms: L.p90, tone: 'var(--score-3)', word: 'Slowest 10%', level: 2, x: pos(L.p90) },
    { key: 'p95', ms: L.p95, tone: 'var(--score-2)', word: 'Slowest 5%', level: 3, x: pos(L.p95) },
  ];
}

export interface PinChip {
  pins: LatencyPin[];
  /** The chip's left edge in px from the spectrum's start, or null before the spectrum is measured. */
  left: number | null;
  /** Where the bracket of a shared chip meets the chip, 0 to 100. */
  join: number;
}

/**
 * The pin chips over the latency spectrum, one row of them (legacy: pins less than 14% apart share one chip,
 * joined to the track by a bracket). Given the spectrum's width in px, each chip is centred on its pins, kept
 * inside the spectrum and pushed clear of its neighbour; pins whose own chips cannot stay over them share one.
 */
export function pinChips(pins: LatencyPin[], width = 0): PinChip[] {
  const sets: LatencyPin[][] = [];
  pins.forEach((pin) => {
    const last = sets[sets.length - 1];
    if (last && pin.x - last[last.length - 1]!.x < 14) last.push(pin);
    else sets.push([pin]);
  });
  const mid = (set: LatencyPin[]) => (set[0]!.x + set[set.length - 1]!.x) / 2;
  if (width <= 0) return sets.map((set) => ({ pins: set, left: null, join: mid(set) }));
  const GAP = 6;
  const place = (list: LatencyPin[][]) => {
    const boxes = list.map((set) => {
      const w = pinChipWidth(set);
      const left = Math.max(0, Math.min(width - w, (width * mid(set)) / 100 - w / 2));
      return { set, w, left };
    });
    // Push overlapping chips apart: each chip after the first moves right, then back from the end, leftwards.
    for (let i = 1; i < boxes.length; i++)
      boxes[i]!.left = Math.max(boxes[i]!.left, boxes[i - 1]!.left + boxes[i - 1]!.w + GAP);
    for (let i = boxes.length - 1; i >= 0; i--) {
      const limit = i === boxes.length - 1 ? width : boxes[i + 1]!.left - GAP;
      boxes[i]!.left = Math.max(0, Math.min(boxes[i]!.left, limit - boxes[i]!.w));
    }
    return boxes;
  };
  // A chip must stay over its pins (a stem drops from it to each pin); when it cannot, it joins its neighbour.
  const over = (b: { set: LatencyPin[]; w: number; left: number }) =>
    b.set.every((p) => {
      const x = (width * p.x) / 100;
      return x >= b.left - 1 && x <= b.left + b.w + 1;
    });
  let list = sets;
  let boxes = place(list);
  for (
    let i = boxes.findIndex((b) => !over(b));
    i >= 0 && list.length > 1;
    i = boxes.findIndex((b) => !over(b))
  ) {
    const j = i === list.length - 1 ? i - 1 : i;
    list = [...list.slice(0, j), [...list[j]!, ...list[j + 1]!], ...list.slice(j + 2)];
    boxes = place(list);
  }
  return boxes.map((b) => {
    const a = b.set[0]!.x;
    const z = b.set[b.set.length - 1]!.x;
    const centre = (100 * (b.left + b.w / 2)) / width;
    return { pins: b.set, left: b.left, join: Math.max(a, Math.min(z, centre)) };
  });
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

export type BudgetMode = 'phase' | 'agent';

export interface BudgetBracket {
  key: string;
  label: string;
  /** Start and width on the bar, in percent. */
  x: number;
  w: number;
  /** The span's own time per trace (the number its row in Step timings shows). */
  ms: number;
  phase: 'task' | 'eval' | null;
}

/** The brackets over the time budget bar: the phases, or the sub-agents and the eval judges. */
export function budgetBrackets(D: LatencyData, segs: BudgetSegment[], mode: BudgetMode): BudgetBracket[] {
  const total = segs.reduce((t, s) => t + s.ms, 0);
  const spans: BudgetBracket[] = [];
  let acc = 0;
  segs.forEach((s) => {
    const w = pct(s.ms, total);
    const key =
      mode === 'agent'
        ? s.phase === 'eval'
          ? 'eval'
          : (s.agent ?? (s.phase === 'task' ? 'orchestration' : null))
        : s.phase;
    if (key) {
      const last = spans[spans.length - 1];
      if (last && last.key === key) {
        last.w += w;
        last.ms += s.ms;
      } else spans.push({ key, label: key, x: acc, w, ms: s.ms, phase: s.phase });
    }
    acc += w;
  });
  return spans.map((sp) => {
    const label =
      mode === 'agent'
        ? sp.key === 'eval'
          ? 'Eval judges'
          : sp.key
        : PHASE_LABEL[sp.key as 'task' | 'eval'];
    const agent = D.agents.find((a) => a.name === sp.key);
    const ph = mode === 'phase' ? D.phases[sp.key as 'task' | 'eval'] : undefined;
    const ms =
      mode === 'phase'
        ? ph && Number.isFinite(ph.mean)
          ? ph.mean
          : sp.ms
        : agent && D.traces
          ? (agent.mean * agent.n) / D.traces
          : sp.ms;
    return { ...sp, label, ms };
  });
}

export interface KindStat {
  key: string;
  label: string;
  value: string;
  unit?: string;
  bad?: boolean;
  /** The stat per call site, tool or evaluator, for its breakdown. */
  by: (g: Step) => number;
  byFmt: (v: number) => string;
  /** Breakdown title when "<Label> by <unit>" does not read well. */
  byTitle?: string;
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
    by: (g) => (g.n + g.err) / D.traces,
    byFmt: (v) => v.toFixed(2),
  });
  const avgStat = (rows: Step[]): KindStat => {
    const [v, u] = durParts(avgCall(rows));
    return { key: 'avg', label: 'avg call', value: v, unit: u, by: (g) => finite0(g.mean), byFmt: fmtMs };
  };
  const tokStat = (rows: Step[]): KindStat => ({
    key: 'tokens',
    label: 'tokens / trace',
    value: fmtK(tokens(rows) / D.traces),
    by: (g) => (g.tok || 0) / D.traces,
    byFmt: fmtK,
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
          by: (g) => (g.n + g.err ? g.err / (g.n + g.err) : 0),
          byFmt: (v) => (100 * v).toFixed(1) + '% failed',
          byTitle: 'Failure rate by tool',
          bad: true,
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
  open: ReadonlySet<string>,
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

/** How many steps a group row holds (its leaves, at any depth). */
export function countLeaves(node: StepNode): number {
  return node.children ? node.children.reduce((t, k) => t + countLeaves(k), 0) : 1;
}

/** Calls per trace of a row: a phase runs once per trace. */
export function callsPerTrace(node: StepNode, traces: number): number {
  if (node.type === 'phase') return 1;
  return traces ? (node.stats.n + node.stats.err) / traces : 0;
}

/** Time per trace of a row: a phase's is its span; a step's is its mean times its calls, spread over the traces. */
export function timePerTrace(node: StepNode, traces: number): number {
  if (node.type === 'phase') return node.stats.mean;
  return traces ? (finite0(node.stats.mean) * node.stats.n) / traces : NaN;
}

/**
 * Show one kind's steps in Step timings (a kind card's "Open in Step timings"): the groups to open and the step
 * ids to point at, in the By step view.
 */
export function stepsOfFamily(D: LatencyData, family: Family): { open: string[]; ids: string[] } {
  const phase = family === 'EVAL' ? 'eval' : 'task';
  const wanted = D.steps.filter(
    (g) => g.phase === phase && (family === 'EVAL' || familyOf(g.kind) === family),
  );
  const open = new Set<string>(['p:' + phase]);
  wanted.forEach((g) => {
    if (g.agent) open.add('a:' + g.agent);
  });
  return { open: Array.from(open), ids: wanted.map(stepId) };
}

const xmlEsc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The visible Step timings rows as a standalone SVG file (the Export menu). `color` resolves a token expression
 * such as `var(--k-llm)` to a colour the file can carry without the app's stylesheet.
 */
export function stepsSvg(rows: StepRow[], axis: StepsAxis, color: (token: string) => string): string {
  const W = 960;
  const LABEL = 280;
  const NUM = 90;
  const rowH = 30;
  const top = 34;
  const trackW = W - LABEL - NUM - 24;
  const X = (v: number) => LABEL + (trackW * axis.x(v)) / 100;
  const H = top + rows.length * rowH + 12;
  const c = (name: string) => color(`var(${name})`);
  let s =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
    `font-family="ui-monospace, Menlo, Consolas, monospace" font-size="11">` +
    `<rect width="100%" height="100%" fill="${c('--bg-surface')}"/>`;
  axis.ticks.forEach((t) => {
    s +=
      `<line x1="${X(t)}" x2="${X(t)}" y1="${top - 6}" y2="${H - 8}" stroke="${c('--border-subtle')}"/>` +
      `<text x="${X(t)}" y="${top - 12}" text-anchor="middle" fill="${c('--text-muted')}">${tickLabel(t)}</text>`;
  });
  rows.forEach(({ node, depth }, i) => {
    const y = top + i * rowH + rowH / 2;
    const st = node.stats;
    const tone = color(stepTone(node));
    const name = node.label + (node.model && node.model !== node.label ? ' · ' + node.model : '');
    s += `<text x="${8 + depth * 16}" y="${y + 4}" fill="${c('--text-primary')}">${xmlEsc(name)}</text>`;
    if (Number.isFinite(st.med)) {
      s +=
        `<line x1="${X(st.p5)}" x2="${X(st.p95)}" y1="${y}" y2="${y}" stroke="${tone}" stroke-opacity=".6" stroke-width="1.5"/>` +
        `<rect x="${X(st.p25)}" y="${y - 6}" width="${Math.max(2, X(st.p75) - X(st.p25))}" height="12" rx="3" fill="${tone}" fill-opacity=".8"/>` +
        `<rect x="${X(st.med) - 1}" y="${y - 9}" width="2" height="18" fill="${c('--text-primary')}"/>`;
    }
    s += `<text x="${W - 12}" y="${y + 4}" text-anchor="end" fill="${c('--text-secondary')}">${fmtMs(st.med)}</text>`;
  });
  return s + '</svg>';
}
