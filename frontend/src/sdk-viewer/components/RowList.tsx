import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { textDirAttrs } from '@/lib/text';
import type { Row } from '../types';
import type { SortDir, SortKey } from '../lib/table-model';
import { metricCell, formatScore } from '../lib/metric-cell';
import { formatLatency } from '../lib/stats';
import { StatusBadge } from './StatusBadge';
import s from './RowList.module.css';

const PAGE = 200;

export interface RowListProps {
  rows: Row[];
  metricNames: string[];
  selected: number | null;
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey) => void;
  onOpen: (index: number) => void;
}

function Cell({ value, edited }: { value: string | number | undefined; edited?: boolean }) {
  const cell = metricCell(value);
  return (
    <span className={s.score} data-kind={cell.kind} title={edited ? `${cell.text} (edited)` : cell.text}>
      {edited ? <i aria-hidden="true" className={s.edited} /> : null}
      {cell.kind === 'pass' || cell.kind === 'fail' ? <i aria-hidden="true" className={s.dot} /> : null}
      {formatScore(cell)}
    </span>
  );
}

/** Native table: sortable headers, roving tabindex (arrows move, Enter opens), windowed for long runs. */
export function RowList({ rows, metricNames, selected, sort, dir, onSort, onOpen }: RowListProps) {
  const [limit, setLimit] = useState(PAGE);
  const body = useRef<HTMLTableSectionElement>(null);
  const empty = rows.length === 0;
  useEffect(() => setLimit(PAGE), [empty]);
  const shown = rows.slice(
    0,
    Math.max(limit, selected === null ? 0 : rows.findIndex((r) => r.index === selected) + 1),
  );

  const onKey = (e: KeyboardEvent<HTMLTableRowElement>) => {
    const trs = Array.from(body.current?.querySelectorAll<HTMLElement>('tr[data-row]') ?? []);
    const at = trs.indexOf(e.currentTarget);
    const go = (n: number) => trs[Math.max(0, Math.min(trs.length - 1, n))]?.focus();
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        go(at + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        go(at - 1);
        break;
      case 'Home':
        e.preventDefault();
        go(0);
        break;
      case 'End':
        e.preventDefault();
        go(trs.length - 1);
        break;
      case 'PageDown':
        e.preventDefault();
        go(at + 10);
        break;
      case 'PageUp':
        e.preventDefault();
        go(at - 10);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onOpen(Number(e.currentTarget.dataset.row));
        break;
      default:
    }
  };

  const th = (key: SortKey, label: string, title: string, num?: boolean) => (
    <th
      scope="col"
      className={num ? s.num : undefined}
      title={title}
      aria-sort={sort === key ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button type="button" className={s.thBtn} onClick={() => onSort(key)}>
        <span className={s.thText}>{label}</span>
        <span aria-hidden="true" className={sort === key ? s.sortOn : s.sortHint}>
          {sort === key ? (dir === 'asc' ? '▲' : '▼') : '↕'}
        </span>
      </button>
    </th>
  );

  return (
    <div className={s.wrap} id="rows">
      <table className={s.table}>
        <caption className={s.srOnly}>
          Evaluation rows. Arrow keys move between rows, Enter opens the detail.
        </caption>
        <colgroup>
          <col style={{ width: '6ch' }} />
          <col style={{ width: '11ch' }} />
          <col />
          <col />
          {metricNames.map((name) => (
            <col
              key={name}
              style={{ width: `${Math.min(28, Math.max(11, Math.ceil(name.length * 1.2) + 5))}ch` }}
            />
          ))}
          <col style={{ width: '11ch' }} />
        </colgroup>
        <thead>
          <tr>
            {th('index', '#', 'Row number', true)}
            {th('status', 'Status', 'Status')}
            <th scope="col">Input</th>
            <th scope="col">Output</th>
            {metricNames.map((name, k) => th(`metric:${k}`, name, name, true))}
            {th('latency', 'Time', 'Latency', true)}
          </tr>
        </thead>
        <tbody ref={body}>
          {shown.map((r, i) => (
            <tr
              key={r.index}
              data-row={r.index}
              data-status={r.status}
              aria-selected={selected === r.index}
              tabIndex={i === 0 ? 0 : -1}
              onKeyDown={onKey}
              onClick={() => onOpen(r.index)}
            >
              <td className={s.num}>{r.index + 1}</td>
              <td>
                <StatusBadge status={r.status} />
              </td>
              <td className={s.text} {...textDirAttrs(r.input)}>
                <span className={s.clamp}>{r.input_full}</span>
              </td>
              <td className={s.text} data-err={r.status === 'error' || undefined} {...textDirAttrs(r.output)}>
                <span className={s.clamp}>
                  {r.status === 'pending' || r.status === 'in_progress' ? '' : r.output_full}
                </span>
              </td>
              {metricNames.map((name, k) => (
                <td key={name} className={s.num}>
                  <Cell value={r.metric_values[k]} edited={r.metric_meta?.[name]?.modified === 'true'} />
                </td>
              ))}
              <td className={s.num}>{formatLatency(r.latency_ms)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {shown.length < rows.length ? (
        <div className={s.more}>
          <button type="button" className={s.moreBtn} onClick={() => setLimit(shown.length + PAGE)}>
            Show {Math.min(PAGE, rows.length - shown.length)} more ({rows.length - shown.length} hidden)
          </button>
        </div>
      ) : null}
    </div>
  );
}
