import { Link } from 'react-router-dom';
import type { LiveOverview } from '@/api/live';
import { textDirAttrs } from '@/lib/text';
import { Card, DataTable, EmptyState, SectionHeader, Text, TextLink, type Column } from '@/ui';
import { ChartTooltipHost, Mark } from '@/ui/Chart';
import { diagnosisSpec, mixSegments } from '../lib/mix';
import styles from '../live.module.css';

export function DiagnosisMix({
  overview,
  linkTo,
  period = 'today',
}: {
  overview: LiveOverview;
  linkTo: (filters?: Record<string, string>) => string;
  period?: string;
}) {
  const { day, specs } = overview;
  const segments = mixSegments(day.label_mix, diagnosisSpec(specs));
  const total = Object.values(day.label_mix).reduce((sum, count) => sum + count, 0);
  const waiting = day.row ? Math.max(0, day.in_qym - day.row.evaluated) : null;
  const columns: Column<(typeof segments)[number]>[] = [
    {
      id: 'label',
      header: 'Diagnosis',
      minWidth: 100,
      flex: true,
      cell: (segment) => (
        <span className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: segment.color }} aria-hidden="true" />
          <span className={styles.diagnosisLabel} {...textDirAttrs(segment.label)}>
            {segment.label}
          </span>
        </span>
      ),
    },
    { id: 'n', header: 'Turns', type: 'number', align: 'end', width: 60 },
    {
      id: 'share',
      header: 'Share',
      type: 'number',
      align: 'end',
      width: 60,
      cell: (segment) => `${(segment.share * 100).toFixed(0)}%`,
    },
    {
      id: 'view',
      header: 'View turns',
      width: 100,
      align: 'end',
      cell: (segment) => (
        <TextLink to={linkTo({ label: segment.value })} aria-label={`View turns for ${segment.label}`}>
          View turns
        </TextLink>
      ),
    },
  ];
  return (
    <Card
      data-live-block="mix"
      flush
      header={
        <SectionHeader
          title="Diagnosis mix"
          level="lg"
          as="h2"
          aside={
            <Text variant="sm" tone="muted">
              {total} turns with a diagnosis {period}
            </Text>
          }
        />
      }
    >
      {segments.length ? (
        <div className={styles.mixContent}>
          <ChartTooltipHost className={`${styles.mix} ${styles.mixPlot}`} data-live-block="mix-plot">
            {segments
              .filter((segment) => segment.n > 0)
              .map((segment) => (
                <Mark
                  key={segment.value}
                  tone={segment.tone}
                  data-dark={segment.dark ? '' : undefined}
                  className={styles.mixSegment}
                  style={{ flex: segment.share, background: segment.color }}
                  data-live-label={segment.value}
                  tabIndex={-1}
                  tip={`${segment.label}: ${segment.n} of ${total} turns`}
                >
                  <Link
                    className={styles.mixLink}
                    to={linkTo({ label: segment.value })}
                    aria-label={`${segment.label}: ${segment.n} turns`}
                  />
                </Mark>
              ))}
          </ChartTooltipHost>
          <DataTable
            aria-label="Diagnosis mix"
            variant="embedded"
            edgePadding="card"
            columns={columns}
            rows={segments}
            rowKey={(segment) => segment.value}
            rowProps={(segment) => ({ 'data-live-diagnosis': segment.value })}
            responsive="scroll"
          />
        </div>
      ) : (
        <EmptyState title="No diagnoses yet" body="Diagnoses appear as turns are received for this day." />
      )}
      {waiting !== null && waiting > 0 ? (
        <Text
          variant="sm"
          tone="muted"
          className={styles.received}
          data-live-block="ingest-gap"
          data-live-note={day.not_in_qym > 0 ? 'not-in-qym' : undefined}
        >
          {waiting} turns received but not evaluated yet
        </Text>
      ) : null}
    </Card>
  );
}
