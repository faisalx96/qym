import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import { Card, HelpMarker, Icon, ScoreValue, StatStrip, Text } from '@/ui';
import styles from '../live.module.css';

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
  const navigate = useNavigate();
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
      <StatStrip
        aria-label="Service health"
        items={services.map((service) => {
          // Overview rates carry metric names; the turns filter takes the bare service key.
          const name = service.name.replace(/^service\./, '');
          return {
            key: name,
            label: <span dir="auto">{specs.find((spec) => spec.metric_name === `service.${name}`)?.label ?? name}</span>,
            icon: <Icon name="shield" />,
            value: <ScoreValue value={service.ok_rate} direction="higher" variant="plain" />,
            onPress: () => void navigate(linkTo({ service: name, service_status: 'not_ok' })),
            data: { 'data-live-service': name },
          };
        })}
      />
      {children}
    </Card>
  );
}
