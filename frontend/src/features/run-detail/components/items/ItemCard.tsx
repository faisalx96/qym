/** Expanded item: bodies (lazy), metadata, output, trace chips, metrics; repeat items show one column per pass. */
import { useEffect } from 'react';
import { isItemTaskError } from '@/lib/metrics';
import { Button, CopyButton, FieldRow, Icon, LinkButton, StructuredValue, Tag, parseStructured } from '@/ui';
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

/** A series hue per metadata key so tags scan by kind without filled tiles. */
function hueOf(key: string): number {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 5;
  return h + 1;
}

function MetaTag({ k, children, title }: { k: string; children: React.ReactNode; title?: string }) {
  return (
    <Tag kind="data" title={title}>
      <span className={styles.dot} data-hue={hueOf(k)} aria-hidden="true" />
      {children}
    </Tag>
  );
}

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
  const rawInput = row.input_full ?? row.input ?? row.input_preview;
  const rawExpected = row.expected_full ?? row.expected;
  const input = bodyText(rawInput);
  const expected = bodyText(rawExpected);
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
      <div className={styles.fields}>
        <FieldRow
          label="Input"
          text={rowText(rawInput)}
          dir={rowText(rawInput) === undefined ? 'ltr' : 'auto'}
          measure={isStructured(rawInput) ? 'full' : 'prose'}
          actions={
            <>
              <CopyButton text={link} icon="link" label="Copy link" />
              <CopyButton text={input} label="Copy input" />
            </>
          }
        >
          <div data-kind="input">
            <StructuredValue value={rawInput} label="Input" textMode={ui.textMode} />
          </div>
        </FieldRow>
        {expected ? (
          <FieldRow
            label="Expected output"
            text={rowText(rawExpected)}
            dir={rowText(rawExpected) === undefined ? 'ltr' : 'auto'}
            measure={isStructured(rawExpected) ? 'full' : 'prose'}
            actions={<CopyButton text={expected} label="Copy expected output" />}
          >
            <div data-kind="expected">
              <StructuredValue value={rawExpected} label="Expected output" textMode={ui.textMode} />
            </div>
          </FieldRow>
        ) : null}
      </div>
      {badges.length || tags.length ? (
        <div className={styles.tags}>
          {badges.map(({ k, v }) => (
            <MetaTag key={`${k}:${v}`} k={k} title={k}>
              {v}
            </MetaTag>
          ))}
          {tags.map(([k, v]) => (
            <MetaTag key={k} k={k}>
              {k}: {itemMetadataDisplayValue(v)}
            </MetaTag>
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
        <section
          className={styles.output}
          data-kind="output"
          data-rail={
            status.kind === 'pass'
              ? 'success'
              : status.kind === 'fail' || status.kind === 'error'
                ? 'danger'
                : undefined
          }
          aria-label="Output"
        >
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
            <div className={styles.outputBody}>
              <StructuredValue
                value={isItemTaskError(row) ? output : (row.output_full ?? row.output)}
                label="Output"
                textMode={ui.textMode}
              />
            </div>
          )}
        </section>
      )}
      <TraceChips stats={row.trace_stats} retries={row.retry_count ?? 0} />
      {repeatAggregate || noVerdict ? null : <MetricStrip row={row} />}
      <MetricAnalysisCards row={row} />
    </div>
  );
}
