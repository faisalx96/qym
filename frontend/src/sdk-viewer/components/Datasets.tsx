import { useMemo } from 'react';
import type { Row } from '../types';
import { datasetEntries } from '../lib/datasets';
import { metricCell } from '../lib/metric-cell';
import s from './Datasets.module.css';

const fmt = (value: number | null): string => (value === null ? '—' : String(Math.round(value * 1000) / 1000));

export interface DatasetsProps {
  rows: Row[];
  metricNames: string[];
  onShow: (key: string) => void;
}

/** One row per source dataset of a union file, then the whole run; renders nothing for a single dataset. */
export function Datasets({ rows, metricNames, onShow }: DatasetsProps) {
  const entries = useMemo(() => datasetEntries(rows, metricNames.length), [rows, metricNames.length]);
  const totals = useMemo(
    () =>
      metricNames.map((_, k) => {
        const nums = rows
          .map((r) => metricCell(r.metric_values[k]).num)
          .filter((n): n is number => n !== null);
        return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
      }),
    [rows, metricNames],
  );
  if (!entries.length) return null;
  const items = entries.reduce((n, e) => n + e.items, 0);
  const failed = entries.reduce((n, e) => n + e.failed, 0);
  return (
    <section className={s.box} aria-label="Scores per dataset" data-testid="dataset-breakdown">
      <h2 className={s.title}>Datasets</h2>
      <div className={s.scroll}>
        <table className={s.table}>
          <thead>
            <tr>
              <th scope="col">Dataset</th>
              <th scope="col" className={s.num}>
                Items
              </th>
              <th scope="col" className={s.num}>
                Failed
              </th>
              {metricNames.map((name) => (
                <th key={name} scope="col" className={s.num}>
                  {name}
                </th>
              ))}
              <th scope="col">
                <span className={s.srOnly}>Show rows</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.position}>
                <td className={s.name}>
                  {e.name}
                  {e.version ? <span className={s.version}>{e.version}</span> : null}
                </td>
                <td className={s.num}>{e.items}</td>
                <td className={s.num}>{e.failed}</td>
                {e.means.map((m, k) => (
                  <td key={metricNames[k]} className={s.num}>
                    {fmt(m)}
                  </td>
                ))}
                <td>
                  <button type="button" className={s.show} data-testid="show-rows" onClick={() => onShow(e.key)}>
                    Show {e.items}
                  </button>
                </td>
              </tr>
            ))}
            <tr className={s.sum}>
              <td>All datasets</td>
              <td className={s.num}>{items}</td>
              <td className={s.num}>{failed}</td>
              {totals.map((m, k) => (
                <td key={metricNames[k]} className={s.num}>
                  {fmt(m)}
                </td>
              ))}
              <td />
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
