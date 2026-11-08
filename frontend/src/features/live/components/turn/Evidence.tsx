import type { ReactNode } from 'react';
import type { LiveMetricSpec } from '@/api/live';
import {
  Card,
  CopyButton,
  KeyValueGrid,
  ScoreValue,
  StatusMark,
  StructuredValue,
  Text,
  TextBlock,
} from '@/ui';
import type { SqlPart } from '../../lib/summary';
import { labelFor, scoreText } from './presentation';
import styles from '../../turn.module.css';

export function EvidenceCard({
  title,
  block,
  children,
}: {
  title: string;
  block?: string;
  children: ReactNode;
}) {
  return (
    <Card
      data-live-block={block}
      data-live-card={block}
      header={
        <Text as="h2" variant="md" weight={600} dir="auto">
          {title}
        </Text>
      }
    >
      {children}
    </Card>
  );
}

export function DiagnosisLabel({ value, specs }: { value: string | null; specs: LiveMetricSpec[] }) {
  const label = labelFor(value, specs);
  return (
    <StatusMark
      tone="neutral"
      data-tone={label.tone}
      shape={
        label.tone === 'danger'
          ? 'cross'
          : label.tone === 'accent' || label.tone === 'success'
            ? 'check'
            : 'ring'
      }
      label={label.label}
      dir="auto"
    />
  );
}

export function ServiceStatus({ status }: { status: string | null }) {
  return (
    <StatusMark
      tone={status === 'failed' ? 'danger' : status === 'ok' ? 'success' : 'neutral'}
      shape={
        status === 'failed' ? 'cross' : status === 'ok' ? 'check' : status === 'skipped' ? 'pause' : 'ring'
      }
      label={status ?? '—'}
      dir="auto"
    />
  );
}

/** A boolean Live score as the run pass mark: 1 = green check 'Pass', 0 = red cross 'Fail', null = '—' (C-19). */
export function PassFailMark({ value }: { value: number | null }) {
  if (value === null) return <span>—</span>;
  return value ? (
    <StatusMark tone="success" shape="check" label="Pass" />
  ) : (
    <StatusMark tone="danger" shape="cross" label="Fail" />
  );
}

export function MetricValue({ value, spec }: { value: number | null; spec?: LiveMetricSpec | null }) {
  if (spec?.score_type === 'boolean') return <PassFailMark value={value} />;
  return (
    <ScoreValue
      value={value}
      direction={spec?.direction}
      type={spec?.score_type === 'percentage' || !spec ? 'score' : spec.score_type}
      text={scoreText(value, spec)}
      variant="plain"
    />
  );
}

export function Facts({ value, label }: { value: Record<string, unknown> | null; label: string }) {
  if (!value || Object.keys(value).length === 0)
    return <Text tone="muted">No {label.toLowerCase()} available for this turn.</Text>;
  return (
    <div className={styles.facts}>
      <KeyValueGrid
        columns={1}
        dense
        aria-label={label}
        items={Object.entries(value).map(([key, fact]) => ({
          key,
          label: <span dir="auto">{key}</span>,
          mono: typeof fact === 'number',
          value:
            fact !== null && typeof fact === 'object' ? (
              <StructuredValue value={fact} />
            ) : (
              <span dir="auto">{fact == null ? '—' : String(fact)}</span>
            ),
        }))}
      />
    </div>
  );
}

export function SqlParts({ parts }: { parts: SqlPart[] }) {
  if (!parts.length) return <Text tone="muted">No SQL available for this turn.</Text>;
  return (
    <div className={styles.sqlParts}>
      {parts.map((part, index) => (
        <div key={index}>
          <div className={styles.sqlMeta}>
            <StatusMark
              tone={part.executed === true ? 'success' : part.executed === false ? 'warning' : 'neutral'}
              shape={part.executed === true ? 'check' : part.executed === false ? 'pause' : 'ring'}
              label={
                part.executed === true
                  ? 'Executed'
                  : part.executed === false
                    ? 'Not executed'
                    : 'Execution unknown'
              }
            />
            <span className={styles.number}>{part.rows ?? '—'} rows</span>
            {part.text !== null ? <CopyButton text={part.text} label="Copy SQL" /> : null}
          </div>
          <pre className={styles.sql} dir="ltr">
            <code>{part.text ?? '—'}</code>
          </pre>
          {part.error ? (
            <div className={styles.error} data-tone="danger">
              <TextBlock text={part.error} dir="auto" />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}
