/** Setting vs metric: one swept setting on x, one metric on y, one line per environment. */
import { useMemo, useState } from 'react';
import type { ExperimentDetail } from '@/api/experiments';
import { Select, SectionHeader, Card } from '@/ui';
import { buildChart, chartTableRows, metricNames, CHART } from '../lib/chart';
import { currentJobs, usableRun, type MatrixEnv } from '../lib/matrix';
import styles from './detail.module.css';

export function ChartCard({ detail, envs }: { detail: ExperimentDetail; envs: MatrixEnv[] }) {
  const pointers = Object.keys(detail.sweep_keys ?? {});
  const [param, setParam] = useState<string | null>(null);
  const [metricPick, setMetricPick] = useState<string | null>(null);
  const metrics = useMemo(() => metricNames(currentJobs(detail).filter(usableRun)), [detail]);
  const pointer = param && pointers.includes(param) ? param : (pointers[0] ?? '');
  const metric = metricPick && metrics.includes(metricPick) ? metricPick : (metrics[0] ?? null);
  const model = useMemo(() => buildChart(detail, envs, pointer, metric), [detail, envs, pointer, metric]);
  const rows = useMemo(() => chartTableRows(model), [model]);
  if (!pointers.length) return null;
  const settingLabel = detail.sweep_keys[pointer] ?? pointer;
  const { left, right, top, bottom } = model.plot;

  return (
    <Card as="section" aria-labelledby="chart-title" data-exp-chart>
      <div className={styles.stack}>
        <div className={styles.cardHead}>
          <SectionHeader
            id="chart-title"
            title="Setting vs metric"
            description="Mean metric of each finished run against one swept setting, one line per environment."
          />
          <div className={styles.toolbar}>
            <Select
              label="X axis"
              items={pointers.map((p) => ({ key: p, label: detail.sweep_keys[p] ?? p }))}
              value={pointer}
              onChange={(k) => setParam(k ? String(k) : null)}
              searchable={false}
              width={200}
            />
            <Select
              label="Metric"
              items={metrics.map((m) => ({ key: m, label: m }))}
              value={metric}
              onChange={(k) => setMetricPick(k ? String(k) : null)}
              isDisabled={!metrics.length}
              placeholder="No metrics yet"
              width={200}
            />
          </div>
        </div>
        {model.empty ? (
          <p className={styles.empty}>Nothing to plot yet: points appear as runs finish and report scores.</p>
        ) : (
          <div className={styles.chartBox}>
            <svg
              className={styles.svg}
              viewBox={`0 0 ${CHART.width} ${CHART.height}`}
              role="img"
              aria-label={`${metric} by ${settingLabel}, one line per environment`}
            >
              {model.yTicks.map((t, i) => (
                <g key={i}>
                  <line className={styles.grid} x1={left} x2={right} y1={t.py} y2={t.py} />
                  <text className={styles.tick} x={left - 6} y={t.py + 4} textAnchor="end">
                    {t.label}
                  </text>
                </g>
              ))}
              <line className={styles.axis} x1={left} x2={right} y1={bottom} y2={bottom} />
              {model.xTicks.map((t, i) => (
                <text key={i} className={styles.tick} x={t.px} y={bottom + 16} textAnchor="middle">
                  {t.label.length > 18 ? `${t.label.slice(0, 17)}…` : t.label}
                </text>
              ))}
              <text
                className={styles.axisTitle}
                x={left + (right - left) / 2}
                y={CHART.height - 4}
                textAnchor="middle"
              >
                {settingLabel}
              </text>
              {model.series.map((s) => (
                <g key={s.envId} className={styles.series} data-slot={s.slot}>
                  {s.line.length > 1 ? (
                    <polyline
                      className={styles.line}
                      points={s.line.map((p) => `${p.px},${p.py}`).join(' ')}
                    />
                  ) : null}
                  {s.points.map((p) => (
                    <circle key={p.jobId} className={styles.dot} cx={p.px} cy={p.py} r={4}>
                      <title>{`${s.name} · ${settingLabel}=${p.xLabel} · ${metric} ${p.y.toFixed(3)}${p.comboLabel ? ` · ${p.comboLabel}` : ''}`}</title>
                    </circle>
                  ))}
                </g>
              ))}
              <line className={styles.axis} x1={left} x2={left} y1={top} y2={bottom} />
            </svg>
            <ul className={styles.legend} aria-label="Legend">
              {model.series.map((s) => (
                <li key={s.envId} className={styles.legendItem} data-slot={s.slot}>
                  <span className={styles.swatch} aria-hidden="true" />
                  {s.name}
                </li>
              ))}
            </ul>
            <details className={styles.textTable}>
              <summary>View as table</summary>
              <table className={styles.plain}>
                <caption className={styles.srOnly}>{`${metric} by ${settingLabel}`}</caption>
                <thead>
                  <tr>
                    <th scope="col">Environment</th>
                    <th scope="col">{settingLabel}</th>
                    <th scope="col">{metric}</th>
                    <th scope="col">Combination</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td>{r.environment}</td>
                      <td className={styles.mono}>{r.x}</td>
                      <td className={styles.mono}>{r.y}</td>
                      <td>{r.combo || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          </div>
        )}
      </div>
    </Card>
  );
}
