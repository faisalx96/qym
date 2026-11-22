/**
 * Latency and traces section math (latency_traces.js): response-time
 * quantiles and histogram bins, the time budget per phase/sub-agent/kind
 * family, the kind panels and the Step timings rows (the average trace, and
 * each kind's time inside one trace).
 */
import type { IconName } from '@/ui';
import type { StepLatencyGroup, StepLatencyKind, StepLatencyPayload, StepLatencyTreeNode } from '../types';
import { formatDuration } from '@/lib/format';
import { KIND_ICON, KIND_TONE } from '../components/traces/spanKinds';
import type { SpanKind } from './traceTree';

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
/**
 * One colour and one icon per kind, everywhere: the trace drawer's (traces/spanKinds.ts is the one source). Each
 * budget family reads the span kind it stands for; Other (time no step accounts for, and the eval phase's part of
 * the budget) is the plain span's quiet grey.
 */
export const FAMILY_KIND: Record<Family, SpanKind> = {
  LLM: 'LLM',
  RETRIEVAL: 'RETRIEVER',
  TOOL: 'TOOL',
  GUARD: 'GUARDRAIL',
  OTHER: 'DEFAULT',
  EVAL: 'EVALUATOR',
};
const byFamily = <T>(f: (k: SpanKind) => T) =>
  Object.fromEntries(Object.entries(FAMILY_KIND).map(([fam, k]) => [fam, f(k)])) as Record<Family, T>;
/** CSS colour per family: the trace's colour of its kind. */
export const FAMILY_TONE: Record<Family, string> = byFamily((k) => KIND_TONE[k]);
export const FAMILY_ICON: Record<Family, IconName> = byFamily((k) => KIND_ICON[k]);
export const PHASE_LABEL = { task: 'Agent', eval: 'Eval' } as const;
export const PHASE_KIND = { task: 'AGENT', eval: 'EVALUATOR' } as const satisfies Record<string, SpanKind>;
/** The Agent and Eval brackets: the trace's agent and evaluator colours. */
export const PHASE_TONE = { task: KIND_TONE.AGENT, eval: KIND_TONE.EVALUATOR } as const;

const SPAN_KINDS: SpanKind[] = [
  'LLM',
  'TOOL',
  'AGENT',
  'CHAIN',
  'EVALUATOR',
  'RETRIEVER',
  'EMBED',
  'GUARDRAIL',
];
/** The span kind of a kind string from the server, read as the trace drawer reads a span's kind (spanKind). */
export function toSpanKind(raw: string | null | undefined): SpanKind {
  const k = String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if ((SPAN_KINDS as string[]).includes(k)) return k as SpanKind;
  if (k === 'EMBEDDING') return 'EMBED';
  if (k === 'RETRIEVE') return 'RETRIEVER';
  return 'DEFAULT';
}
const KIND_WORD: Partial<Record<SpanKind, string>> = {
  LLM: 'LLM',
  TOOL: 'Tools',
  AGENT: 'Agents',
  CHAIN: 'Chain',
  EVALUATOR: 'Eval',
  RETRIEVER: 'Retrieval',
  EMBED: 'Embedding',
  GUARDRAIL: 'Guardrails',
};
/** The name of a By kind row: the kind in words ("Tools", "Retrieval"); an unknown kind keeps its own name. */
export function kindWord(raw: string | null | undefined): string {
  const word = KIND_WORD[toSpanKind(raw)];
  if (word) return word;
  const r = String(raw ?? '').trim();
  return r && r.toUpperCase() !== 'OTHER' ? r.charAt(0).toUpperCase() + r.slice(1).toLowerCase() : 'Other';
}

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
  /** The average trace from the server, or null when the run's traces do not merge into one tree. */
  tree: StepLatencyTreeNode | null;
  /** Each kind's time inside one trace, from the server (null on a payload without it). */
  kinds: StepLatencyKind[] | null;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);

function statsOf(g: Partial<Omit<StepLatencyGroup, 'phase' | 'name'>>): StepStats {
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
    tree: payload.tree && typeof payload.tree === 'object' ? payload.tree : null,
    kinds: Array.isArray(payload.kinds) ? payload.kinds.filter((k) => !!k && typeof k === 'object') : null,
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

/**
 * One row per step, whatever the model (the average trace's rule): the call sites of one step name merge, their
 * calls, errors and tokens add up and the mean is the calls-weighted mean. The quantiles are weighted the same way
 * (an estimate; the kind cards read only the means, calls, errors and tokens).
 */
export function mergeModels(steps: Step[]): Step[] {
  const by = new Map<string, Step[]>();
  steps.forEach((g) => {
    const key = [g.phase, g.agent ?? '', g.kind, g.name].join('\u0000');
    by.set(key, [...(by.get(key) ?? []), g]);
  });
  return Array.from(by.values()).map((list) => {
    if (list.length === 1) return list[0]!;
    const models = Array.from(new Set(list.map((g) => g.model).filter((m): m is string => !!m)));
    return { ...list[0]!, ...aggregateSteps(list), model: models.length ? models.join(' · ') : null };
  });
}

export function kindPanels(D: LatencyData): KindPanel[] {
  if (!D.traces) return [];
  const merged = mergeModels(D.steps);
  const task = merged.filter((g) => g.phase === 'task');
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
      unitWord: 'steps',
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
  const ev = merged.filter((g) => g.phase === 'eval');
  if (ev.length)
    panels.push({
      family: 'EVAL',
      unitWord: 'evaluators',
      rows: ev,
      stats: [callsStat(ev), avgStat(ev), ...(tokens(ev) ? [tokStat(ev)] : [])],
    });
  return panels;
}

/* ── Step timings ── */

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

/**
 * One row of Step timings. By step, the rows are the average trace: the trace's spans merged by name under the same
 * parent (the server's tree), in trace order, one row per step whatever the model. By kind, a row is one kind's time
 * inside one trace and opens to the steps of that kind.
 */
export interface StepNode {
  id: string;
  name: string;
  /** The name is words (the whole trace, a kind, a phase), not a span name: it reads in sans, not mono. */
  words: boolean;
  /** The trace's kind: its colour and icon (traces/spanKinds.ts). */
  kind: SpanKind;
  /** The kind as the server sent it (the budget's families read it). */
  rawKind: string;
  phase: 'task' | 'eval' | null;
  /** A step of the run (an LLM call, a tool, ...), not only a span that holds steps. */
  step: boolean;
  models: string[];
  /** Traces the row runs in; null when the plot is one call (no average trace). */
  inTraces: number | null;
  calls: number;
  /** Time per trace, over all the traces. */
  perTrace: number;
  /** The plot: the time in one trace (all the row's calls there), over the traces it runs in; or one call. */
  stats: StepStats;
  /** Quiet facts under the name: "in 62 of 103 traces", "×2.4 per trace", or a kind's calls and average call. */
  facts: string | null;
  children: StepNode[] | null;
}

export interface StepsModel {
  /** Each plot is the time in one trace (the average trace); false: one call (the run's traces did not merge). */
  perTrace: boolean;
  /** By step: the average trace (one root, the whole trace), or the phases when there is no average trace. */
  roots: StepNode[];
  /** By kind: one row per kind, the slowest first. */
  kinds: StepNode[];
  traces: number;
}

const fmtCount = (n: number) => Math.round(n).toLocaleString('en-US');

/** The facts of a step row: the traces it runs in when not all, and its calls per trace when more than one. */
export function stepFacts(inTraces: number | null, calls: number, traces: number): string | null {
  const parts: string[] = [];
  if (inTraces != null && traces > 0 && inTraces < traces)
    parts.push(`in ${fmtCount(inTraces)} of ${fmtCount(traces)} traces`);
  const per = inTraces != null ? (inTraces > 0 ? calls / inTraces : 0) : traces > 0 ? calls / traces : 0;
  if (per > 1.05) parts.push(`×${per.toFixed(1)} per trace`);
  return parts.length ? parts.join(' · ') : null;
}

const kindFacts = (calls: number, avgCall: number, traces: number) =>
  `${(traces ? calls / traces : 0).toFixed(1)} calls / trace · ${fmtMs(avgCall)} avg call`;

function treeNode(t: StepLatencyTreeNode, parent: string | null, traces: number): StepNode {
  const name = t.name ?? 'Whole trace';
  const id = parent == null ? 't:' : `${parent}›${name}`;
  const kids = (Array.isArray(t.children) ? t.children : []).map((c) => treeNode(c, id, traces));
  const inTraces = parent == null ? traces : Number(t.in_traces) || 0;
  const calls = Number(t.calls) || 0;
  return {
    id,
    name,
    words: t.name == null,
    kind: toSpanKind(t.kind),
    rawKind: t.kind || 'OTHER',
    phase: t.phase === 'eval' || t.phase === 'task' ? t.phase : null,
    step: !!t.step,
    models: Array.isArray(t.models) ? t.models.filter((m) => typeof m === 'string' && m) : [],
    inTraces,
    calls,
    perTrace: num(t.time_per_trace_ms),
    stats: statsOf(t),
    // A group shows its facts too: an agent that runs in some traces, or twice in one, says so.
    facts: stepFacts(inTraces, calls, traces),
    children: kids.length ? kids : null,
  };
}

/** The rows of the run's step sites when there is no average trace: the phases (and sub-agents), one call each. */
function siteRoots(D: LatencyData): StepNode[] {
  const leaf = (g: Step): StepNode => ({
    id: stepId(g),
    name: g.name,
    words: false,
    kind: toSpanKind(g.kind),
    rawKind: g.kind,
    phase: g.phase,
    step: true,
    models: g.model ? [g.model] : [],
    inTraces: null,
    calls: g.n + g.err,
    perTrace: D.traces ? (finite0(g.mean) * g.n) / D.traces : NaN,
    stats: g,
    facts: stepFacts(null, g.n + g.err, D.traces),
    children: null,
  });
  const group = (
    id: string,
    name: string,
    kind: SpanKind,
    phase: 'task' | 'eval',
    stats: StepStats,
    children: StepNode[],
  ): StepNode => ({
    id,
    name,
    words: id.startsWith('p:'),
    kind,
    rawKind: kind,
    phase,
    step: false,
    models: [],
    inTraces: null,
    calls: stats.n + stats.err,
    perTrace: D.traces ? (finite0(stats.mean) * stats.n) / D.traces : NaN,
    stats,
    facts: null,
    children,
  });
  return (['task', 'eval'] as const)
    .map((phase): StepNode | null => {
      const steps = D.steps.filter((g) => g.phase === phase);
      if (!steps.length) return null;
      let children: StepNode[];
      if (phase === 'task' && D.agents.length) {
        const named = new Set(D.agents.map((a) => a.name));
        children = D.agents
          .map((a) =>
            group(
              'a:' + a.name,
              a.name,
              'AGENT',
              phase,
              a,
              steps.filter((g) => g.agent === a.name).map(leaf),
            ),
          )
          .concat(steps.filter((g) => !g.agent || !named.has(g.agent)).map(leaf));
      } else children = steps.map(leaf);
      const root = group(
        'p:' + phase,
        PHASE_LABEL[phase],
        PHASE_KIND[phase],
        phase,
        D.phases[phase] ?? aggregateSteps(steps),
        children,
      );
      // A phase runs once per trace: its time per trace is its span's mean.
      return { ...root, calls: D.traces, perTrace: root.stats.mean };
    })
    .filter((x): x is StepNode => !!x);
}

/** Every node of a forest, parents first. */
export function walkSteps(roots: StepNode[]): StepNode[] {
  const out: StepNode[] = [];
  const go = (n: StepNode) => {
    out.push(n);
    n.children?.forEach(go);
  };
  roots.forEach(go);
  return out;
}

/** A step as a By kind child row: a leaf, with its own facts. */
const kindChild = (kindId: string, n: StepNode, traces: number): StepNode => ({
  ...n,
  id: `${kindId}›${n.id}`,
  facts: stepFacts(n.inTraces, n.calls, traces),
  children: null,
});

/**
 * Step timings' rows. The average trace when the server sent one: the merge rule is the server's (the spans of one
 * name under the same parent are one node; a node's plot is its time in one trace, the sum of its calls there, over
 * the traces it runs in). Without one, the run's step sites, one call each.
 */
export function stepsModel(D: LatencyData): StepsModel {
  const traces = D.traces;
  if (D.tree) {
    const root = treeNode(D.tree, null, traces);
    const roots = [{ ...root, calls: traces }];
    const steps = walkSteps(roots).filter((n) => n.step);
    const kinds = (D.kinds ?? [])
      .filter((k) => (k.n ?? 0) > 0 || (k.error_count ?? 0) > 0)
      .map((k): StepNode => {
        const raw = k.kind || 'OTHER';
        const id = 'k:' + raw;
        const kids = steps.filter((n) => n.rawKind === raw).map((n) => kindChild(id, n, traces));
        const calls = Number(k.calls) || 0;
        return {
          id,
          name: kindWord(raw),
          words: true,
          kind: toSpanKind(raw),
          rawKind: raw,
          phase: null,
          step: false,
          models: [],
          inTraces: Number(k.in_traces) || 0,
          calls,
          perTrace: num(k.time_per_trace_ms),
          stats: statsOf(k),
          facts: kindFacts(calls, num(k.avg_call_ms), traces),
          children: kids.length ? kids : null,
        };
      });
    return { perTrace: true, roots, kinds, traces };
  }
  const roots = siteRoots(D);
  const steps = walkSteps(roots).filter((n) => n.step);
  const raws = Array.from(new Set(steps.map((n) => n.rawKind)));
  const kinds = raws
    .map((raw): StepNode => {
      const id = 'k:' + raw;
      const of = steps.filter((n) => n.rawKind === raw);
      const stats = aggregateSteps(of.map((n) => n.stats));
      const calls = of.reduce((t, n) => t + n.calls, 0);
      return {
        id,
        name: kindWord(raw),
        words: true,
        kind: toSpanKind(raw),
        rawKind: raw,
        phase: null,
        step: false,
        models: [],
        inTraces: null,
        calls,
        perTrace: of.reduce((t, n) => t + finite0(n.perTrace), 0),
        stats,
        facts: kindFacts(calls, stats.mean, traces),
        children: of.map((n) => kindChild(id, n, traces)),
      };
    })
    .sort((a, b) => finite0(b.perTrace) - finite0(a.perTrace));
  return { perTrace: false, roots, kinds, traces };
}

export function stepId(g: Step): string {
  return ['s', g.phase, g.agent ?? '', g.kind, g.name, g.model ?? ''].join(':');
}

/** Trace order (the default By step), or a number column. */
export type StepSortKey = 'order' | 'time' | 'med' | 'calls' | 'err';
const SORTS: Record<Exclude<StepSortKey, 'order'>, (n: StepNode, traces: number) => number> = {
  time: (n) => finite0(n.perTrace),
  med: (n) => finite0(n.stats.med),
  calls: (n, traces) => (traces ? n.calls / traces : 0),
  err: (n) => n.stats.err,
};

export interface StepRow {
  node: StepNode;
  depth: number;
  isGroup: boolean;
  open: boolean;
}

export interface FlattenOptions {
  query: string;
  sort: { key: StepSortKey; dir: 1 | -1 };
  /** Whether a group row is open (the reader's folds). A search opens every group that holds a match. */
  isOpen: (node: StepNode, depth: number) => boolean;
  traces: number;
}

/** Whether a row's own name or models hold the search. */
export function stepMatches(node: StepNode, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || node.name.toLowerCase().includes(q) || node.models.some((m) => m.toLowerCase().includes(q));
}

/**
 * The visible rows, parents first. Siblings keep trace order (or the reverse) or sort by a number column. A search
 * keeps the rows that match and the groups that hold a match (open); a group that matches shows all its rows.
 */
export function flattenSteps(roots: StepNode[], opts: FlattenOptions): StepRow[] {
  const q = opts.query.trim();
  const keep = (n: StepNode): boolean => stepMatches(n, q) || !!n.children?.some(keep);
  const rows: StepRow[] = [];
  const order = (list: StepNode[]) => {
    const { key, dir } = opts.sort;
    if (key === 'order') return dir > 0 ? list.slice().reverse() : list;
    const f = SORTS[key];
    return list.slice().sort((a, b) => dir * (f(a, opts.traces) - f(b, opts.traces)));
  };
  const walk = (list: StepNode[], depth: number, all: boolean) => {
    order(all || !q ? list : list.filter(keep)).forEach((node) => {
      const isGroup = !!node.children?.length;
      const self = !q || all || stepMatches(node, q);
      const open = isGroup && (!self || opts.isOpen(node, depth));
      rows.push({ node, depth, isGroup, open });
      if (open) walk(node.children!, depth + 1, all || (!!q && stepMatches(node, q)));
    });
  };
  walk(roots, 0, false);
  return rows;
}

/** Every row a search keeps, folds ignored (the CSV export: the whole view). */
export function allStepRows(roots: StepNode[], opts: Omit<FlattenOptions, 'isOpen'>): StepRow[] {
  return flattenSteps(roots, { ...opts, isOpen: () => true });
}

export interface StepsAxis {
  x: (v: number) => number;
  ticks: number[];
}

export function stepsAxis(stats: StepStats[], scale: 'linear' | 'log'): StepsAxis {
  const timed = stats.filter((st) => Number.isFinite(st.p5) && Number.isFinite(st.p95));
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
    const x = (v: number) =>
      (100 * (Math.log10(Math.max(v, a)) - Math.log10(a))) / (Math.log10(b) - Math.log10(a));
    const ticks = new Set<number>([a, b]);
    for (let d = Math.pow(10, Math.floor(Math.log10(a))); d <= b; d *= 10) {
      // A tick this close to an end tick would print its label over the end's label.
      [d, d * 3].forEach((t) => {
        if (x(t) > 12 && x(t) < 88) ticks.add(t);
      });
    }
    return { x, ticks: Array.from(ticks).sort((p, q) => p - q) };
  }
  const step = niceStep(hi * 1.02, 6);
  const top = Math.ceil((hi * 1.02) / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-6; v += step) ticks.push(v);
  return { x: (v) => (100 * v) / top, ticks };
}

/** A row's colour and icon: its kind's, as in the trace. */
export const stepTone = (node: StepNode): string => KIND_TONE[node.kind];
export const stepIcon = (node: StepNode): IconName => KIND_ICON[node.kind];

/**
 * Show one kind's steps in Step timings (a kind card's "Open in Step timings"): the groups to open and the row ids
 * to point at, in the By step view.
 */
export function stepsOfFamily(D: LatencyData, family: Family): { open: string[]; ids: string[] } {
  const { roots } = stepsModel(D);
  const open = new Set<string>();
  const ids: string[] = [];
  const wanted = (n: StepNode) =>
    n.step && (family === 'EVAL' ? n.phase === 'eval' : n.phase !== 'eval' && familyOf(n.rawKind) === family);
  const go = (n: StepNode, path: string[]): boolean => {
    let hit = wanted(n);
    if (hit) ids.push(n.id);
    n.children?.forEach((k) => {
      if (go(k, [...path, n.id])) hit = true;
    });
    if (hit) path.forEach((p) => open.add(p));
    return hit;
  };
  roots.forEach((r) => go(r, []));
  return { open: Array.from(open), ids };
}

/** One CSV cell: quoted, and a leading formula sign defused. */
const csvCell = (v: string | number | null): string => {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return '';
  let s = typeof v === 'number' ? String(Math.round(v * 1000) / 1000) : v;
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The rows of the current view as CSV (Export, CSV summary): one line per row, with its path from the top. */
export function stepsCsv(rows: StepRow[], model: Pick<StepsModel, 'perTrace' | 'traces'>): string {
  const head = [
    'path',
    'depth',
    'name',
    'kind',
    'phase',
    'models',
    'plot',
    'in_traces',
    'traces',
    'calls',
    'calls_per_trace',
    'time_per_trace_ms',
    'timed',
    'errors',
    'mean_ms',
    'p5_ms',
    'p25_ms',
    'median_ms',
    'p75_ms',
    'p95_ms',
    'tokens',
  ];
  const path: string[] = [];
  const lines = rows.map(({ node, depth }) => {
    path.length = depth;
    path.push(node.name);
    const st = node.stats;
    return [
      path.join(' / '),
      depth,
      node.name,
      node.rawKind,
      node.phase,
      node.models.join(' · '),
      model.perTrace && node.inTraces != null ? 'one trace' : 'one call',
      node.inTraces,
      model.traces,
      node.calls,
      model.traces ? node.calls / model.traces : null,
      node.perTrace,
      st.n,
      st.err,
      st.mean,
      st.p5,
      st.p25,
      st.med,
      st.p75,
      st.p95,
      st.tok || null,
    ]
      .map(csvCell)
      .join(',');
  });
  return [head.join(','), ...lines].join('\n') + '\n';
}

const xmlEsc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * The visible Step timings rows as a standalone SVG file (the Export menu). `color` resolves a token expression
 * such as `var(--chart-4)` to a colour the file can carry without the app's stylesheet.
 */
export function stepsSvg(
  rows: StepRow[],
  axis: StepsAxis,
  color: (token: string) => string,
  caption = '',
): string {
  const W = 1040;
  const LABEL = 360;
  const NUM = 90;
  const rowH = 30;
  const top = 34;
  const trackW = W - LABEL - NUM - 24;
  const X = (v: number) => LABEL + (trackW * axis.x(v)) / 100;
  const H = top + rows.length * rowH + (caption ? 30 : 12);
  const c = (name: string) => color(`var(${name})`);
  let s =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" ` +
    `font-family="ui-monospace, Menlo, Consolas, monospace" font-size="11">` +
    `<rect width="100%" height="100%" fill="${c('--bg-surface')}"/>`;
  axis.ticks.forEach((t) => {
    s +=
      `<line x1="${X(t)}" x2="${X(t)}" y1="${top - 6}" y2="${top + rows.length * rowH}" stroke="${c('--border-subtle')}"/>` +
      `<text x="${X(t)}" y="${top - 12}" text-anchor="middle" fill="${c('--text-muted')}">${tickLabel(t)}</text>`;
  });
  rows.forEach(({ node, depth }, i) => {
    const y = top + i * rowH + rowH / 2;
    const st = node.stats;
    const tone = color(stepTone(node));
    const models = node.models.filter((m) => m !== node.name);
    const name = node.name + (models.length ? ' · ' + models.join(' · ') : '');
    s +=
      `<rect x="${8 + depth * 14}" y="${y - 5}" width="10" height="10" rx="2" fill="${tone}"/>` +
      `<text x="${24 + depth * 14}" y="${y + 4}" fill="${c('--text-primary')}">${xmlEsc(name)}</text>`;
    if (Number.isFinite(st.med)) {
      s +=
        `<line x1="${X(st.p5)}" x2="${X(st.p95)}" y1="${y}" y2="${y}" stroke="${tone}" stroke-opacity=".6" stroke-width="1.5"/>` +
        `<rect x="${X(st.p25)}" y="${y - 6}" width="${Math.max(2, X(st.p75) - X(st.p25))}" height="12" rx="3" fill="${tone}" fill-opacity=".8"/>` +
        `<rect x="${X(st.med) - 1}" y="${y - 9}" width="2" height="18" fill="${c('--text-primary')}"/>`;
    }
    s += `<text x="${W - 12}" y="${y + 4}" text-anchor="end" fill="${c('--text-secondary')}">${fmtMs(st.med)}</text>`;
  });
  if (caption)
    s += `<text x="8" y="${H - 10}" fill="${c('--text-muted')}" font-family="system-ui, sans-serif">${xmlEsc(caption)}</text>`;
  return s + '</svg>';
}
