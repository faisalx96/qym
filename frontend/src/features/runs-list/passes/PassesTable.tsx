/** The pass rows: an embedded DataTable that mirrors the parent's visible metric columns. */
import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { MetricType, RunPass, RunRow } from '@/api/dashboardTypes';
import { DataTable, RunStatusBadge, ScoreBar, type Column, type RowAction } from '@/ui';
import { formatDateParts, formatDurationMs, formatLatency, formatNumericValue } from '@/lib/format';
import { metricDirection } from '@/lib/metrics';
import { AnalyzeAction } from '../AnalyzeAction';
import { Mono } from '../cells';
import { passRef } from '../selection';
import { passIssues, type PassIssue, type PassView } from './model';
import styles from './PassesTable.module.css';

export interface PassRow {
  /** Selection / row key: the pass ref (`run::passN`). */
  ref: string;
  pass: RunPass;
  /** Lifecycle status shown (a stale `running` pass shows the run's terminal status). */
  status: string;
}

export const toPassRows = (runId: string, rows: PassView[]): PassRow[] =>
  rows.map((r) => ({ ref: passRef(runId, r.pass.pass_number), pass: r.pass, status: r.status }));

const headerLabel = (m: string) => m.replace(/_/g, ' ');

export function IssuesCell({ issues }: { issues: PassIssue[] }) {
  if (!issues.length) return <span className={styles.none}>–</span>;
  return (
    <span className={styles.issues}>
      {issues.map((i) => (
        <span
          key={i.kind}
          className={styles.issue}
          data-tone={i.tone}
          title={i.text}
          role="img"
          aria-label={i.text}
        >
          <span aria-hidden="true">{i.glyph}</span>
          <Mono>{i.count}</Mono>
        </span>
      ))}
    </span>
  );
}

export function PassesTable({
  name,
  rows,
  metrics,
  specs,
  metricTypes,
  selectedMetric,
  passHref,
  analyzing,
  selectMode,
  selected,
  onToggle,
  canDelete,
  onOpen,
  onDelete,
}: {
  name: string;
  rows: PassRow[];
  metrics: string[];
  specs: RunRow['metric_specs'];
  metricTypes: Record<string, MetricType>;
  selectedMetric: string | null;
  passHref: (n: number, sub?: string) => string;
  /** An analysis is running for this run. */
  analyzing: boolean;
  selectMode: boolean;
  selected: Set<string>;
  onToggle: (ref: string) => void;
  canDelete: boolean;
  onOpen: (n: number) => void;
  onDelete: (n: number) => void;
}) {
  const columns = useMemo<Column<PassRow>[]>(() => {
    const spec = (m: string) => specs?.[m];
    const metricCols: Column<PassRow>[] = metrics.map((m) => ({
      id: `metric-${m}`,
      header: headerLabel(m),
      label: headerLabel(m),
      type: 'score',
      width: 128,
      align: 'end',
      priority: m === selectedMetric ? 1 : 3,
      cell: (r) =>
        metricTypes[m] === 'numeric' ? (
          <Mono>{formatNumericValue(r.pass.metric_means[m], 2)}</Mono>
        ) : (
          <ScoreBar
            value={r.pass.metric_means[m]}
            type={metricTypes[m]}
            direction={metricDirection(spec(m))}
            error={null}
          />
        ),
    }));
    return [
      {
        id: 'pass',
        pin: 'start',
        header: '#',
        label: 'Pass',
        width: 64,
        priority: 1,
        cardTitle: true,
        cell: (r) => (
          <Link
            to={passHref(r.pass.pass_number)}
            className={styles.passLink}
            aria-label={`Open pass ${r.pass.pass_number}`}
          >
            #{r.pass.pass_number}
          </Link>
        ),
      },
      {
        id: 'status',
        pin: 'start',
        header: 'Status',
        width: 132,
        priority: 1,
        cell: (r) => {
          const p = r.pass;
          const progress =
            r.status === 'running' && p.items_total > 0
              ? `${Math.round((p.completed_count / p.items_total) * 100)}% · ${p.completed_count}/${p.items_total}`
              : '';
          return (
            <span className={styles.status}>
              <RunStatusBadge status={r.status.toUpperCase() as 'COMPLETED'} />
              {progress ? <Mono>{progress}</Mono> : null}
            </span>
          );
        },
      },
      {
        id: 'date',
        header: 'Date',
        width: 132,
        priority: 2,
        cell: (r) => {
          const date = r.pass.started_at ? formatDateParts(r.pass.started_at) : null;
          return date ? (
            <time className={styles.mono} dateTime={r.pass.started_at ?? undefined} title={date.full}>
              {date.date} · {date.time}
            </time>
          ) : (
            <span className={styles.none}>—</span>
          );
        },
      },
      ...metricCols,
      {
        id: 'items',
        header: 'Items',
        type: 'number',
        width: 80,
        align: 'end',
        priority: 3,
        cell: (r) => (
          <Mono>
            {r.pass.items_scored}/{r.pass.items_total}
          </Mono>
        ),
      },
      {
        id: 'latency',
        header: 'Latency',
        type: 'number',
        width: 90,
        align: 'end',
        priority: 3,
        cell: (r) => <Mono>{formatLatency(r.pass.avg_latency_ms)}</Mono>,
      },
      {
        id: 'duration',
        header: 'Duration',
        type: 'duration',
        width: 110,
        align: 'end',
        priority: 3,
        cell: (r) => <Mono>{formatDurationMs(r.pass.duration_ms)}</Mono>,
      },
      {
        id: 'issues',
        header: 'Issues',
        width: 120,
        priority: 1,
        cell: (r) => <IssuesCell issues={passIssues(r.pass)} />,
      },
      {
        id: 'analyze',
        header: 'Analyze',
        width: 118,
        priority: 2,
        cell: (r) => {
          if (r.status === 'running' || r.status === 'pending') return <span className={styles.none}>—</span>;
          return (
            <AnalyzeAction
              to={passHref(r.pass.pass_number, '/analyzer')}
              causeCount={r.pass.analysis_cause_count ?? 0}
              analyzing={analyzing}
              subject={`pass ${r.pass.pass_number}`}
            />
          );
        },
      },
    ];
  }, [metrics, specs, metricTypes, selectedMetric, passHref, analyzing]);

  const rowActions = (r: PassRow): RowAction<PassRow>[] => [
    {
      id: 'open',
      label: `Open pass ${r.pass.pass_number}`,
      icon: 'external',
      onPress: () => onOpen(r.pass.pass_number),
    },
    ...(canDelete
      ? [
          {
            id: 'delete',
            label: `Delete pass ${r.pass.pass_number}`,
            icon: 'trash',
            danger: true,
            onPress: () => onDelete(r.pass.pass_number),
          } as RowAction<PassRow>,
        ]
      : []),
  ];

  return (
    <DataTable<PassRow>
      aria-label={`${name} passes`}
      variant="embedded"
      columnMenu={false}
      density="compact"
      columns={columns}
      rows={rows}
      rowKey={(r) => r.ref}
      rowActions={rowActions}
      rowProps={(r) => ({ 'data-pass-row': String(r.pass.pass_number) })}
      onRowOpen={(r) => onOpen(r.pass.pass_number)}
      rowLabel={(r) => `Select pass ${r.pass.pass_number} of ${name}`}
      selectAllLabel={`Select all passes of ${name}`}
      selection={
        selectMode
          ? {
              selected,
              onChange: (next) => {
                for (const r of rows) if (next.has(r.ref) !== selected.has(r.ref)) onToggle(r.ref);
              },
            }
          : undefined
      }
      empty="No pass results are available yet."
    />
  );
}
