/** Expanded item: bodies (lazy), metadata, output, trace chips, metrics; repeat items show one column per pass. */
import { useEffect, useState } from 'react';
import { isItemTaskError } from '@/lib/metrics';
import { Button, CopyButton, Icon, LinkButton, Tag, TextBlock } from '@/ui';
import { bodyText, formatCompact, formatStartedAt, itemLink } from '../../lib/itemText';
import {
  HIDDEN_METADATA_KEYS,
  ITEM_METADATA_BADGE_KEYS,
  itemMetadataBadgeValues,
  itemMetadataDisplayValue,
} from '../../lib/rowMeta';
import { buildLangfuseTraceUrl } from '../../lib/traceTree';
import { latencyLabel, rowStatus } from '../../lib/rowDisplay';
import { useRunPage } from '../../RunContext';
import type { MetricAnalysis, Row, RowTraceStats } from '../../types';
import { MetricAnalysisCards } from '../analysis/MetricAnalysisCards';
import { useItemsUi } from './ItemsUi';
import { MetricStrip } from './MetricStrip';
import { PassColumns } from './PassColumns';
import styles from './ItemCard.module.css';

function Collapsible({ text, lines = 6 }: { text: string; lines?: number }) {
  const { textMode } = useItemsUi();
  const [open, setOpen] = useState(false);
  const long = text.length > 400 || text.split('\n').length > lines;
  return (
    <div>
      <div
        className={long && !open ? styles.clamped : undefined}
        style={long && !open ? ({ ['--lines' as string]: lines } as React.CSSProperties) : undefined}
      >
        <TextBlock text={text} mode={textMode} />
      </div>
      {long ? (
        <button type="button" className={styles.more} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}

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
  const status = rowStatus(api.ctx, row, api.selectedMetric);
  void items;

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
  const input = bodyText(row.input_full ?? row.input ?? row.input_preview);
  const expected = bodyText(row.expected_full ?? row.expected);
  const output = isItemTaskError(row)
    ? `ERROR: ${row.error || row.__execution_error || 'The task failed'}`
    : bodyText(row.output_full ?? row.output);
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
  return (
    <div className={styles.state} data-testid="item-card" data-item-id={row.item_id}>
      {run.items_restricted ? (
        <p className={styles.muted}>Item bodies are visible to admins only on a private test set.</p>
      ) : null}
      <section className={styles.block} data-kind="input">
        <header className={styles.blockHead}>
          <span className={styles.label}>Input</span>
          <span className={styles.actions}>
            <CopyButton text={link} label="Copy link" />
            <CopyButton text={input} label="Copy input" />
          </span>
        </header>
        <TextBlock text={input} mode={ui.textMode} />
      </section>
      {expected ? (
        <section className={styles.block} data-kind="expected">
          <header className={styles.blockHead}>
            <span className={styles.label}>Expected output</span>
            <CopyButton text={expected} label="Copy expected output" />
          </header>
          <Collapsible text={expected} />
        </section>
      ) : null}
      {badges.length || tags.length ? (
        <div className={styles.tags}>
          {badges.map(({ k, v }) => (
            <Tag key={`${k}:${v}`} kind="data" title={k}>
              {v}
            </Tag>
          ))}
          {tags.map(([k, v]) => (
            <Tag key={k} kind="data">
              {k}: {itemMetadataDisplayValue(v)}
            </Tag>
          ))}
        </div>
      ) : null}
      {warnings.length ? (
        <div className={styles.warning} role="status" data-testid="analysis-warning">
          <span className={styles.warningLabel}>
            {/taxonom/i.test(warnings.join('; ')) ? 'No taxonomy' : 'Analysis warning'}
          </span>
          <span>{warnings.join('; ')}</span>
        </div>
      ) : null}
      {repeatAggregate ? (
        <PassColumns row={row} />
      ) : (
        <section className={styles.block} data-kind="output">
          <header className={styles.blockHead}>
            <span className={styles.label}>Output</span>
            <Tag
              tone={
                status.kind === 'pass'
                  ? 'success'
                  : status.kind === 'fail' || status.kind === 'error'
                    ? 'danger'
                    : undefined
              }
            >
              {status.label}
            </Tag>
            {row.latency_ms != null ? (
              <span className={styles.meta}>{latencyLabel(row.latency_ms)}</span>
            ) : null}
            {row.task_started_at_ms ? (
              <span className={styles.meta}>{formatStartedAt(row.task_started_at_ms)}</span>
            ) : null}
            <span className={styles.actions}>
              {row.trace_id ? (
                <Button
                  size="sm"
                  variant="neutral"
                  icon={<Icon name="list" size={12} />}
                  onPress={() => ui.openTrace(row.item_id, model.viewPass)}
                >
                  Trace
                </Button>
              ) : null}
              {langfuse ? (
                <LinkButton
                  size="sm"
                  variant="neutral"
                  href={langfuse}
                  target="_blank"
                  rel="noopener noreferrer"
                  icon={<Icon name="external" size={12} />}
                >
                  Open in Langfuse
                </LinkButton>
              ) : null}
              <CopyButton text={output} label="Copy output" />
            </span>
          </header>
          {row.output_received === false ? (
            <p className={styles.note} role="note">
              Output not received: this item’s outcome event never reached the platform. The item is left out
              of Execution success and of the means.
            </p>
          ) : (
            <Collapsible text={output} lines={12} />
          )}
        </section>
      )}
      <TraceChips stats={row.trace_stats} retries={row.retry_count ?? 0} />
      {repeatAggregate || noVerdict ? null : <MetricStrip row={row} />}
      <MetricAnalysisCards row={row} />
    </div>
  );
}
