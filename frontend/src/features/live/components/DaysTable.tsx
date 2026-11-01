import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import { useSearchParamsState } from '@/lib/url-state';
import { DataTable, ScoreValue, StatusMark, Text, type Column } from '@/ui';
import { ChartTooltipHost, Mark } from '@/ui/Chart';
import { diagnosisSpec, mixSegments } from '../lib/mix';
import { formatPrimaryMean } from '../lib/trend';
import styles from '../live.module.css';

export function DaysTable({
  days,
  slug,
  source,
  specs,
  primaryMetric,
}: {
  days: LiveOverview['days'];
  slug: string;
  source: string;
  specs: LiveMetricSpec[];
  primaryMetric: string | null;
}) {
  const { replaceUrlQuery } = useSearchParamsState();
  const primary =
    specs.find((spec) => spec.is_primary) ?? specs.find((spec) => spec.metric_name === primaryMetric);
  const diagnosis = diagnosisSpec(specs);
  const columns: Column<LiveOverview['days']['rows'][number]>[] = [
    { id: 'day', header: 'Day (UTC)', width: 130, mono: true },
    { id: 'turns_seen', header: 'Turns', width: 75, type: 'number' },
    { id: 'evaluated', header: 'Evaluated', width: 90, type: 'number' },
    { id: 'failed', header: 'Failed', width: 75, type: 'number' },
    {
      id: 'primary_rate',
      header: primary?.label ?? 'Primary rate',
      width: 120,
      cell: (row) => (
        <ScoreValue
          value={row.primary_rate}
          type={primary?.score_type === 'duration' ? 'numeric' : primary?.score_type}
          direction={primary?.direction}
          text={formatPrimaryMean(row.primary_rate, primary)}
          variant="plain"
        />
      ),
    },
    {
      id: 'mix',
      header: 'Diagnosis mix',
      minWidth: 180,
      flex: true,
      cell: (row) => {
        const segments = mixSegments(row.label_mix, diagnosis).filter((segment) => segment.n > 0);
        if (!segments.length) return '—';
        return (
          <ChartTooltipHost className={styles.mix}>
            {segments.map((segment) => (
              <Mark
                key={segment.value}
                className={styles.mixSegment}
                tone={segment.tone}
                style={{ flex: segment.share }}
                tip={`${segment.label}: ${segment.n} turns`}
                aria-label={`${segment.label}: ${segment.n} turns`}
              />
            ))}
          </ChartTooltipHost>
        );
      },
    },
    {
      id: 'worker',
      header: 'Worker',
      width: 110,
      cell: (row) => (
        <StatusMark
          tone={row.worker_gap ? 'warning' : row.status === 'running' ? 'success' : 'neutral'}
          shape={row.worker_gap ? 'hourglass' : row.status === 'running' ? 'orbit' : 'full'}
          label={row.worker_gap ? 'Gap' : row.status}
          title={row.worker_gap ? `Worker gap: ${row.max_poll_gap_s} s between heartbeats` : undefined}
        />
      ),
    },
  ];
  return (
    <div data-live-block="days">
      <DataTable
        aria-label="Days"
        columns={columns}
        rows={days.rows}
        rowKey={(row) => row.day}
        rowHref={(row) =>
          `/projects/${encodeURIComponent(slug)}/live/turns?${new URLSearchParams({ day: row.day, source })}`
        }
        rowProps={(row) => ({ 'data-live-day': row.day })}
        responsive="scroll"
        minWidth={850}
      >
        <DataTable.Toolbar
          count={
            <Text variant="md" weight={600}>
              Days
            </Text>
          }
        />
        <DataTable.Footer
          pagination={{
            total: days.total,
            page: days.page,
            pageSize: days.page_size,
            noun: 'days',
            onPageChange: (page) => replaceUrlQuery({ days_page: page }),
          }}
        />
      </DataTable>
    </div>
  );
}
