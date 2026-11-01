import { Link } from 'react-router-dom';
import type { LiveFilters, LiveMetricSpec, LiveTurnRow, LiveTurnsPage } from '@/api/live';
import { useSearchParamsState } from '@/lib/url-state';
import { DataTable, EmptyState, ScoreValue, StatusMark, Tag, type Column, type SortState } from '@/ui';
import { listedScoreColumns } from '../lib/filters';
import { diagnosisSpec, mixSegments } from '../lib/mix';
import styles from '../turns.module.css';

interface TurnsTableProps {
  slug: string;
  source: string;
  filters: LiveFilters;
  data: LiveTurnsPage;
  specs: LiveMetricSpec[];
  refreshing?: boolean;
}

function scoreText(row: LiveTurnRow, spec: LiveMetricSpec): string {
  const score = row.scores[spec.metric_name];
  if (!score || score.skipped) return '—';
  const value = score.score_numeric;
  if (value === null) return score.label ?? '—';
  const digits = spec.precision ?? (spec.score_type === 'numeric' ? 2 : 0);
  if (spec.score_type === 'percentage') return `${(value * 100).toFixed(digits)}%`;
  if (spec.score_type === 'boolean') return value ? 'True' : 'False';
  return `${value.toFixed(digits)}${spec.unit ? ` ${spec.unit}` : ''}`;
}

export function TurnsTable({ slug, source, filters, data, specs, refreshing }: TurnsTableProps) {
  const { params, replaceUrlQuery } = useSearchParamsState();
  const path = `/projects/${encodeURIComponent(slug)}/live/turns`;
  const diagnosis = diagnosisSpec(specs);
  const labels = mixSegments(
    Object.fromEntries(data.rows.filter((row) => row.label).map((row) => [row.label!, 1])),
    diagnosis,
  );
  const labelFor = (value: string | null) => labels.find((label) => label.value === value);
  const sort = filters.sort ?? '-turn_at';
  const sortState: SortState = {
    key: sort.replace(/^-/, ''),
    direction: sort.startsWith('-') ? 'desc' : 'asc',
  };
  const columns: Column<LiveTurnRow>[] = [
    {
      id: 'turn_at',
      header: 'Time (UTC)',
      width: 88,
      pin: 'start',
      mono: true,
      sort: { key: 'turn_at', first: 'desc' },
      cell: (row) => <span title={row.turn_at}>{row.turn_at.slice(11, 16)}</span>,
    },
    {
      id: 'question',
      header: 'Question',
      width: 260,
      cell: (row) => (
        <span dir="auto" title={row.question} className={styles.question} data-live-question>
          {row.question}
        </span>
      ),
    },
    {
      id: 'mode',
      header: 'Mode',
      width: 90,
      cell: (row) =>
        row.mode ? (
          <Tag kind="data" dir="auto">
            {row.mode}
          </Tag>
        ) : (
          '—'
        ),
    },
    {
      id: 'label',
      header: 'Diagnosis',
      width: 200,
      cell: (row) => {
        const label = labelFor(row.label);
        const tone = label?.tone ?? 'neutral';
        return (
          <span
            className={styles.diagnosisCell}
            title={[label?.label ?? row.label, row.label_reason].filter(Boolean).join(' · ')}
          >
            <StatusMark
              tone="neutral"
              data-tone={tone}
              shape={tone === 'danger' ? 'cross' : tone === 'accent' || tone === 'success' ? 'check' : 'ring'}
              label={label?.label ?? row.label ?? '—'}
              dir="auto"
            />
            {row.label_reason ? (
              <span className={styles.reason} dir="auto" title={row.label_reason}>
                {row.label_reason}
              </span>
            ) : null}
          </span>
        );
      },
    },
    ...listedScoreColumns(specs).map((spec): Column<LiveTurnRow> => ({
      id: `metric:${spec.metric_name}`,
      header: spec.label,
      width: 108,
      align: 'end',
      mono: true,
      sort: { key: `metric:${spec.metric_name}`, first: 'desc' },
      cell: (row) =>
        spec.is_primary ? (
          <ScoreValue
            value={row.scores[spec.metric_name]?.skipped ? null : row.scores[spec.metric_name]?.score_numeric}
            direction={spec.direction}
            type={spec.score_type === 'percentage' ? 'score' : spec.score_type}
            text={scoreText(row, spec)}
            variant="plain"
          />
        ) : (
          <span className={styles.number}>{scoreText(row, spec)}</span>
        ),
    })),
    {
      id: 'latency_ms',
      header: 'Latency',
      width: 88,
      mono: true,
      sort: { key: 'latency_ms', first: 'desc' },
      cell: (row) => (
        <span data-live-latency={row.latency_ms ?? undefined}>
          {row.latency_ms === null ? '—' : `${Math.round(row.latency_ms / 1000)} s`}
        </span>
      ),
    },
    {
      id: 'charts',
      header: 'Charts',
      width: 100,
      cell: (row) => (
        <span className={styles.number}>
          {row.charts.count}
          {row.charts.failed ? (
            <span data-tone="danger" className={styles.toneText}>
              {' '}
              · {row.charts.failed} failed
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'services',
      header: 'Services not OK',
      width: 150,
      cell: (row) =>
        row.services_not_ok.length
          ? row.services_not_ok.map((service) => (
              <span
                key={service.name}
                className={styles.serviceFault}
                data-tone={
                  labelFor(service.fault)?.tone ??
                  labelFor(service.fault ? `${service.fault}_problem` : null)?.tone ??
                  'neutral'
                }
                dir="auto"
              >
                {service.name}
                {service.fault ? ` · ${service.fault}` : ''}
              </span>
            ))
          : '—',
    },
    {
      id: 'user',
      header: 'User · conversation',
      width: 180,
      cell: (row) => {
        const conversationQuery = new URLSearchParams(params);
        conversationQuery.set('source', source);
        conversationQuery.set('conversation', row.conversation_id ?? '');
        conversationQuery.delete('page');
        return (
          <span className={styles.diagnosisCell}>
            <span className={styles.number} dir="auto" title={row.user_ref ?? undefined}>
              {row.user_ref && row.user_ref.length > 16
                ? `${row.user_ref.slice(0, 8)}…${row.user_ref.slice(-4)}`
                : (row.user_ref ?? '—')}
            </span>
            {row.conversation_id ? (
              <Link
                className={styles.number}
                to={`${path}?${conversationQuery}`}
                title={row.conversation_id}
                dir="auto"
              >
                conversation {row.conversation_id.slice(-3)} · turn{' '}
                {row.turn_index === null ? '—' : row.turn_index + 1}
              </Link>
            ) : null}
          </span>
        );
      },
    },
  ];

  return (
    <div data-live-block="turns-table" className={styles.table}>
      <DataTable
        aria-label="Live turns"
        rows={data.rows}
        columns={columns}
        rowKey={(row) => row.turn_id}
        rowHref={(row) =>
          `${path}/${encodeURIComponent(row.turn_id)}?${new URLSearchParams({ source, list: params.toString() })}`
        }
        rowProps={(row) => ({ 'data-live-turn-row': row.turn_id })}
        sort={sortState}
        onSortChange={(next) =>
          replaceUrlQuery({
            sort: next ? `${next.direction === 'desc' ? '-' : ''}${next.key}` : null,
            page: null,
          })
        }
        refreshing={refreshing}
        responsive="scroll"
        fit="declared"
        minWidth={1600}
        empty={<EmptyState title="No turns match" body="Try removing a filter or changing the search." />}
      >
        <DataTable.Footer
          pagination={{
            total: data.total,
            page: filters.page ?? 1,
            pageSize: 50,
            noun: 'turns',
            onPageChange: (page) => replaceUrlQuery({ page: page === 1 ? null : page }),
          }}
        />
      </DataTable>
    </div>
  );
}
