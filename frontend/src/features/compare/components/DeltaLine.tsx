/** "Changes vs baseline" strip at the top of the Items section: one pill per candidate column (verdict, band, improved / regressed filters). */
import { useMemo } from 'react';
import { Button, Tag, Text } from '@/ui';
import { useCompare } from '../CompareContext';
import { useColumnStats, type ColumnsInfo } from '../hooks/useColumnStats';
import type { DeltaKind } from '../lib/baseline';
import { computeGroupedComparison, summarizeSweepItems } from '../lib/cohort';
import { columnName } from '../lib/columnName';
import { CountButtons, DeltaTag } from './common';
import { RunTag } from './RunTag';
import styles from './DeltaLine.module.css';

function CohortVerdict() {
  const { model, cohorts, ctx, c } = useCompare();
  const summary = useMemo(() => {
    if (!cohorts || !ctx.direction || model.types[ctx.metric] === 'numeric') return null;
    const g = computeGroupedComparison(model, cohorts, ctx);
    return summarizeSweepItems(g.items, g.leftRunCount, g.rightRunCount, g.reportK, ctx.direction);
  }, [model, cohorts, ctx]);
  if (!cohorts) return null;
  if (!summary)
    return (
      <Text variant="sm" tone="muted">
        Sweep needs a pass/fail metric with a declared direction.
      </Text>
    );
  const avg = summary.noise?.avgAtK ?? null;
  const n = avg ?? summary.noise?.passAtK ?? null;
  const label = avg ? `Avg@${cohorts.k}` : `Pass@${cohorts.k}`;
  const verdict = n?.verdict ?? 'within_noise';
  const tone = verdict === 'improved' ? 'success' : verdict === 'regressed' ? 'danger' : undefined;
  const word = verdict === 'improved' ? 'improved' : verdict === 'regressed' ? 'regressed' : 'within noise';
  return (
    <span className={styles.verdict}>
      <Tag kind="data" tone={tone}>
        {verdict === 'improved' ? '▲' : verdict === 'regressed' ? '▼' : '≈'} {cohorts.rightLabel} vs{' '}
        {cohorts.leftLabel}: {label}{' '}
        {n ? `${n.delta >= 0 ? '+' : '−'}${Math.abs(n.delta * 100).toFixed(1)}` : '—'} pts, {word}
      </Tag>
      <Button size="sm" variant="neutral" onPress={() => c.setView({ tab: 'sweep' })}>
        Open Sweep
      </Button>
    </span>
  );
}

export function DeltaLine({ info }: { info: ColumnsInfo }) {
  const { model, ctx, metric, c, cohorts } = useCompare();
  const stats = useColumnStats(model, info, ctx);
  const type = model.types[metric] ?? 'score';
  const active = c.view.filters.baseline;
  const ranked = useMemo(() => {
    const cands = info.columns.filter((col) => col.key !== info.baseline.key);
    const sign = ctx.direction === 'minimize' ? -1 : 1;
    return [...cands].sort(
      (a, b) => sign * ((stats.get(b.key)?.mean ?? -Infinity) - (stats.get(a.key)?.mean ?? -Infinity)),
    );
  }, [info, stats, ctx.direction]);
  const toggle = (colKey: string, kind: DeltaKind) => {
    const same = active && active.columnKey === colKey && active.kind === kind && active.metric === metric;
    c.setView({
      filters: {
        ...c.view.filters,
        baseline: same ? null : { metric, columnKey: colKey, baselineKey: info.baseline.key, kind },
      },
    });
  };
  return (
    <div className={styles.line} aria-label="Change against the baseline">
      {cohorts ? null : (
        <Text variant="sm" tone="muted" weight={650} className={styles.title}>
          Changes vs baseline
        </Text>
      )}
      {cohorts ? (
        <CohortVerdict />
      ) : (
        <ul className={styles.deltas}>
          {ranked.map((col) => {
            const s = stats.get(col.key);
            const idx = col.runIdxs[0] ?? 0;
            return (
              <li key={col.key} className={styles.delta} data-column={col.key}>
                <RunTag
                  index={idx}
                  compact
                  name={columnName(model, col)}
                  title={col.title}
                />
                {s ? (
                  <>
                    <DeltaTag stats={s} type={type} metric={metric} />
                    <CountButtons
                      stats={s}
                      direction={ctx.direction}
                      label={metric}
                      active={
                        active && active.columnKey === col.key && active.metric === metric
                          ? (active.kind as DeltaKind)
                          : null
                      }
                      onToggle={(k) => toggle(col.key, k)}
                    />
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
