/** Per-run averages (matrix) and the trace statistics table. */
import { useMemo } from 'react';
import { formatLatency } from '@/lib/metrics';
import { useCompare } from '../../CompareContext';
import { columnName } from '../../lib/columnName';
import { buildTraceRows, type TraceFormat } from '../../lib/panelData';
import { RunTag } from '../RunTag';
import { AveragesMatrix } from './AveragesMatrix';
import { ScrollRegion } from '../ScrollRegion';
import styles from './Panel.module.css';

const fmtTrace = (v: number, f: TraceFormat) =>
  f === 'latency'
    ? formatLatency(v)
    : f === 'tokens'
      ? Math.round(v).toLocaleString()
      : f === 'percent'
        ? `${(v * 100).toFixed(1)}%`
        : v.toFixed(1);

function TraceStatsTable() {
  const { model, columns } = useCompare();
  const rows = useMemo(() => buildTraceRows(model, columns), [model, columns]);
  if (!rows.length) return null;
  return (
    <ScrollRegion className={styles.scroll} label="Trace statistics">
      <table className={styles.table} data-testid="trace-stats-table">
        <caption className={styles.caption}>
          Trace statistics per run (a repeat run&apos;s passes share them). A dash means the run did not
          capture it.
        </caption>
        <thead>
          <tr>
            <th scope="col">Trace stat</th>
            {columns.map((col) => (
              <th scope="col" key={col.key} title={col.title}>
                <RunTag index={col.runIdxs[0] ?? 0} name={columnName(model, col)} compact />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const valid = r.values.filter((v): v is number => v !== null);
            const bestVal = valid.length
              ? r.best === 'high'
                ? Math.max(...valid)
                : Math.min(...valid)
              : null;
            return (
              <tr key={r.id} data-trace-row={r.id}>
                <th scope="row">{r.label}</th>
                {r.values.map((v, i) => (
                  <td key={columns[i]!.key}>
                    <span
                      className={styles.mono}
                      title={v !== null && v === bestVal && valid.length > 1 ? 'Best across runs' : undefined}
                    >
                      {v === null ? '—' : fmtTrace(v, r.format)}
                      {v !== null && v === bestVal && valid.length > 1 ? ' ★' : ''}
                    </span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollRegion>
  );
}

export function MetricsTab() {
  return (
    <div className={styles.stackGap}>
      <AveragesMatrix />
      <TraceStatsTable />
    </div>
  );
}
