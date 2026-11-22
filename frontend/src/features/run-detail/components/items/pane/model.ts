/** Everything an item pane needs about one row: load state, passes, verdict, metric rows, facts, metadata and the link. */
import { useEffect, useMemo } from 'react';
import { formatHeaderDate, toDate } from '@/lib/dates';
import { formatNumericValue, isItemTaskError, passThresholdLabel, type MetricDirection } from '@/lib/metrics';
import { parseStructured, promptPreview } from '@/ui';
import { bodyText, formatCompact, itemLink } from '../../../lib/itemText';
import { metricPassesFor } from '../../../lib/filterRules';
import { itemVerdict, type ItemVerdict } from '../../../lib/itemVerdict';
import { scopeRowToPass } from '../../../lib/passScope';
import {
  latencyLabel,
  metricCell,
  rowStatus,
  type MetricCell,
  type StatusKind,
} from '../../../lib/rowDisplay';
import { HIDDEN_METADATA_KEYS } from '../../../lib/rowMeta';
import { metricHasPassThreshold } from '../../../lib/runModel';
import { useRunPage } from '../../../RunContext';
import type { MetricAnalysis, Row } from '../../../types';
import { useItemsUi } from '../ItemsUi';

export interface ItemPass {
  pass: number;
  scoped: Row;
  kind: StatusKind;
  label: string;
  taskError: boolean;
}

export interface MetricRow {
  metric: string;
  /** The page metric: it decides the item's Pass or Fail. */
  isPage: boolean;
  /** One cell per pass, in pass order. */
  cells: MetricCell[];
  /** Per pass: true = passes its threshold, false = fails, null = no threshold or no value (as the Items table). */
  verdicts: Array<boolean | null>;
  /** The item's value over all passes, as the Items table shows it. */
  mean: MetricCell;
  meanVerdict: boolean | null;
  /** "≥ 70%"; empty when the metric has no pass threshold. */
  passIf: string;
}

export interface Fact {
  key: string;
  label: string;
  value: string;
  bad?: boolean;
}

const REASON_KEYS = ['reason', 'explanation', 'reasoning', 'label'];
const PROMPT_KEYS = [
  'prompt',
  'question',
  'query',
  'instruction',
  'subject',
  'title',
  'input',
  'text',
  'message',
  'content',
  'user',
];

export function reasonOf(meta: Record<string, unknown> | undefined): string {
  if (!meta) return '';
  for (const k of REASON_KEYS) {
    const v = meta[k];
    if (typeof v === 'string' && v.trim() && v !== 'error') return v;
  }
  return '';
}

export function metaOf(row: Row, metric: string): Record<string, unknown> {
  return (row.metric_meta?.[metric] ?? {}) as Record<string, unknown>;
}

/** Judge metadata without the reason text (the pane shows the reason itself). */
export function extraMeta(meta: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(meta).filter(([k]) => !REASON_KEYS.includes(k)));
}

/** Item-level and per-metric analysis warnings, deduplicated; failed analyses own their warnings. */
export function analysisWarnings(row: Row): string[] {
  const md = row.item_metadata ?? {};
  const analyses = (md.metric_analyses ?? {}) as Record<string, MetricAnalysis | undefined>;
  const out: string[] = [];
  const add = (value: unknown) => {
    const text = String(value ?? '').trim();
    if (text && !out.some((w) => w.toLowerCase() === text.toLowerCase())) out.push(text);
  };
  const failed = !!md.analysis_error || Object.values(analyses).some((a) => a?.error);
  if (!failed) add(md.analysis_warning);
  for (const a of Object.values(analyses)) if (a && !a.error) add(a.warning);
  return out;
}

/** Why the texts of an item are hidden from this reader. */
export function restrictedReason(reason: string | null | undefined): string {
  return reason === 'dataset_access'
    ? 'Hidden: you don’t have access to this dataset’s items.'
    : 'Item bodies are visible to admins only on a private test set.';
}

function editValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'no score';
  return String(typeof value === 'number' ? Number(value.toFixed(4)) : value);
}

/** Who edited the score, when, and from what to what (meta.last_edit), plus the scorer's original value. */
export function editTooltip(meta: Record<string, unknown>): string {
  const record =
    meta.last_edit && typeof meta.last_edit === 'object' ? (meta.last_edit as Record<string, unknown>) : null;
  const lines: string[] = [];
  if (record) {
    const whenText = record.at && toDate(String(record.at)) ? formatHeaderDate(String(record.at)) : '';
    lines.push(
      `${record.action === 'reset' ? 'Reset by ' : 'Edited by '}${String(record.by || 'a reviewer')}${whenText ? ` on ${whenText}` : ''}`,
    );
    lines.push(`${editValue(record.from)} \u2192 ${editValue(record.to)}`);
  } else {
    lines.push('Edited by a reviewer');
  }
  if (meta.original_score !== undefined) lines.push(`Original score: ${editValue(meta.original_score)}`);
  return lines.join('\n');
}

/** A text field under one of the well-known prompt keys, looked for level by level (an input can nest its prompt). */
function promptIn(data: Record<string, unknown>, depth = 0): string | null {
  const entries = Object.entries(data);
  for (const k of PROMPT_KEYS) {
    const hit = entries.find(([key, v]) => key.toLowerCase() === k && typeof v === 'string' && v.trim());
    if (hit) return hit[1] as string;
  }
  if (depth >= 2) return null;
  for (const [, v] of entries) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const inner = promptIn(v as Record<string, unknown>, depth + 1);
      if (inner) return inner;
    }
  }
  return null;
}

/** The prompt of an input as one line: a lone text field or a well-known prompt key, else the table's preview. */
export function promptLine(value: unknown): string {
  const parsed = parseStructured(value);
  if (parsed.structured && !Array.isArray(parsed.data)) {
    const entries = Object.entries(parsed.data);
    const lone =
      entries.length === 1 && typeof entries[0]![1] === 'string' ? (entries[0]![1] as string) : null;
    const main = lone ?? promptIn(parsed.data);
    if (main) return main.replace(/\s+/g, ' ').trim();
  }
  return promptPreview(value, 240);
}

/**
 * The pass rule of a metric as the "Pass if" text: "≥ 70%" for a score, "≤ 3" for a number that is better when lower.
 * The run pane and the compare pane show the same text.
 */
export function passIfText(type: string, threshold: number, direction: MetricDirection | undefined): string {
  return type === 'numeric'
    ? `${direction === 'minimize' ? '≤' : '≥'} ${formatNumericValue(threshold)}`
    : passThresholdLabel(threshold, direction ?? null);
}

export function useItem(row: Row) {
  const { payload, model, api, runId, readOnly, scoresLocked } = useRunPage();
  const ui = useItemsUi();
  const lazy = payload.snapshot.detail_mode === 'lazy';
  const loaded = row.__details_loaded === true || !lazy;
  const loadState = ui.details.stateOf(row.item_id);
  useEffect(() => {
    if (!loaded) void ui.details.ensure([row.item_id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, row.item_id]);

  const ctx = api.ctx;
  const pageMetric = api.selectedMetric;
  const repeat = model.isRepeat && !model.viewPass;
  const multi = repeat && model.samples > 1;

  const passes = useMemo<ItemPass[]>(() => {
    const list = repeat
      ? Array.from({ length: model.samples }, (_, i) => ({
          pass: i + 1,
          scoped: scopeRowToPass(row, model.metricNames, i + 1),
        }))
      : [{ pass: model.viewPass ?? 1, scoped: row }];
    return list.map((p) => {
      const s = rowStatus(ctx, p.scoped, pageMetric);
      return {
        ...p,
        kind: s.kind,
        label:
          s.kind === 'pass' ? 'Pass' : s.kind === 'fail' ? 'Fail' : s.kind === 'error' ? 'Error' : s.label,
        taskError: isItemTaskError(p.scoped),
      };
    });
  }, [repeat, model.samples, model.metricNames, model.viewPass, row, ctx, pageMetric]);

  const metrics = useMemo<MetricRow[]>(() => {
    // the page metric leads, then the run's own order: the same order as the Items table columns
    const names = [...model.metricNames].sort((a, b) => Number(b === pageMetric) - Number(a === pageMetric));
    // a metric with a pass threshold passes or fails; so does one pass of a true / false metric that has a direction
    // (its mean over the passes is a rate, not a verdict)
    const verdictOf = (name: string, c: MetricCell, onePass = true) =>
      (metricHasPassThreshold(model, name) ||
        (onePass && model.metricIsBoolean[name] && model.metricDirections[name])) &&
      c.value !== null &&
      !c.error
        ? metricPassesFor(ctx, name, c.value)
        : null;
    return names.map((name): MetricRow => {
      const cells = passes.map((p) => metricCell(ctx, p.scoped, name));
      const mean = metricCell(ctx, row, name);
      const type = model.metricTypes[name] ?? 'score';
      const threshold = ctx.thresholds[name] ?? 0.8;
      const dir = model.metricDirections[name] ?? null;
      return {
        metric: name,
        isPage: name === pageMetric,
        cells,
        verdicts: cells.map((c) => verdictOf(name, c)),
        mean,
        meanVerdict: verdictOf(name, mean, !multi),
        passIf: metricHasPassThreshold(model, name) ? passIfText(type, threshold, dir) : '',
      };
    });
  }, [model, passes, ctx, row, pageMetric, multi]);

  const verdict: ItemVerdict = itemVerdict(ctx, row, pageMetric);
  const run = payload.run;
  const md = (row.item_metadata ?? {}) as Record<string, unknown>;
  // the item's own metadata as recorded (the platform's bookkeeping keys and the fields hidden on this page left out)
  const metadata: Record<string, unknown> = Object.fromEntries(
    Object.entries(md).filter(
      ([k, v]) => !HIDDEN_METADATA_KEYS.has(k) && !ui.hiddenFields.has(k) && v != null && v !== '',
    ),
  );

  const ts = (row.trace_stats ?? {}) as Record<string, unknown>;
  const facts: Fact[] = [];
  if (!multi && row.latency_ms != null)
    facts.push({ key: 'latency', label: 'Latency', value: latencyLabel(row.latency_ms) });
  if (ts.tokens != null)
    facts.push({ key: 'tokens', label: 'Tokens', value: formatCompact(Number(ts.tokens)) });
  if (Number(ts.cost) > 0)
    facts.push({ key: 'cost', label: 'Cost', value: '$' + Number(ts.cost).toFixed(3) });
  if (ts.llm_calls) facts.push({ key: 'llm', label: 'LLM calls', value: String(ts.llm_calls) });
  if (ts.tool_calls) {
    const errs = Number(ts.tool_errors || ts.malformed_tool_calls || 0);
    facts.push({ key: 'tools', label: 'Tool calls', value: String(ts.tool_calls) });
    facts.push({ key: 'tool-errors', label: 'Tool errors', value: String(errs), bad: errs > 0 });
  }
  if (Number(ts.provider_errors) > 0)
    facts.push({ key: 'provider', label: 'Provider errors', value: String(ts.provider_errors), bad: true });
  if (Number(row.retry_count) > 0)
    facts.push({ key: 'retries', label: 'Retries', value: String(row.retry_count) });

  const rawInput = row.input_full ?? row.input ?? row.input_preview;
  const rawExpected = row.expected_full ?? row.expected;
  const noScores = isItemTaskError(row) || row.output_received === false;
  const canEdit =
    !readOnly && !scoresLocked && !run.items_restricted && String(row.status) !== 'not_received';

  return {
    loaded,
    loadError: !loaded && loadState?.status === 'error',
    loadErrorCause: loadState?.status === 'error' ? loadState.error : undefined,
    retryLoad: () => void ui.details.retry(row.item_id),
    ui,
    run,
    runId,
    model,
    multi,
    passes,
    metrics,
    pageMetric,
    verdict,
    metadata,
    facts,
    rawInput,
    rawExpected,
    prompt: promptLine(rawInput),
    hasExpected: !!bodyText(rawExpected),
    noScores,
    canEdit,
    restricted: !!run.items_restricted,
    link: itemLink(window.location.pathname, row.item_id, model.viewPass, window.location.origin),
  };
}

export type ItemData = ReturnType<typeof useItem>;

/** The pass a multi-pass item opens on: the first pass that did not pass, else pass 1. */
export function firstBadPass(passes: ItemPass[]): number {
  return (passes.find((p) => p.kind !== 'pass') ?? passes[0]!).pass;
}

/** How many passes a multi-pass item shows side by side: at first, and at most (feedback round 2: "3 at a time at maximum"). */
export const OPEN_PASSES = 3;

/**
 * The passes in view after the reader turns one on or off. `order` is the passes in view in the order they were
 * picked (the oldest first). On: the pass joins at the end, and when that makes more than `OPEN_PASSES` the pass picked
 * earliest leaves. Off: the pass leaves, unless it is the last one in view. The result keeps the pick order.
 */
export function pickPass(order: number[], pass: number, on: boolean): number[] {
  const rest = order.filter((n) => n !== pass);
  if (on) return [...rest, pass].slice(-OPEN_PASSES);
  return rest.length ? rest : order;
}

/** The pass that leaves the view when `pass` is turned on (none while there is room). */
export function passReplacedBy(order: number[], pass: number): number | undefined {
  return order.length >= OPEN_PASSES && !order.includes(pass) ? order[0] : undefined;
}

/**
 * The passes a multi-pass item opens with: all of them up to three; with more, three passes in a row that start at
 * the first pass that did not pass (moved back so the window stays three wide).
 */
export function defaultOpenPasses(passes: ItemPass[]): number[] {
  if (passes.length <= OPEN_PASSES) return passes.map((p) => p.pass);
  const first = passes.findIndex((p) => p.kind !== 'pass');
  const start = Math.min(Math.max(0, first), passes.length - OPEN_PASSES);
  return passes.slice(start, start + OPEN_PASSES).map((p) => p.pass);
}

export { bodyText, latencyLabel };
