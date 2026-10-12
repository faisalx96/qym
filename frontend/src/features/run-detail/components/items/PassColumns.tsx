/** Repeat items in the all-passes view: one output column per pass with its own verdict, trace and score chips (brief 04 J4). */
import { useMemo, useState } from 'react';
import { formatLatency } from '@/lib/metrics';
import { Chip, CopyButton, Icon, IconButton, ScoreValue, Tag, TextBlock } from '@/ui';
import { bodyText } from '../../lib/itemText';
import { metricCell, rowStatus } from '../../lib/rowDisplay';
import { scopeRowToPass } from '../../lib/passScope';
import { useRunPage } from '../../RunContext';
import type { Row } from '../../types';
import { useItemsUi } from './ItemsUi';
import { MetaList, useCanEdit } from './MetricStrip';
import { ScoreEditor } from './ScoreEditor';
import styles from './PassColumns.module.css';

function PassMetrics({ row, pass, scoped }: { row: Row; pass: number; scoped: Row }) {
  const { model, api, runId, payload } = useRunPage();
  const ui = useItemsUi();
  const canEdit = useCanEdit(row);
  const [editing, setEditing] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className={styles.metrics}>
      {model.metricNames.map((metric) => {
        const cell = metricCell(api.ctx, scoped, metric);
        const meta = (scoped.metric_meta?.[metric] ?? {}) as Record<string, unknown>;
        const key = `${pass}:${metric}`;
        return (
          <div key={metric} className={styles.metric} data-metric={metric} data-pass={pass}>
            <div className={styles.metricHead}>
              <button
                type="button"
                className={styles.caret}
                aria-expanded={open === key}
                aria-label={`${open === key ? 'Hide' : 'Show'} ${metric} details for pass ${pass}`}
                onClick={() => setOpen(open === key ? null : key)}
              >
                <Icon name={open === key ? 'chevron-down' : 'chevron-right'} size={12} />
              </button>
              <span className={styles.metricName}>{metric}</span>
              <ScoreValue
                value={cell.value}
                type={cell.type}
                direction={cell.direction}
                error={cell.error}
                text={cell.text}
              />
              {cell.edited ? <Tag tone="warning">edited</Tag> : null}
              {canEdit ? (
                <IconButton
                  label={`Edit ${metric} score for pass ${pass}`}
                  icon="edit"
                  onPress={() => setEditing(editing === key ? null : key)}
                />
              ) : null}
            </div>
            {editing === key ? (
              <ScoreEditor
                runId={runId}
                filePath={payload.run.file_path ?? payload.run.run_id}
                row={row}
                metric={metric}
                spec={model.metricSpecs[metric]}
                initial={
                  cell.value === null
                    ? ''
                    : cell.type === 'score'
                      ? String(Math.round(cell.value * 1000) / 10) + '%'
                      : String(cell.value)
                }
                passNumber={pass}
                passVersion={model.passRevision}
                edited={cell.edited}
                onDone={() => setEditing(null)}
              />
            ) : null}
            {open === key ? <MetaList meta={meta} hidden={ui.hiddenMetricFields} /> : null}
          </div>
        );
      })}
    </div>
  );
}

export function PassColumns({ row }: { row: Row }) {
  const { model, api } = useRunPage();
  const ui = useItemsUi();
  const passes = useMemo(() => Array.from({ length: model.samples }, (_, i) => i + 1), [model.samples]);
  const scoped = useMemo(
    () => passes.map((p) => scopeRowToPass(row, model.metricNames, p)),
    [passes, row, model.metricNames],
  );
  const [hidden, setHidden] = useState<Set<number>>(() => new Set());
  const outputs = scoped.map((s) => bodyText(s.output_full ?? s.output));
  const unique = new Set(outputs.filter(Boolean)).size;
  return (
    <section className={styles.wrap} data-kind="passes" aria-label="Outputs by pass">
      <header className={styles.head}>
        <span className={styles.label}>Output</span>
        {passes.map((p) => (
          <Chip
            key={p}
            isSelected={!hidden.has(p)}
            onChange={(on) =>
              setHidden((h) => {
                const n = new Set(h);
                if (on) n.delete(p);
                else n.add(p);
                return n;
              })
            }
            aria-label={`Show pass ${p}`}
          >
            Pass {p}
          </Chip>
        ))}
        <Tag kind="count">{unique} unique</Tag>
      </header>
      <div className={styles.cols}>
        {passes
          .filter((p) => !hidden.has(p))
          .map((p) => {
            const s = scoped[p - 1]!;
            const status = rowStatus(api.ctx, s, api.selectedMetric);
            const out = outputs[p - 1] ?? '';
            const text = status.kind === 'error' ? `ERROR: ${s.error || 'The task failed'}` : out;
            return (
              <article key={p} className={styles.col} data-pass={p} data-status={status.kind}>
                <header className={styles.colHead}>
                  <span className={styles.passLabel}>Pass {p}</span>
                  <Tag
                    tone={
                      status.kind === 'pass'
                        ? 'success'
                        : status.kind === 'fail' || status.kind === 'error'
                          ? 'danger'
                          : undefined
                    }
                    title={status.title || undefined}
                  >
                    {status.label}
                  </Tag>
                  {s.latency_ms ? <span className={styles.meta}>{formatLatency(s.latency_ms)}</span> : null}
                  <span className={styles.actions}>
                    {s.trace_id ? (
                      <IconButton
                        label={`Open trace of pass ${p}`}
                        icon="list"
                        onPress={() => ui.openTrace(row.item_id, p)}
                      />
                    ) : null}
                    <CopyButton text={text} label={`Copy pass ${p} output`} />
                  </span>
                </header>
                <div className={styles.output}>
                  <TextBlock text={text} mode={ui.textMode} />
                </div>
                <PassMetrics row={row} pass={p} scoped={s} />
              </article>
            );
          })}
      </div>
    </section>
  );
}
