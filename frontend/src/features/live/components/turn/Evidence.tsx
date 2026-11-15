import type { ReactNode } from 'react';
import type { LiveMetricSpec } from '@/api/live';
import {
  Card,
  ClampedText,
  Eyebrow,
  Tag,
  CopyButton,
  DataTable,
  Disclosure,
  EmptyState,
  KeyValueGrid,
  ScoreValue,
  StateTag,
  StructuredValue,
  Text,
  TextBlock,
} from '@/ui';
import type { AppliedRule, SqlPart, SqlResult } from '../../lib/summary';
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

export function SqlPreview({ result, expanded = false }: { result: SqlResult; expanded?: boolean }) {
  // A sample without column names cannot be laid out, so no preview is offered.
  if (result.rows === 0 || !result.sample.length || !result.columns.length) return null;
  const title = `First ${result.sample.length}${result.rows === null ? '' : ` of ${result.rows}`} rows`;
  const content = (
    <>
      <DataTable<{ cells: (string | null)[]; index: number }>
        aria-label={title}
        rows={result.sample.map((cells, index) => ({ cells, index }))}
        rowKey={(row) => row.index}
        columns={result.columns.map((name, index) => ({
          id: String(index),
          header: <span dir="auto">{name}</span>,
          label: name,
          resizable: false,
          cell: (row) => (
            <span dir="auto" className={styles.tableText}>
              {row.cells[index] == null ? (
                <Text as="span" tone="muted">
                  NULL
                </Text>
              ) : (
                row.cells[index]
              )}
            </span>
          ),
        }))}
        density="compact"
        densityLocked
        variant="embedded"
        responsive="scroll"
        stickyHeader={false}
      />
      {result.columnsTotal !== null && result.columnsTotal > result.columns.length ? (
        <Text tone="muted" variant="sm">
          Showing {result.columns.length} of {result.columnsTotal} columns
        </Text>
      ) : null}
    </>
  );
  return expanded ? (
    <div>
      <Text as="p" tone="muted" variant="sm">
        {title}
      </Text>
      {content}
    </div>
  ) : (
    <Disclosure title={title}>{content}</Disclosure>
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
          <SqlPreview result={part} />
          {part.replay ? (
            <>
              <Text tone="muted" variant="sm" as="p">
                Replayed for comparison: {part.replay.rows ?? '—'} rows
              </Text>
              <SqlPreview result={part.replay} />
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Languages stay visible together; direction applies to prose, never to the surrounding controls. */
export function Bilingual({ en, ar, clamp }: { en: string | null; ar: string | null; clamp?: number }) {
  if (en === null && ar === null) return null;
  return (
    <div className={styles.sqlParts}>
      {(
        [
          { text: en, label: 'English', dir: 'ltr' },
          { text: ar, label: 'Arabic', dir: 'rtl' },
        ] as const
      ).map(({ text, label, dir }) =>
        text === null ? null : (
          <div key={label}>
            <Eyebrow>{label}</Eyebrow>
            {clamp === undefined ? (
              <TextBlock text={text} dir={dir} code={false} />
            ) : (
              <ClampedText text={text} dir={dir} code={false} lines={clamp} />
            )}
          </div>
        ),
      )}
    </div>
  );
}

export function RulesApplied({ rules }: { rules: AppliedRule[] }) {
  if (!rules.length) return null;
  return (
    <div className={styles.sqlParts}>
      {rules.map((rule, index) => (
        <div key={`${rule.id}-${index}`}>
          <div className={styles.inline}>
            {rule.id !== null ? <Tag kind="data">{rule.id}</Tag> : null}
            {rule.titleEn !== null ? <TextBlock text={rule.titleEn} dir="ltr" code={false} /> : null}
            {rule.verdictEn !== null ? <TextBlock text={rule.verdictEn} dir="ltr" code={false} /> : null}
            {rule.titleAr !== null ? <TextBlock text={rule.titleAr} dir="rtl" code={false} /> : null}
            {rule.verdictAr !== null ? <TextBlock text={rule.verdictAr} dir="rtl" code={false} /> : null}
            {rule.sources.map((source, sourceIndex) => (
              <span key={`${source}-${sourceIndex}`} className={styles.inline}>
                <Text as="span" mono dir="ltr" className={styles.userRef}>
                  {source}
                </Text>
                <CopyButton text={source} label="Copy rule source" />
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
