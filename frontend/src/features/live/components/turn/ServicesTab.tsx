import type { CSSProperties } from 'react';
import { stringsOf } from '../../lib/evidenceValues';
import type { LiveTurnDetail } from '@/api/live';
import {
  ClampedText,
  DataTable,
  EmptyState,
  InlineNotice,
  StateTag,
  Subsection,
  Tag,
  Text,
  type Column,
} from '@/ui';
import {
  booleanOf,
  recordOf,
  servicesOf,
  stringOf,
  toolsOf,
  type ServiceEvidence,
  type ToolFailure,
} from '../../lib/summary';
import { faultLabel, matchToolFailures, serviceEvidence } from '../../lib/serviceEvidence';
import { Facts, MetricValue, ServiceStatus } from './Evidence';
import styles from './ServicesTab.module.css';

function Fault({ value }: { value: string | null }) {
  return value ? (
    <Tag className={styles.fault}>{value === 'policy' ? 'privacy guard' : value}</Tag>
  ) : (
    <Text tone="muted">—</Text>
  );
}

function Sentence({ text }: { text: string }) {
  return (
    <span dir="auto" className={styles.sentence}>
      {text.split(/(\b\d+(?:\.\d+)?\b)/).map((part, index) =>
        /^\d/.test(part) ? (
          <span key={index} className={styles.mono}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </span>
  );
}

function Failure({ failure }: { failure: ToolFailure }) {
  return (
    <div className={styles.failure}>
      <Fault value={failure.fault} />
      {failure.error ? (
        <ClampedText text={failure.error} lines={3} code={false} />
      ) : (
        <EmptyState compact title="No error message recorded" />
      )}
    </div>
  );
}

function ToolEnvelope({ summary }: { summary: Record<string, unknown> }) {
  const envelope = recordOf(summary.envelope);
  if (!envelope) return null;
  const expected = stringsOf(envelope.expected_tools);
  const actual = stringsOf(envelope.actual_tools);
  const intent = stringOf(envelope.intent);
  const router = stringOf(recordOf(summary.router)?.intent);
  const matched = booleanOf(envelope.matched);
  return (
    <Subsection title="Tool envelope" className={styles.stack}>
      {intent || router ? (
        <Text>
          Intent: {intent ?? router}
          {router && router !== intent && intent ? ` · Router: ${router}` : ''}
        </Text>
      ) : null}
      {matched !== null ? (
        <StateTag tone={matched ? 'success' : 'warning'}>{matched ? 'Matched' : 'Did not match'}</StateTag>
      ) : null}
      {(
        [
          ['Expected', expected, actual],
          ['Observed', actual, expected],
        ] as const
      ).map(([label, names, other]) => (
        <div key={label} className={styles.inline}>
          <Text weight={600}>{label}</Text>
          {names.length ? (
            names.map((name, index) => (
              <span key={`${name}-${index}`} className={styles.inline}>
                <Tag kind="data" dir="auto">
                  {name}
                </Tag>
                {!other.includes(name) ? (
                  <Text tone="muted">{label === 'Expected' ? 'expected, not called' : 'not expected'}</Text>
                ) : null}
              </span>
            ))
          ) : (
            <Text tone="muted">None</Text>
          )}
        </div>
      ))}
    </Subsection>
  );
}

export function ServicesTab({ data }: { data: LiveTurnDetail }) {
  const services = servicesOf(data.summary, data.specs);
  const tools = toolsOf(data.summary);
  const { calls, unmatched } = matchToolFailures(tools);
  const spec = (service: ServiceEvidence) =>
    data.specs.find((item) => item.metric_name === `service.${service.name}`);
  const label = (service: ServiceEvidence) => spec(service)?.label ?? service.name;
  const worst = services[0]?.status;
  const problems = services.filter((service) => service.status === worst);
  const columns: Column<ServiceEvidence>[] = [
    {
      id: 'service',
      header: 'Service',
      cell: (row) => (
        <span dir="auto" className={styles.sentence}>
          {label(row)}
        </span>
      ),
    },
    { id: 'status', header: 'Status', cell: (row) => <ServiceStatus status={row.status} /> },
    { id: 'score', header: 'Score', cell: (row) => <MetricValue value={row.score} spec={spec(row)} /> },
    { id: 'fault', header: 'Fault', cell: (row) => <Fault value={row.fault} /> },
    {
      id: 'why',
      header: 'Why',
      minWidth: 190,
      flex: true,
      cell: (row) => (
        <Text
          as="p"
          tone={row.status === 'skipped' ? 'muted' : 'secondary'}
          className={styles.sentence}
          dir="auto"
        >
          {row.reason ?? '—'}
        </Text>
      ),
    },
    {
      id: 'evidence',
      header: 'Evidence',
      minWidth: 220,
      flex: true,
      cell: (row) => {
        const sentence = serviceEvidence(row.signals);
        return sentence ? (
          <Sentence text={sentence} />
        ) : (
          <Text tone="muted">
            {row.signals && Object.keys(row.signals).length ? 'Expand for signals' : '—'}
          </Text>
        );
      },
    },
  ];
  const count = tools?.calls ?? data.turn.tool_calls;
  const failures = calls.filter((call) => call.failure || call.ok === false).length + unmatched.length;
  return (
    <div className={styles.stack}>
      {worst === 'failed' || worst === 'degraded' ? (
        <InlineNotice
          tone={worst === 'failed' ? 'danger' : 'warning'}
          lead={worst === 'failed' ? 'Failed:' : 'Degraded:'}
        >
          {problems
            .map(
              (service) =>
                `${label(service)}${service.fault ? ` (${faultLabel(service.fault)})` : ''}${service.reason ? `. ${service.reason}` : ''}`,
            )
            .join('; ')}
        </InlineNotice>
      ) : null}
      {services.length ? (
        <>
          <div
            role="list"
            aria-label="Service glance"
            className={styles.strip}
            style={{ '--service-count': services.length } as CSSProperties}
          >
            {services.map((service) => (
              <div role="listitem" key={service.name} className={styles.cell}>
                <ServiceStatus status={service.status} />
                <Text weight={600} dir="auto">
                  {label(service)}
                </Text>
                <MetricValue value={service.score} spec={spec(service)} />
              </div>
            ))}
          </div>
          <DataTable
            aria-label="Services"
            rows={services}
            columns={columns}
            rowKey={(row) => row.name}
            density="compact"
            densityLocked
            responsive="scroll"
            rowProps={(row) => ({ 'data-live-turn-service': row.name })}
            canExpand={(row) => !!row.signals && Object.keys(row.signals).length > 0}
            renderExpanded={(row) => <Facts value={row.signals} label="Signals" />}
          />
        </>
      ) : (
        <EmptyState compact title="No services for this turn" />
      )}
      <Subsection
        title="Tools"
        aside={
          count !== null ? (
            <Text>{tools ? `${failures} of ${count} calls failed` : `${count} calls`}</Text>
          ) : undefined
        }
      >
        {tools?.budget !== null && tools?.budget !== undefined ? (
          <Text tone="muted">
            Call budget: <span className={styles.mono}>{tools.budget}</span>
          </Text>
        ) : null}
        {tools?.list ? (
          calls.length ? (
            <ol className={styles.calls} aria-label="Tool calls">
              {calls.map((call, index) => (
                <li key={index}>
                  <div className={styles.inline}>
                    <span className={styles.mono}>{call.step ?? index + 1}</span>
                    <span className={styles.mono} dir="auto">
                      {call.name ?? 'Unnamed tool'}
                    </span>
                    <ServiceStatus
                      status={call.failure || call.ok === false ? 'failed' : call.ok === true ? 'ok' : null}
                    />
                  </div>
                  {call.failure ? <Failure failure={call.failure} /> : null}
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState compact title="No tool calls recorded" />
          )
        ) : (
          <Text tone="muted">Call list not available for this turn</Text>
        )}
        {unmatched.length ? (
          <div className={styles.stack} aria-label="Tool failures">
            {unmatched.map((failure, index) => (
              <div key={index}>
                <Text mono>{failure.name ?? 'Unnamed tool'}</Text>
                <Failure failure={failure} />
              </div>
            ))}
          </div>
        ) : null}
      </Subsection>
      <ToolEnvelope summary={data.summary} />
    </div>
  );
}
