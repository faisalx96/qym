import type { LiveMetricSpec, LiveOverview } from '@/api/live';
import { formatDuration } from '@/lib/format';
import { humanizeKey } from '@/lib/humanizeKey';
import { formatPercent, metricBand } from '@/lib/metrics';
import { textDirAttrs } from '@/lib/text';
import { Card, DataTable, HelpMarker, ScoreValue, SectionHeader, Text, TextLink, type Column } from '@/ui';
import { CanaryStatus } from './Canaries';
import styles from '../live.module.css';

export function ServiceHealth({
  services,
  canaries = [],
  specs,
  linkTo,
  period = 'today',
}: {
  services: LiveOverview['day']['services'];
  canaries?: LiveOverview['canaries'];
  specs: LiveMetricSpec[];
  linkTo: (filters?: Record<string, string>) => string;
  period?: string;
}) {
  // Overview rates carry metric names; turns filters and canaries use the bare key.
  const serviceByName = new Map(services.map((service) => [service.name.replace(/^service\./, ''), service]));
  const names = new Set([...serviceByName.keys(), ...canaries.map((probe) => probe.canary)]);
  const rows = [...names].map((name) => {
    const spec = specs.find((item) => item.metric_name === `service.${name}`);
    const label = (spec?.label ?? humanizeKey(name)).replace(/\b(sql|api|id|url)\b/gi, (word) =>
      word.toUpperCase(),
    );
    return {
      name,
      label,
      ok_rate: serviceByName.get(name)?.ok_rate ?? null,
      probe: canaries.find((probe) => probe.canary === name),
    };
  });
  const columns: Column<(typeof rows)[number]>[] = [
    {
      id: 'label',
      header: 'Service',
      flex: true,
      minWidth: 160,
      cell: (row) => (
        <span className={styles.metricLabel} {...textDirAttrs(row.label)}>
          {row.label}
        </span>
      ),
    },
    {
      id: 'meter',
      header: `Health ${period}`,
      flex: true,
      minWidth: 120,
      cell: (row) =>
        row.ok_rate === null ? null : (
          <span
            className={styles.metricMeter}
            aria-hidden="true"
            data-band={metricBand(row.ok_rate, 'percentage', 'maximize') ?? undefined}
          >
            <span style={{ inlineSize: `${Math.min(1, Math.max(0, row.ok_rate)) * 100}%` }} />
          </span>
        ),
    },
    {
      id: 'health',
      header: 'Health',
      width: 100,
      align: 'end',
      cell: (row) =>
        row.ok_rate === null ? (
          <ScoreValue value={null} direction="higher" variant="plain" />
        ) : (
          <TextLink
            arrow={false}
            to={linkTo({ service: row.name, service_status: 'not_ok' })}
            aria-label={`${formatPercent(row.ok_rate)}: ${row.label}: view turns where the service was not OK`}
          >
            <ScoreValue value={row.ok_rate} direction="higher" variant="plain" />
          </TextLink>
        ),
    },
    { id: 'canary', header: 'Canary', width: 130, cell: (row) => <CanaryStatus probe={row.probe} /> },
    {
      id: 'latency',
      header: 'Canary time',
      width: 110,
      align: 'end',
      cell: (row) => (
        <span className={styles.number}>
          {row.probe?.status !== 'skipped' && row.probe?.latency_ms != null
            ? formatDuration(row.probe.latency_ms)
            : '—'}
        </span>
      ),
    },
  ];
  return (
    <Card
      data-live-block="services"
      flush
      header={
        <SectionHeader
          level="lg"
          as="h2"
          title={
            <span className={styles.inline}>
              Services
              <HelpMarker label="service health">
                The OK rate is the share of non-skipped numeric service scores meeting the pass threshold for
                this day. Select a service to see turns where it was not OK.
              </HelpMarker>
            </span>
          }
          aside={
            <Text variant="sm" tone="muted">
              Health is the share of {period === 'today' ? "today's" : "that day's"} turns where the service
              was OK
            </Text>
          }
        />
      }
    >
      <DataTable
        aria-label="Services"
        variant="embedded"
        edgePadding="card"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.name}
        rowProps={(row) => ({ 'data-live-service': row.name })}
        responsive="scroll"
      />
    </Card>
  );
}
