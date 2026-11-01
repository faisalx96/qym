import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import { Card, HelpMarker, ScoreValue, Text } from '@/ui';
import styles from '../live.module.css';

/** One framed strip of equal cells (DESIGN_LANGUAGE stat tiles: seven or fewer in a row). */
export function serviceColumns(count: number): number {
  return Math.min(Math.max(count, 1), 7);
}

export function ServiceHealth({
  services,
  specs,
  linkTo,
  children,
}: {
  services: LiveOverview['day']['services'];
  specs: LiveMetricSpec[];
  linkTo: (filters?: Record<string, string>) => string;
  children?: ReactNode;
}) {
  return (
    <Card
      data-live-block="services"
      header={
        <div className={styles.inline}>
          <Text variant="md" weight={600}>
            Service health
          </Text>
          <HelpMarker label="service health">
            The OK rate is the share of non-skipped numeric service scores meeting the pass threshold for this
            day. Select a service to see turns where it was not OK.
          </HelpMarker>
        </div>
      }
    >
      <div
        className={styles.services}
        style={{ '--live-service-columns': serviceColumns(services.length) } as CSSProperties}
      >
        {services.map((service) => {
          // Overview rates carry metric names; the turns filter takes the bare service key.
          const name = service.name.replace(/^service\./, '');
          return (
            <Link
              key={service.name}
              data-live-service={name}
              to={linkTo({ service: name, service_status: 'not_ok' })}
              className={styles.service}
            >
              <ScoreValue value={service.ok_rate} direction="higher" variant="plain" />
              <span dir="auto">
                {specs.find((spec) => spec.metric_name === `service.${name}`)?.label ?? name}
              </span>
            </Link>
          );
        })}
      </div>
      {children}
    </Card>
  );
}
