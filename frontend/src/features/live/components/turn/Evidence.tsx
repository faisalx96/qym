import type { ReactNode } from 'react';
import type { LiveMetricSpec } from '@/api/live';
import {
  Card,
  CopyButton,
  EmptyState,
  KeyValueGrid,
  ScoreValue,
  StateTag,
  StructuredValue,
  Text,
  TextBlock,
} from '@/ui';
import type { SqlPart } from '../../lib/summary';
import { verdictOf } from '../../lib/mix';
import { labelFor, scoreText, statusWord } from './presentation';
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
  const v = verdictOf(label.specTone);
  return (
    <StateTag tone={v.tone} dir="auto">
      {label.label}
    </StateTag>
  );
}

/** A service or tool call result: OK green, Failed red, anything else (Skipped, unknown, none) grey. */
export function ServiceStatus({ status }: { status: string | null }) {
  return (
    <StateTag tone={status === 'failed' ? 'danger' : status === 'ok' ? 'success' : 'neutral'} dir="auto">
      {status ? statusWord(status) : '—'}
    </StateTag>
  );
}

/** A boolean Live score as a check result: 1 = green 'Pass', 0 = red 'Fail', null = '—' (C-19). */
export function PassFailTag({ value }: { value: number | null }) {
  if (value === null) return <span>—</span>;
  return value ? <StateTag tone="success">Pass</StateTag> : <StateTag tone="danger">Fail</StateTag>;
}

export function MetricValue({ value, spec }: { value: number | null; spec?: LiveMetricSpec | null }) {
  if (spec?.score_type === 'boolean') return <PassFailTag value={value} />;
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
    return <EmptyState compact title={`No ${label.toLowerCase()} for this turn`} />;
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
  if (!parts.length) return <EmptyState compact title="No SQL for this turn" />;
  return (
    <div className={styles.sqlParts}>
      {parts.map((part, index) => (
        <div key={index}>
          <div className={styles.sqlMeta}>
            <StateTag
              tone={part.executed === true ? 'success' : part.executed === false ? 'warning' : 'neutral'}
            >
              {part.executed === true
                ? 'Executed'
                : part.executed === false
                  ? 'Not executed'
                  : 'Execution unknown'}
            </StateTag>
            <span>{part.rows ?? '—'} rows</span>
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
