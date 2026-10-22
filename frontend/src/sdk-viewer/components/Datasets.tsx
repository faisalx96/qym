import { useMemo } from 'react';
import { DataTable, type Column } from '@/ui/DataTable';
import type { Row } from '../types';
import { datasetEntries } from '../lib/datasets';
import { metricCell } from '../lib/metric-cell';
import s from './Datasets.module.css';

const fmt = (value: number | null): string =>
  value === null ? '—' : String(Math.round(value * 1000) / 1000);

export interface DatasetsProps {
  rows: Row[];
  metricNames: string[];
  onShow: (key: string) => void;
}

interface Line {
  key: string;
  label: string;
  version: string | null;
  items: number;
  failed: number;
  means: Array<number | null>;
  all?: boolean;
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
  const lines: Line[] = entries.map((e) => ({
    key: e.key,
    label: e.name,
    version: e.version,
    items: e.items,
    failed: e.failed,
    means: e.means,
  }));
  const columns: Column<Line>[] = [
    {
      id: 'dataset',
      header: 'Dataset',
      flex: true,
      minWidth: 160,
      priority: 1,
      cardTitle: true,
      cell: (l) => (
        <span className={s.name}>
          {l.label}
          {l.version ? <span className={s.version}>{l.version}</span> : null}
        </span>
      ),
      summary: <span className={s.sumLabel}>All datasets</span>,
    },
    {
      id: 'items',
      header: 'Items',
      width: 72,
      type: 'number',
      priority: 2,
      cell: (l) => l.items,
      summary: entries.reduce((n, e) => n + e.items, 0),
    },
    {
      id: 'failed',
      header: 'Failed',
      width: 72,
      type: 'number',
      priority: 2,
      cell: (l) => l.failed,
      summary: entries.reduce((n, e) => n + e.failed, 0),
    },
    ...metricNames.map<Column<Line>>((name, k) => ({
      id: `metric:${name}`,
      header: name,
      label: name,
      width: 120,
      type: 'number',
      priority: 2,
      cell: (l) => fmt(l.means[k] ?? null),
      summary: fmt(totals[k] ?? null),
    })),
    {
      id: 'show',
      header: '',
      label: 'Show rows',
      hideLabel: true,
      width: 88,
      priority: 1,
      cell: (l) => (
        <button type="button" className={s.show} data-testid="show-rows" onClick={() => onShow(l.key)}>
          Show {l.items}
        </button>
      ),
    },
  ];
  return (
    <section className={s.box} aria-label="Scores per dataset" data-testid="dataset-breakdown">
      <h2 className={s.title}>Datasets</h2>
      <DataTable<Line>
        aria-label="Scores per dataset"
        density="regular"
        rows={lines}
        rowKey={(l) => l.key}
        columns={columns}
      />
    </section>
  );
}
