/** Expanded item: bodies (lazy), metadata, output, trace chips, metrics; repeat items show one column per pass. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { isItemTaskError } from '@/lib/metrics';
import { textDirAttrs } from '@/lib/text';
import { Button, CopyButton, FieldRow, StructuredValue, Tag, parseStructured, useStickyShift } from '@/ui';
import { bodyText, formatCompact, itemLink } from '../../lib/itemText';
import {
  HIDDEN_METADATA_KEYS,
  ITEM_METADATA_BADGE_KEYS,
  itemMetadataBadgeValues,
  itemMetadataDisplayValue,
} from '../../lib/rowMeta';
import { buildLangfuseTraceUrl } from '../../lib/traceTree';
import { scopeRowToPass } from '../../lib/passScope';
import { defaultSelection, shownPasses, togglePass } from '../../lib/passSelection';
import { useShellScroller, useStickyOffset } from '../../hooks/useScrollMargin';
import { itemVerdict } from '../../lib/itemVerdict';
import { useRunPage } from '../../RunContext';
import type { MetricAnalysis, Row, RowTraceStats } from '../../types';
import { MetricAnalysisCards } from '../analysis/MetricAnalysisCards';
import { ItemBar } from './ItemBar';
import { useItemsUi } from './ItemsUi';
import { MetricMatrix, type MatrixPass } from './MetricMatrix';
import { OutputRegion } from './OutputRegion';
import styles from './ItemCard.module.css';

/** Plain strings pick their own direction; structured values read left to right with per-leaf direction. */
function rowText(raw: unknown): string | undefined {
  return typeof raw === 'string' && !raw.trim().startsWith('{') && !raw.trim().startsWith('[')
    ? raw
    : undefined;
}

const isStructured = (v: unknown): boolean => parseStructured(v).structured;

export function TraceChips({ stats, retries }: { stats: RowTraceStats | null | undefined; retries: number }) {
  const ts = stats ?? {};
  const toolErrors = Number(ts.tool_errors || ts.malformed_tool_calls || 0);
  const chips: Array<[string, string, boolean?]> = [];
  if (ts.tokens != null) chips.push([formatCompact(Number(ts.tokens)), 'Tokens']);
  if (Number(ts.cost) > 0) chips.push(['$' + Number(ts.cost).toFixed(3), 'Cost']);
  if (ts.llm_calls) chips.push([String(ts.llm_calls), 'LLM calls']);
  if (ts.tool_calls) chips.push([String(ts.tool_calls), 'Tool calls']);
  if (toolErrors > 0 || ts.tool_calls) chips.push([String(toolErrors), 'Tool errors', toolErrors > 0]);
  if (Number(ts.noisy_reasoning) > 0) chips.push([String(ts.noisy_reasoning), 'Noisy reasoning']);
  if (Number(ts.provider_errors) > 0) chips.push([String(ts.provider_errors), 'Provider errors', true]);
  if (retries > 0) chips.push([String(retries), 'Retries']);
  if (!chips.length) return null;
  return (
    <div className={styles.chips} aria-label="Trace statistics">
      {chips.map(([value, label, bad]) => (
        <Tag key={label} kind="data" tone={bad ? 'danger' : undefined}>
          {value} {label}
        </Tag>
      ))}
    </div>
  );
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

export function ItemCard({ row }: { row: Row }) {
  const { payload, model, api, items } = useRunPage();
  const ui = useItemsUi();
  const lazy = payload.snapshot.detail_mode === 'lazy';
  const loaded = row.__details_loaded === true || !lazy;
  const state = ui.details.stateOf(row.item_id);
  const run = payload.run;
  useEffect(() => {
    if (!loaded && !run.items_restricted) void ui.details.ensure([row.item_id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, row.item_id]);
  const repeatAggregate = model.isRepeat && !model.viewPass;
  void items;
  const articleRef = useRef<HTMLElement>(null);
  const scroller = useShellScroller();
  const stickyOffset = useStickyOffset();
  // the bar owns the sticky line while the table header is held above this detail
  useStickyShift({
    container: articleRef,
    head: (c) => c.querySelector<HTMLElement>('[data-item-bar]'),
    parent: scroller,
    top: stickyOffset,
    // the article only exists once the details have loaded
    enabled: loaded,
  });
  // One entry per pass for a repeat item in the all-passes view; the row itself otherwise.
  const passes = useMemo<MatrixPass[]>(
    () =>
      repeatAggregate
        ? Array.from({ length: model.samples }, (_, i) => ({
            pass: i + 1,
            scoped: scopeRowToPass(row, model.metricNames, i + 1),
          }))
        : [{ pass: model.viewPass ?? 1, scoped: row }],
    [repeatAggregate, model.samples, model.metricNames, model.viewPass, row],
  );
  const multi = repeatAggregate && model.samples > 1;
  const [selected, setSelected] = useState<number[]>(() => defaultSelection(model.samples));

  if (!loaded && state?.status === 'error') {
    return (
      <div className={styles.state} role="alert">
        Item details could not be loaded.{' '}
        <Button size="sm" variant="neutral" onPress={() => void ui.details.retry(row.item_id)}>
          Retry
        </Button>
      </div>
    );
  }
  if (!loaded) {
    return (
      <div className={styles.state} aria-busy="true">
        <span className={styles.muted}>Loading item details…</span>
      </div>
    );
  }
  const link = itemLink(window.location.pathname, row.item_id, model.viewPass, window.location.origin);
  const rawInput = row.input_full ?? row.input ?? row.input_preview;
  const rawExpected = row.expected_full ?? row.expected;
  const input = bodyText(rawInput);
  const expected = bodyText(rawExpected);
  const md = row.item_metadata ?? {};
  const badges = ITEM_METADATA_BADGE_KEYS.filter((k) => !ui.hiddenFields.has(k)).flatMap((k) =>
    itemMetadataBadgeValues(k, md[k]).map((v) => ({ k, v })),
  );
  const noVerdict = isItemTaskError(row) || row.output_received === false;
  const warnings = analysisWarnings(row);
  const tags = Object.entries(md).filter(
    ([k, v]) =>
      !HIDDEN_METADATA_KEYS.has(k) &&
      !ITEM_METADATA_BADGE_KEYS.includes(k) &&
      !ui.hiddenFields.has(k) &&
      v != null &&
      v !== '',
  );
  const langfuse =
    row.trace_url || buildLangfuseTraceUrl(run.langfuse_host, run.langfuse_project_id, row.trace_id);
  const shownForMatrix = shownPasses(selected);
  return (
    <article
      ref={articleRef}
      className={styles.state}
      data-testid="item-card"
      data-item-id={row.item_id}
      aria-label={`Item #${row.index + 1}`}
    >
      <ItemBar
        number={row.index + 1}
        itemId={row.item_id}
        verdict={itemVerdict(api.ctx, row, api.selectedMetric)}
        preview={(input.split('\n')[0] ?? '').slice(0, 200)}
        link={link}
        onCollapse={() => {
          ui.toggleExpanded(row.item_id, false);
          requestAnimationFrame(() =>
            document.querySelector<HTMLElement>(`tr[data-item-id="${CSS.escape(row.item_id)}"]`)?.focus(),
          );
        }}
      />
      {run.items_restricted ? (
        <p className={styles.muted}>Item bodies are visible to admins only on a private test set.</p>
      ) : null}
      <div className={styles.fields}>
        <FieldRow
          label="Input"
          labelAnchor="start"
          text={rowText(rawInput)}
          measure={isStructured(rawInput) ? 'full' : 'prose'}
          actions={<CopyButton text={input} label="Copy input" />}
        >
          <div data-kind="input">
            <StructuredValue value={rawInput} label="Input" textMode={ui.textMode} />
          </div>
        </FieldRow>
        {expected ? (
          <FieldRow
            label="Expected"
            labelAnchor="start"
            text={rowText(rawExpected)}
            measure={isStructured(rawExpected) ? 'full' : 'prose'}
            actions={<CopyButton text={expected} label="Copy expected output" />}
          >
            <div data-kind="expected">
              <StructuredValue value={rawExpected} label="Expected output" textMode={ui.textMode} />
            </div>
          </FieldRow>
        ) : null}
        {badges.length || tags.length ? (
          <FieldRow label="Tags" labelAnchor="start" measure="full">
            <div className={styles.tags}>
              {badges.map(({ k, v }) => (
                <Tag key={`${k}:${v}`} kind="data" title={k}>
                  {v}
                </Tag>
              ))}
              {tags.map(([k, v]) => {
                const shown = itemMetadataDisplayValue(v);
                // key and value are two isolated runs, so an Arabic key still comes first (round 7, D2)
                return (
                  <Tag key={k} kind="data">
                    <span className={styles.tagText}>
                      <span className={styles.tagKey} data-part="key" {...textDirAttrs(k)}>
                        {k}
                      </span>
                      {': '}
                      <span className={styles.tagValue} data-part="value" {...textDirAttrs(shown)}>
                        {shown}
                      </span>
                    </span>
                  </Tag>
                );
              })}
            </div>
          </FieldRow>
        ) : null}
      </div>
      {warnings.length ? (
        <div className={styles.warning} role="status" data-testid="analysis-warning">
          <span className={styles.warningLabel}>
            {/taxonom/i.test(warnings.join('; ')) ? 'No taxonomy' : 'Analysis warning'}
          </span>
          <span>{warnings.join('; ')}</span>
        </div>
      ) : null}
      <OutputRegion
        row={row}
        passes={passes}
        multi={multi}
        selected={selected}
        onToggle={(p) => setSelected((cur) => togglePass(cur, p))}
        langfuseUrl={langfuse}
      />
      <TraceChips stats={row.trace_stats} retries={row.retry_count ?? 0} />
      <hr className={styles.divider} />
      <section className={styles.metrics} aria-label="Metrics">
        {run.items_restricted || noVerdict ? (
          <>
            <h3 className={styles.metricsTitle}>Metrics</h3>
            <p className={styles.muted}>
              {run.items_restricted
                ? 'Scores are visible to admins only'
                : 'No scores: this item produced no output to score.'}
            </p>
          </>
        ) : (
          <MetricMatrix row={row} passes={passes} multi={multi} shown={shownForMatrix} />
        )}
      </section>
      <MetricAnalysisCards row={row} />
    </article>
  );
}
