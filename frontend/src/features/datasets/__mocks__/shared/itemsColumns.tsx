import type { ReactNode } from 'react';
import type { Column } from '@/ui';
import { ScoreValue, Tag } from '@/ui';
import { textDirAttrs } from '@/lib/text';
import { metricNames, type Item } from '../fixtures';
import styles from './shared.module.css';

export function previewText(v: unknown): { text: string; json: boolean } {
  if (typeof v === 'string') return { text: v, json: false };
  return { text: JSON.stringify(v), json: true };
}

export function PreviewCell({ value }: { value: unknown }) {
  const p = previewText(value);
  return (
    <span className={styles.preview} data-json={p.json ? '' : undefined} {...textDirAttrs(p.text)} title={p.text}>
      {p.text}
    </span>
  );
}

export interface ItemColumnOptions {
  /** How the index cell renders (link / button). */
  indexCell?: (row: Item) => ReactNode;
  inputCell?: (row: Item) => ReactNode;
  expectedCell?: (row: Item) => ReactNode;
  metadataCell?: (row: Item) => ReactNode;
  actions?: (row: Item) => ReactNode;
  compact?: boolean;
}

export function itemColumns(opts: ItemColumnOptions = {}): Column<Item>[] {
  const cols: Column<Item>[] = [
    {
      id: 'index',
      label: '#',
      sortKey: 'index',
      width: 56,
      mono: true,
      align: 'end',
      cell: opts.indexCell ?? ((r) => <span className={styles.num}>{r.index}</span>),
    },
    { id: 'item_id', label: 'ID', sortKey: 'item_id', width: 92, mono: true, cell: (r) => r.item_id },
    { id: 'input', label: 'Input', sortKey: 'input', flex: true, minWidth: 180, cell: opts.inputCell ?? ((r) => <PreviewCell value={r.input} />) },
    {
      id: 'expected',
      label: 'Expected',
      sortKey: 'expected',
      flex: true,
      minWidth: 160,
      cell: opts.expectedCell ?? ((r) => <PreviewCell value={r.expected_output} />),
    },
    {
      id: 'metadata',
      label: 'Metadata',
      sortKey: 'metadata',
      width: opts.compact ? 140 : 180,
      cell: opts.metadataCell ?? ((r) => <PreviewCell value={r.metadata} />),
    },
    { id: 'runs', label: 'Runs', sortKey: 'runs', width: 60, align: 'end', mono: true, cell: (r) => r.run_count },
    ...metricNames.map<Column<Item>>((m) => ({
      id: `metric:${m}`,
      label: m,
      sortKey: `metric:${m}`,
      width: 104,
      align: 'end',
      cell: (r) => <ScoreValue value={r.result_summary?.metrics[m]?.avg ?? null} type="score" direction="maximize" />,
    })),
    {
      id: 'latency',
      label: 'Latency',
      sortKey: 'latency',
      width: 80,
      align: 'end',
      mono: true,
      cell: (r) => (r.result_summary?.avg_latency_ms != null ? `${Math.round(r.result_summary.avg_latency_ms)} ms` : '—'),
    },
    {
      id: 'edits',
      label: 'Edits',
      sortKey: 'edits',
      width: 60,
      align: 'end',
      cell: (r) => (r.edit_count ? <Tag kind="count">{r.edit_count}</Tag> : <span className={styles.num}>0</span>),
    },
  ];
  if (opts.actions) cols.push({ id: 'actions', label: 'Actions', hideLabel: true, width: 40, resizable: false, cell: opts.actions });
  return cols;
}
