/** Repeat items in the all-passes view: one output column per pass with its own verdict, trace and score chips (brief 04 J4). */
import { useMemo, useState } from 'react';
import { Button, Chip, CopyButton, Icon, ScoreValue, Select, StructuredValue, Tag } from '@/ui';
import { bodyText } from '../../lib/itemText';
import { latencyLabel, metricCell, rowStatus } from '../../lib/rowDisplay';
import { scopeRowToPass } from '../../lib/passScope';
import { useRunPage } from '../../RunContext';
import type { Row } from '../../types';
import { useItemsUi } from './ItemsUi';
import { MetricChips, useCanEdit } from './MetricStrip';
import styles from './PassColumns.module.css';

/** One metric lined up across the passes (the old per-metric comparison panel). */
function PassMetricCompare({ scoped }: { scoped: Row[] }) {
  const { model, api } = useRunPage();
  const [metric, setMetric] = useState<string | null>(null);
  const current =
    metric && model.metricNames.includes(metric) ? metric : (api.selectedMetric ?? model.metricNames[0]);
  if (!current || model.metricNames.length === 0) return null;
  return (
    <div className={styles.compare} data-testid="pass-metric-compare">
      <Select
        label="Compare metric across passes"
        items={model.metricNames.map((n) => ({ key: n, label: n }))}
        value={current}
        onChange={(k) => k && setMetric(String(k))}
        width="16ch"
      />
      <dl className={styles.compareList} aria-label={`${current} by pass`}>
        {scoped.map((s, i) => {
          const cell = metricCell(api.ctx, s, current);
          return (
            <div key={i} className={styles.compareItem} data-pass={i + 1}>
              <dt>Pass {i + 1}</dt>
              <dd>
                <ScoreValue
                  value={cell.value}
                  type={cell.type}
                  direction={cell.direction}
                  error={cell.error}
                  text={cell.text}
                />
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

export function PassColumns({ row }: { row: Row }) {
  const { model, api } = useRunPage();
  const canEdit = useCanEdit(row);
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
            series={(((p - 1) % 3) + 1) as 1 | 2 | 3}
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
        <PassMetricCompare scoped={scoped} />
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
                  {s.latency_ms != null ? (
                    <span className={styles.meta}>{latencyLabel(s.latency_ms)}</span>
                  ) : null}
                  {p > 1 && out ? (
                    <Tag kind="count" data-testid="pass-diff">
                      {out === outputs[0] ? 'same as Pass 1' : 'differs from Pass 1'}
                    </Tag>
                  ) : null}
                  <span className={styles.actions}>
                    {s.trace_id ? (
                      <Button
                        size="sm"
                        variant="neutral"
                        icon={<Icon name="list" size={12} />}
                        aria-label={`Open trace of pass ${p}`}
                        onPress={() => ui.openTrace(row.item_id, p)}
                      >
                        Trace
                      </Button>
                    ) : null}
                    <CopyButton text={text} label={`Copy pass ${p} output`} />
                  </span>
                </header>
                <div className={styles.output}>
                  <StructuredValue
                    value={status.kind === 'error' ? text : (s.output_full ?? s.output)}
                    label={`Output, pass ${p}`}
                    textMode={ui.textMode}
                  />
                </div>
                <MetricChips
                  row={row}
                  scoped={s}
                  pass={p}
                  canEdit={canEdit}
                  label={`Metrics for pass ${p}`}
                />
              </article>
            );
          })}
      </div>
    </section>
  );
}
