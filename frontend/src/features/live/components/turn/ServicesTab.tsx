import type { LiveTurnDetail } from '@/api/live';
import { DataTable, EmptyState, KeyValueGrid, Text, type Column } from '@/ui';
import { servicesOf, toolsOf, type ToolCall, type ToolFailure } from '../../lib/summary';
import { EvidenceCard, Facts, MetricValue, ServiceStatus } from './Evidence';
import styles from '../../turn.module.css';

const failureColumns: Column<ToolFailure>[] = [
  { id: 'name', header: 'Tool', cell: (row) => <span dir="auto">{row.name ?? '—'}</span> },
  { id: 'step', header: 'Step', accessor: (row) => row.step ?? '—', mono: true },
  {
    id: 'error',
    header: 'Error',
    cell: (row) => (
      <span dir="auto" className={styles.tableText}>
        {row.error ?? '—'}
      </span>
    ),
  },
  { id: 'fault', header: 'Fault', cell: (row) => <span dir="auto">{row.fault ?? '—'}</span> },
];
const callColumns: Column<ToolCall>[] = [
  { id: 'name', header: 'Tool', cell: (row) => <span dir="auto">{row.name ?? '—'}</span> },
  { id: 'step', header: 'Step', accessor: (row) => row.step ?? '—', mono: true },
  {
    id: 'ok',
    header: 'Status',
    cell: (row) => <ServiceStatus status={row.ok === null ? null : row.ok ? 'ok' : 'failed'} />,
  },
];

export function ServicesTab({ data }: { data: LiveTurnDetail }) {
  const services = servicesOf(data.summary);
  const tools = toolsOf(data.summary);
  return (
    <>
      {services.length ? (
        <div className={styles.twoColumns}>
          {services.map((service) => (
            <EvidenceCard
              key={service.name}
              title={
                data.specs.find((spec) => spec.metric_name === `service.${service.name}`)?.label ??
                service.name
              }
            >
              <div className={styles.stack} data-live-turn-service={service.name}>
                <KeyValueGrid
                  columns={1}
                  items={[
                    { key: 'status', label: 'Status', value: <ServiceStatus status={service.status} /> },
                    {
                      key: 'score',
                      label: 'Score',
                      value: (
                        <MetricValue
                          value={service.score}
                          spec={data.specs.find((spec) => spec.metric_name === `service.${service.name}`)}
                        />
                      ),
                    },
                    { key: 'fault', label: 'Fault', value: <span dir="auto">{service.fault ?? '—'}</span> },
                  ]}
                />
                <Facts value={service.signals} label="Signals" />
              </div>
            </EvidenceCard>
          ))}
        </div>
      ) : (
        <EmptyState compact title="No services for this turn" />
      )}
      <EvidenceCard title="Tools">
        <div className={styles.stack}>
          <KeyValueGrid
            columns={2}
            items={[
              {
                key: 'calls',
                label: 'Calls',
                value: tools?.calls ?? data.turn.tool_calls ?? '—',
                mono: true,
              },
              { key: 'budget', label: 'Budget', value: tools?.budget ?? '—', mono: true },
            ]}
          />
          <DataTable
            aria-label="Tool failures"
            rows={(tools?.failures ?? []).map((row, id) => ({ ...row, id }))}
            columns={failureColumns}
            rowKey={(row) => row.id}
            responsive="scroll"
            minWidth={600}
            empty="No tool failures"
          />
          {tools?.list ? (
            <DataTable
              aria-label="Tool calls"
              rows={tools.list.map((row, id) => ({ ...row, id }))}
              columns={callColumns}
              rowKey={(row) => row.id}
              responsive="scroll"
              minWidth={400}
              empty="No tool calls recorded"
            />
          ) : (
            <Text tone="muted">Call list not available for this turn</Text>
          )}
        </div>
      </EvidenceCard>
    </>
  );
}
