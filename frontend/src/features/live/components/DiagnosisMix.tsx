import { Link } from 'react-router-dom';
import type { LiveOverview } from '@/api/live';
import { Card, EmptyState, Text } from '@/ui';
import { ChartTooltipHost, Mark } from '@/ui/Chart';
import { diagnosisSpec, mixSegments } from '../lib/mix';
import styles from '../live.module.css';

export function DiagnosisMix({
  overview,
  linkTo,
}: {
  overview: LiveOverview;
  linkTo: (filters?: Record<string, string>) => string;
}) {
  const { day, specs } = overview;
  const segments = mixSegments(day.label_mix, diagnosisSpec(specs));
  const total = Object.values(day.label_mix).reduce((sum, count) => sum + count, 0);
  return (
    <Card
      data-live-block="mix"
      header={
        <Text variant="md" weight={600}>
          Diagnosis mix
        </Text>
      }
    >
      {segments.length ? (
        <>
          <ChartTooltipHost className={styles.mix} data-live-block="mix-plot">
            {segments
              .filter((segment) => segment.n > 0)
              .map((segment) => (
                <Mark
                  key={segment.value}
                  tone={segment.tone}
                  data-dark={segment.dark ? '' : undefined}
                  className={styles.mixSegment}
                  style={{ flex: segment.share }}
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
          <div className={styles.mixLegend}>
            {segments.map((segment) => (
              <Link
                key={segment.value}
                to={linkTo({ label: segment.value })}
                className={styles.legendItem}
                data-tone={segment.tone}
                data-dark={segment.dark ? '' : undefined}
              >
                <span className={styles.swatch} aria-hidden="true" />
                <span dir="auto">{segment.label}</span>
                <strong className={styles.number}>{segment.n}</strong>
              </Link>
            ))}
          </div>
        </>
      ) : (
        <EmptyState title="No diagnoses yet" body="Diagnoses appear as turns are received for this day." />
      )}
      <Text
        variant="sm"
        tone="muted"
        className={styles.received}
        data-live-block="ingest-gap"
        data-live-note={day.not_in_qym > 0 ? 'not-in-qym' : undefined}
      >
        {day.not_in_qym > 0
          ? `${day.not_in_qym} turns not yet in qym`
          : `All ${day.in_qym} turns received in qym${day.row?.incomplete ? ` · ${day.row.incomplete} awaiting complete evaluation` : ''}`}
      </Text>
    </Card>
  );
}
