import { stringsOf } from '../../lib/evidenceValues';
import type { LiveTurnDetail } from '@/api/live';
import { Card, DataTable, EmptyState, FieldRow, StatusMark, Tag, Text, TextBlock, type Column } from '@/ui';
import { booleanOf, recordOf, servicesOf, stringOf, toolsOf, type ServiceEvidence } from '../../lib/summary';
import { faultLabel, matchToolFailures, serviceEvidence } from '../../lib/serviceEvidence';
import { Facts, MetricValue, TurnCardTitle } from './Evidence';
import { sentenceLabel, statusWord } from './presentation';
import styles from './ServicesTab.module.css';

function Status({ status }: { status: string | null }) {
  return (
    <StatusMark
      tone={
        status === 'failed'
          ? 'danger'
          : status === 'degraded'
            ? 'warning'
            : status === 'ok'
              ? 'success'
              : 'neutral'
      }
      shape={
        status === 'failed' ? 'cross' : status === 'ok' ? 'check' : status === 'skipped' ? 'pause' : 'dot'
      }
      label={status ? statusWord(status) : 'Unknown'}
    />
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
    <div className={styles.stack} role="group" aria-label="Tool envelope">
      <Text as="h3" variant="base" weight={600}>
        Tool envelope
      </Text>
      {intent ? (
        <FieldRow label="Intent" labelCase="sentence" labelAnchor="start" text={intent}>
          <TextBlock code={false} text={intent} />
        </FieldRow>
      ) : null}
      {router && router !== intent ? (
        <FieldRow label="Router" labelCase="sentence" labelAnchor="start" text={router}>
          <TextBlock code={false} text={router} />
        </FieldRow>
      ) : null}
      {matched !== null ? (
        <FieldRow label="Match" labelCase="sentence" labelAnchor="start">
          <StatusMark
            tone={matched ? 'success' : 'warning'}
            shape={matched ? 'check' : 'dot'}
            label={matched ? 'Matched' : 'Did not match'}
          />
        </FieldRow>
      ) : null}
      {(
        [
          ['Expected', expected, actual],
          ['Observed', actual, expected],
        ] as const
      ).map(([label, names, other]) => (
        <FieldRow key={label} label={label} labelCase="sentence" labelAnchor="start">
          <div className={styles.inline}>
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
              <Text>None</Text>
            )}
          </div>
        </FieldRow>
      ))}
    </div>
  );
}

export function ServicesTab({ data }: { data: LiveTurnDetail }) {
  const services = servicesOf(data.summary, data.specs);
  const tools = toolsOf(data.summary);
  const { calls, unmatched } = matchToolFailures(tools);
  const spec = (service: ServiceEvidence) =>
    data.specs.find((item) => item.metric_name === `service.${service.name}`);
  // Spec labels arrive as "Sql generation": the same acronym casing as the Live overview's Services table.
  const label = (service: ServiceEvidence) =>
    (spec(service)?.label ?? sentenceLabel(service.name)).replace(/\b(sql|api|url|id)\b/gi, (word) =>
      word.toUpperCase(),
    );
  const columns: Column<ServiceEvidence>[] = [
    {
      id: 'service',
      header: 'Service',
      width: 170,
      cell: (row) => <TextBlock text={label(row)} code={false} />,
    },
    { id: 'status', header: 'Status', width: 110, cell: (row) => <Status status={row.status} /> },
    ...(services.some((service) => service.score !== null)
      ? [
          {
            id: 'score',
            header: 'Score',
            width: 90,
            align: 'end' as const,
            cell: (row: ServiceEvidence) => <MetricValue value={row.score} spec={spec(row)} />,
          },
        ]
      : []),
    ...(services.some((service) => service.fault)
      ? [
          {
            id: 'fault',
            header: 'Fault of',
            width: 110,
            cell: (row: ServiceEvidence) => (row.fault ? <Tag>{faultLabel(row.fault)}</Tag> : null),
          },
        ]
      : []),
    {
      id: 'finding',
      header: 'Finding',
      minWidth: 220,
      flex: true,
      cell: (row) => (
        <TextBlock
          code={false}
          text={
            row.reason?.trim() ||
            serviceEvidence(row.signals) ||
            (row.signals && Object.keys(row.signals).length
              ? 'Recorded signals are available below.'
              : 'No finding was recorded.')
          }
        />
      ),
    },
  ];
  const count = tools?.calls ?? data.turn.tool_calls;
  const failures = calls.filter((call) => call.failure || call.ok === false).length + unmatched.length;
  const rows = calls.map((call, index) => ({ ...call, index }));
  const toolColumns: Column<(typeof rows)[number]>[] = [
    { id: 'number', header: '#', width: 40, minWidth: 40, mono: true, cell: (row) => row.index + 1 },
    {
      id: 'tool',
      header: 'Tool',
      minWidth: 180,
      flex: true,
      mono: true,
      cell: (row) => (
        <span className={styles.tool} dir="auto">
          {row.name ?? 'Unnamed tool'}
        </span>
      ),
    },
    { id: 'step', header: 'Step', width: 70, align: 'end', mono: true, cell: (row) => row.step ?? '—' },
    {
      id: 'status',
      header: 'Status',
      width: 110,
      cell: (row) => (
        <Status status={row.failure || row.ok === false ? 'failed' : row.ok === true ? 'ok' : null} />
      ),
    },
    {
      id: 'result',
      header: 'Result',
      minWidth: 200,
      flex: true,
      cell: (row) =>
        row.failure?.error ? (
          <TextBlock code={false} className={styles.error} text={row.failure.error} />
        ) : row.failure || row.ok === false ? (
          <EmptyState compact title="No error message recorded" />
        ) : null,
    },
  ];
  return (
    <div className={styles.stack}>
      <Card
        flush
        data-live-card="services"
        header={
          <TurnCardTitle
            as="h2"
            title="Services"
            description="Expand a row to see what the finding is based on."
          />
        }
      >
        {services.length ? (
          <DataTable
            aria-label="Services"
            rows={services}
            columns={columns}
            rowKey={(row) => row.name}
            fit="declared"
            variant="embedded"
            density="comfortable"
            densityLocked
            responsive="scroll"
            stickyHeader={false}
            rowProps={(row) => ({ 'data-live-turn-service': row.name })}
            canExpand={(row) => !!row.signals && Object.keys(row.signals).length > 0}
            renderExpanded={(row) => (
              <div className={styles.signals}>
                <Facts value={row.signals} label="Signals" signals />
              </div>
            )}
          />
        ) : (
          <EmptyState compact title="No services for this turn" />
        )}
      </Card>
      <Card
        flush
        data-live-card="tools"
        header={
          <TurnCardTitle
            as="h2"
            title="Tool calls"
            aside={
              count !== null ? (
                tools ? (
                  <StatusMark
                    tone={failures ? 'danger' : 'success'}
                    shape={failures ? 'cross' : 'check'}
                    label={`${failures} of ${count} calls failed`}
                  />
                ) : (
                  <Text>{count} calls</Text>
                )
              ) : undefined
            }
          />
        }
        footer={
          tools?.budget != null || recordOf(data.summary.envelope) ? (
            <div className={styles.stack}>
              {tools?.budget != null ? (
                <FieldRow label="Call budget" labelCase="sentence" labelAnchor="start">
                  <Text mono>{tools.budget}</Text>
                </FieldRow>
              ) : null}
              <ToolEnvelope summary={data.summary} />
            </div>
          ) : undefined
        }
      >
        {tools?.list ? (
          calls.length ? (
            <DataTable
              aria-label="Tool calls"
              rows={rows}
              columns={toolColumns}
              rowKey={(row) => String(row.index)}
              fit="declared"
              variant="embedded"
              density="comfortable"
              densityLocked
              responsive="scroll"
              stickyHeader={false}
              canExpand={(row) => !!row.failure?.fault}
              renderExpanded={(row) => (
                <div className={styles.signals}>
                  <FieldRow label="Fault of" labelCase="sentence" labelAnchor="start">
                    <Tag>{faultLabel(row.failure!.fault!)}</Tag>
                  </FieldRow>
                </div>
              )}
            />
          ) : (
            <EmptyState compact title="No tool calls recorded" />
          )
        ) : (
          <EmptyState compact title="Call list not available for this turn" />
        )}
        {unmatched.length ? (
          <div className={styles.unmatched} aria-label="Tool failures">
            <Text as="h3" variant="base" weight={600}>
              Failures without a matching call
            </Text>
            {unmatched.map((failure, index) => (
              <FieldRow
                key={index}
                label={failure.name ?? 'Unnamed tool'}
                labelCase="sentence"
                labelAnchor="start"
                text={failure.error}
              >
                <div className={styles.stack}>
                  {failure.fault ? <Tag>{faultLabel(failure.fault)}</Tag> : null}
                  {failure.error ? (
                    <TextBlock className={styles.error} code={false} text={failure.error} />
                  ) : (
                    <EmptyState compact title="No error message recorded" />
                  )}
                </div>
              </FieldRow>
            ))}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
