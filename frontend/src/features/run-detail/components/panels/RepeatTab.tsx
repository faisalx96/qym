/** Repeat-run analysis: pass@k / pass^k summary, per-pass table, curve and the "passes passed" distribution (brief 04 J4). */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGroupMetricsQuery, usePassesQuery } from '@/api/runs';
import { formatLatency, formatPercent, metricDirectionLabel } from '@/lib/metrics';
import { ErrorState, SegmentedControl, Skeleton, Slider } from '@/ui';
import { useRunPage } from '../../RunContext';
import { Curve, PassCountBars, type CurvePoint } from '../charts/Charts';
import styles from './Panels.module.css';

export function RepeatTab() {
  const { runId, model, api, basePath } = useRunPage();
  const [metric, setMetric] = useState<string>(() => api.selectedMetric ?? model.metricNames[0] ?? '');
  const boolean = !!model.metricIsBoolean[metric];
  const baseThreshold = boolean ? 1 : (model.defaultThresholds[metric] ?? 0.8);
  const [threshold, setThreshold] = useState(baseThreshold);
  const [committed, setCommitted] = useState(baseThreshold);
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const passes = usePassesQuery(runId, true);
  const group = useGroupMetricsQuery(runId, metric, committed, true);
  const g = group.data;
  const k = g?.group?.k ?? model.samples;

  const curve = useMemo(() => {
    const band = g?.band ?? {};
    const ks = Object.keys(band)
      .map(Number)
      .sort((a, b) => a - b);
    const pt = (key: 'pass_at_k' | 'pass_hat_k'): CurvePoint[] =>
      ks.map((kk) => ({
        k: kk,
        value: band[String(kk)]?.[key] ?? null,
        low: band[String(kk)]?.uncertainty?.[key]?.low,
        high: band[String(kk)]?.uncertainty?.[key]?.high,
      }));
    return [
      { name: 'Pass@k', tone: 'var(--chart-1)', points: pt('pass_at_k') },
      { name: 'Pass^k', tone: 'var(--chart-5)', dash: true, points: pt('pass_hat_k') },
    ];
  }, [g]);

  const stats = g?.group;
  const errors = (passes.data?.passes ?? []).reduce((a, p) => a + (p.error_count ?? 0), 0);
  const latencies = (passes.data?.passes ?? [])
    .map((p) => p.avg_latency_ms)
    .filter((v): v is number => typeof v === 'number');
  const avgLatency = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null;

  if (model.metricNames.length === 0) return null;
  return (
    <div className={styles.stack} data-testid="repeat-analysis">
      <p className={styles.note}>
        Every item was evaluated {model.samples}× in this run.{' '}
        {metricDirectionLabel(model.metricDirections[metric] ?? null)}.
      </p>
      <div className={styles.controls}>
        {model.metricNames.length > 1 ? (
          <SegmentedControl
            label="Metric"
            options={model.metricNames.map((m) => ({ value: m, label: m }))}
            value={metric}
            onChange={(m) => {
              setMetric(m);
              const t = model.metricIsBoolean[m] ? 1 : (model.defaultThresholds[m] ?? 0.8);
              setThreshold(t);
              setCommitted(t);
            }}
          />
        ) : null}
        {!boolean ? (
          <Slider
            label="Pass if score"
            unit="%"
            minValue={0}
            maxValue={100}
            step={5}
            value={Math.round(threshold * 100)}
            onChange={(v) => setThreshold((v as number) / 100)}
            onChangeEnd={(v) => setCommitted((v as number) / 100)}
            width="140px"
          />
        ) : null}
      </div>
      {group.isPending ? <Skeleton kind="cards" count={1} label="Loading repeat analysis" /> : null}
      {group.isError ? (
        <ErrorState
          compact
          error={group.error}
          title="Repeat analysis did not load"
          onRetry={() => void group.refetch()}
        />
      ) : null}
      {g?.error ? <p className={styles.note}>{g.error}</p> : null}
      {stats ? (
        <dl className={styles.statGrid} aria-label="Repeat run summary">
          {[
            {
              key: 'pass_at_k',
              label: `Pass@${k}`,
              value: formatPercent(stats.pass_at_k ?? null, 1),
              help: `Share of items where at least one of the ${k} passes passed.`,
            },
            {
              key: 'pass_hat_k',
              label: `Pass^${k}`,
              value: formatPercent(stats.pass_hat_k ?? null, 1),
              help: `Share of items where all ${k} passes passed.`,
            },
            {
              key: 'consistency',
              label: 'Consistency',
              value: formatPercent(stats.consistency ?? null, 1),
              help: 'How often the passes agree on pass/fail. 100% = always, 0% = a 50/50 split.',
            },
            {
              key: 'reliability',
              label: 'Reliability',
              value: formatPercent(stats.reliability ?? null, 1),
              help: 'Of the items that can be solved, how often they are.',
            },
            { key: 'avg', label: 'Avg score', value: formatPercent(stats.avg_at_k ?? null, 1), help: '' },
            { key: 'latency', label: 'Avg latency', value: formatLatency(avgLatency ?? undefined), help: '' },
            { key: 'errors', label: 'Errors', value: String(errors), help: '' },
          ].map((s) => (
            <div key={s.key} className={styles.stat2} title={s.help || undefined} data-stat={s.key}>
              <dt>{s.label}</dt>
              <dd>{s.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {passes.data?.passes?.length ? (
        <table className={styles.table} aria-label="Passes">
          <thead>
            <tr>
              <th scope="col">Pass</th>
              {model.metricNames.map((m) => (
                <th key={m} scope="col">
                  {m}
                </th>
              ))}
              <th scope="col">Avg latency</th>
              <th scope="col">Errors</th>
              <th scope="col">Items</th>
            </tr>
          </thead>
          <tbody>
            {passes.data.passes.map((p) => (
              <tr key={p.pass_number}>
                <td>
                  <Link to={`${basePath}?pass=${p.pass_number}`} aria-label={`Open pass ${p.pass_number}`}>
                    Pass {p.pass_number}
                  </Link>
                </td>
                {model.metricNames.map((m) => (
                  <td key={m}>
                    {p.metric_means?.[m] == null
                      ? '—'
                      : model.metricTypes[m] === 'numeric'
                        ? String(Math.round(p.metric_means[m]! * 10) / 10)
                        : formatPercent(p.metric_means[m]!, 1)}
                  </td>
                ))}
                <td>{p.avg_latency_ms ? formatLatency(p.avg_latency_ms) : '—'}</td>
                <td>{p.error_count ?? 0}</td>
                <td>{p.items_total ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {g?.band ? (
        <section className={styles.stack} aria-label="Performance across attempts">
          <div className={styles.rowHead}>
            <h3 className={styles.groupTitle}>Performance across attempts</h3>
            <SegmentedControl
              label="Curve view"
              options={[
                { value: 'chart', label: 'Chart' },
                { value: 'table', label: 'Table' },
              ]}
              value={view}
              onChange={setView}
            />
          </div>
          {view === 'chart' ? (
            <Curve series={curve} label={`Pass@k and Pass^k for ${metric}`} />
          ) : (
            <table className={styles.table} aria-label="Pass@k values">
              <thead>
                <tr>
                  <th scope="col">k</th>
                  <th scope="col">Pass@k</th>
                  <th scope="col">Pass^k</th>
                </tr>
              </thead>
              <tbody>
                {curve[0]!.points.map((p, i) => (
                  <tr key={p.k}>
                    <td>{p.k}</td>
                    <td>{formatPercent(p.value, 1)}</td>
                    <td>{formatPercent(curve[1]!.points[i]?.value ?? null, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      ) : null}
      {g?.distribution?.length ? (
        <section className={styles.stack} aria-label="Distribution of passes passed">
          <h3 className={styles.groupTitle}>Passes passed</h3>
          <p className={styles.note}>
            Items by number of passes that passed. Select a bar to filter the table.
          </p>
          <PassCountBars
            counts={g.distribution}
            total={model.samples}
            selected={
              api.view.filters.repeat?.metric === metric &&
              api.view.filters.repeat.threshold === (g.threshold ?? committed)
                ? api.view.filters.repeat.bucket
                : null
            }
            onPick={(bucket) =>
              api.setFilters({
                repeat: { metric, bucket, samples: model.samples, threshold: g.threshold ?? committed },
                score: null,
              })
            }
          />
        </section>
      ) : null}
    </div>
  );
}
