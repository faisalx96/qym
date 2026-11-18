import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import { formatDayKey } from '@/lib/dates';
import { useSearchParamsState } from '@/lib/url-state';
import { humanizeKey } from '@/lib/humanizeKey';
import { Card, DataTable, ScoreValue, SectionHeader, StateTag, Text, type Column } from '@/ui';
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
  stale = false,
}: {
  zone?: string;
  days: LiveOverview['days'];
  slug: string;
  source: string;
  specs: LiveMetricSpec[];
  primaryMetric: string | null;
  /** The source has no recent heartbeat: its open day is stale, not running. */
  stale?: boolean;
}) {
  const { replaceUrlQuery } = useSearchParamsState();
  const primary =
    specs.find((spec) => spec.is_primary) ?? specs.find((spec) => spec.metric_name === primaryMetric);
  const diagnosis = diagnosisSpec(specs);
  const columns: Column<LiveOverview['days']['rows'][number]>[] = [
    { id: 'day', header: 'Day', width: 130, cell: (row) => formatDayKey(row.day) },
    { id: 'turns_seen', header: 'Turns', width: 75, type: 'number', align: 'end' },
    { id: 'evaluated', header: 'Evaluated', width: 90, type: 'number', align: 'end' },
    {
      id: 'waiting',
      header: 'Waiting',
      width: 85,
      type: 'number',
      align: 'end',
      cell: (row) => Math.max(0, row.in_qym - row.evaluated),
    },
    {
      id: 'primary_rate',
      header: primary?.label ?? 'Primary rate',
      width: 120,
      align: 'end',
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
          <ChartTooltipHost className={`${styles.mix} ${styles.compactMix}`}>
            {segments.map((segment) => (
              <Mark
                key={segment.value}
                className={styles.mixSegment}
                tone={segment.tone}
                data-dark={segment.dark ? '' : undefined}
                style={{ flex: segment.share, background: segment.color }}
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
      align: 'end',
      cell: (row) => {
        if (row.worker_gap) {
          return (
            <StateTag tone="warning" title={`Worker gap: ${row.max_poll_gap_s}s between heartbeats`}>
              Gap
            </StateTag>
          );
        }
        if (row.status === 'running' && stale) {
          return (
            <StateTag tone="danger" title="Open day, worker not heard from">
              Stale
            </StateTag>
          );
        }
        return (
          <StateTag
            tone={row.status === 'running' ? 'info' : row.status === 'closed' ? 'success' : 'neutral'}
          >
            {humanizeKey(row.status)}
          </StateTag>
        );
      },
    },
  ];
  return (
    <Card
      data-live-block="days"
      flush
      header={
        <SectionHeader
          title="Days"
          level="lg"
          as="h2"
          aside={
            <Text variant="sm" tone="muted">
              Click a day to see its turns
            </Text>
          }
        />
      }
    >
      <DataTable
        aria-label="Days"
        variant="embedded"
        edgePadding="card"
        densityLocked
        columns={columns}
        rows={days.rows}
        rowKey={(row) => row.day}
        rowHref={(row) =>
          `/projects/${encodeURIComponent(slug)}/live/turns?${new URLSearchParams({ day: row.day, source })}`
        }
        rowProps={(row) => ({ 'data-live-day': row.day })}
        responsive="scroll"
        fit="declared"
        minWidth={850}
      >
        <DataTable.Footer
          layout="spread"
          pagination={{
            total: days.total,
            page: days.page,
            pageSize: days.page_size,
            noun: 'days',
            onPageChange: (page) => replaceUrlQuery({ days_page: page }),
          }}
        />
      </DataTable>
    </Card>
  );
}
