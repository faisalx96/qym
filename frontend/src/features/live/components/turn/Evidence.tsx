import type { ComponentProps, ReactNode } from 'react';
import type { LiveMetricSpec } from '@/api/live';
import {
  Card,
  CardTitle,
  ClampedText,
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
import { useExplanationLanguage } from '../../ExplanationLanguage';
import { verdictOf } from '../../lib/mix';
import { labelFor, scoreText, sentenceLabel, statusWord } from './presentation';
import styles from '../../turn.module.css';

export function TurnCardTitle(props: Omit<ComponentProps<typeof CardTitle>, 'className'>) {
  return <CardTitle as="h2" {...props} className={styles.cardTitle} />;
}

export function BooleanTag({
  value,
  yes = 'Yes',
  no = 'No',
}: {
  value: boolean | null | undefined;
  yes?: string;
  no?: string;
}) {
  return (
    <StateTag tone={value == null ? 'neutral' : value ? 'success' : 'danger'}>
      {value == null ? 'Unknown' : value ? yes : no}
    </StateTag>
  );
}

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
    <Card data-live-block={block} data-live-card={block} header={<TurnCardTitle title={title} />}>
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
  return <BooleanTag value={Boolean(value)} yes="Pass" no="Fail" />;
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

const signalLabels: Record<string, string> = {
  selected_tables: 'Tables selected',
  judge_tables: 'Tables the judges needed',
  router_intent: 'Router decision',
};

function signalLabel(key: string): string {
  return signalLabels[key] ?? sentenceLabel(key);
}

function SignalValue({ value }: { value: unknown }) {
  if (Array.isArray(value)) {
    if (!value.length) return <Text as="span">None</Text>;
    if (value.every((item) => item === null || typeof item !== 'object')) {
      return (
        <div className={styles.signalTags}>
          {value.map((item, index) =>
            typeof item === 'boolean' ? (
              <BooleanTag key={index} value={item} />
            ) : (
              <Tag key={index} kind="data" dir="auto">
                {item == null ? 'Not recorded' : String(item)}
              </Tag>
            ),
          )}
        </div>
      );
    }
  }
  if (value !== null && typeof value === 'object')
    return <StructuredValue value={value} variant="keys" toolbar={false} />;
  return (
    <TextBlock
      className={styles.signalText}
      code={false}
      text={
        typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value == null ? 'Not recorded' : String(value)
      }
    />
  );
}

export function Facts({
  value,
  label,
  signals = false,
}: {
  value: Record<string, unknown> | null;
  label: string;
  signals?: boolean;
}) {
  if (!value || Object.keys(value).length === 0)
    return <EmptyState compact title={`No ${label.toLowerCase()} for this turn`} />;
  if (signals) {
    const items = Object.entries(value).flatMap(([key, fact]) => {
      const entries =
        fact !== null && !Array.isArray(fact) && typeof fact === 'object' ? Object.entries(fact) : [];
      const flat =
        entries.length > 0 &&
        entries.every(
          ([, child]) =>
            child === null ||
            typeof child !== 'object' ||
            (Array.isArray(child) && child.every((item) => item === null || typeof item !== 'object')),
        );
      return (
        flat
          ? entries.map(([child, item]) => ({
              key: `${key}.${child}`,
              label: `${signalLabel(key)} · ${signalLabel(child)}`,
              fact: item,
            }))
          : [{ key, label: signalLabel(key), fact }]
      ).map((item) => ({
        key: item.key,
        label: item.label,
        mono: typeof item.fact === 'number',
        value: <SignalValue value={item.fact} />,
      }));
    });
    return (
      <div className={styles.signalFacts}>
        <KeyValueGrid columns={3} aria-label={label} items={items} />
      </div>
    );
  }
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

export function SqlCode({ text, children }: { text: string | null; children?: ReactNode }) {
  return (
    <pre className={styles.sql} dir="ltr">
      <code>{children ?? text ?? 'No statement text available.'}</code>
    </pre>
  );
}

function numericResult(value: string) {
  // Samples arrive as strings; only unambiguous numeric values receive numeric alignment.
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim());
}

export function SqlPreview({ result, expanded = false }: { result: SqlResult; expanded?: boolean }) {
  if (result.rows === 0 || !result.sample.length || !result.columns.length) return null;
  const title = `First ${result.sample.length}${result.rows === null ? '' : ` of ${result.rows}`} rows`;
  const content = (
    <div className={styles.sqlPreview}>
      <DataTable<{ cells: (string | null)[]; index: number }>
        aria-label={title}
        rows={result.sample.map((cells, index) => ({ cells, index }))}
        rowKey={(row) => row.index}
        columns={result.columns.map((name, index) => {
          const values = result.sample.flatMap((row) => (row[index] == null ? [] : [row[index]!]));
          const numeric = values.length > 0 && values.every(numericResult);
          return {
            id: String(index),
            header: <bdi dir="auto">{name}</bdi>,
            label: name,
            resizable: false,
            flex: true,
            minWidth: 80,
            align: numeric ? ('end' as const) : ('start' as const),
            mono: numeric,
            cell: (row) => (
              <div className={styles.tableText}>
                {row.cells[index] == null ? (
                  <Text as="span" tone="muted">
                    NULL
                  </Text>
                ) : (
                  <TextBlock text={row.cells[index]} mode="raw" code={false} className={styles.sqlValue} />
                )}
              </div>
            ),
          };
        })}
        density="compact"
        densityLocked
        variant="embedded"
        responsive="scroll"
        stickyHeader={false}
      />
      {result.rows !== null && result.rows > result.sample.length ? (
        <Text as="p" tone="muted" variant="sm">
          Showing {result.sample.length} of {result.rows} rows
        </Text>
      ) : null}
      {result.columnsTotal !== null && result.columnsTotal > result.columns.length ? (
        <Text as="p" tone="muted" variant="sm">
          Showing {result.columns.length} of {result.columnsTotal} columns
        </Text>
      ) : null}
    </div>
  );
  return expanded ? content : <Disclosure title={title}>{content}</Disclosure>;
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
          <SqlCode text={part.text} />
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

/** The page preference selects prose only; labels and controls keep the page direction. */
export function Bilingual({
  en,
  ar,
  clamp,
  titleEn,
  titleAr,
}: {
  en: string | null;
  ar: string | null;
  clamp?: number;
  titleEn?: string | null;
  titleAr?: string | null;
}) {
  const { language } = useExplanationLanguage();
  const parts = [
    ...(language !== 'ar' && (en || titleEn) ? [{ text: en, title: titleEn, dir: 'ltr' as const }] : []),
    ...(language !== 'en' && (ar || titleAr) ? [{ text: ar, title: titleAr, dir: 'rtl' as const }] : []),
  ];
  if (!parts.length) return null;
  return (
    <div className={styles.bilingual} data-language={language}>
      {parts.map(({ text, title, dir }) => (
        <div key={dir} className={styles.explanation} data-dir={dir}>
          {title ? <TextBlock text={title} dir={dir} code={false} className={styles.ruleTitle} /> : null}
          {!text ? null : clamp === undefined ? (
            <TextBlock text={text} dir={dir} code={false} />
          ) : (
            <ClampedText text={text} dir={dir} code={false} lines={clamp} />
          )}
        </div>
      ))}
    </div>
  );
}

export function RulesApplied({ rules }: { rules: AppliedRule[] }) {
  if (!rules.length) return <EmptyState compact title="No cited rules recorded for this turn" />;
  return (
    <DataTable
      aria-label="Insightor rules behind this verdict"
      fit="declared"
      rows={rules.map((rule, index) => ({ ...rule, index }))}
      rowKey={(rule) => rule.index}
      columns={[
        {
          id: 'rule',
          header: 'Rule',
          width: 80,
          resizable: false,
          cell: (rule) => (rule.id ? <Tag kind="data">{rule.id}</Tag> : null),
        },
        {
          id: 'instruction',
          header: 'What the judges were told',
          flex: true,
          resizable: false,
          cell: (rule) => (
            <Bilingual
              titleEn={rule.titleEn}
              titleAr={rule.titleAr}
              en={rule.verdictEn}
              ar={rule.verdictAr}
            />
          ),
        },
      ]}
      density="compact"
      densityLocked
      variant="embedded"
      responsive="scroll"
      stickyHeader={false}
    />
  );
}
