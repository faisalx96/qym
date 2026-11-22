import type { ReactNode } from 'react';
import { EmptyState, FieldRow, StatusMark, Tag, Text, TextBlock } from '@/ui';
import { deliveredOf, guardrailsOf, questionContextOf, recordOf, turnClassOf } from '../../lib/summary';
import { Bilingual, EvidenceCard } from './Evidence';
import styles from './TurnFacts.module.css';

const turnNames: Record<string, string> = {
  no_data_access: 'No data access',
  answer_withheld: 'Answer withheld',
  privacy_blocked: 'Blocked for privacy',
  refused_privacy: 'Refused for privacy',
  refused_internals: 'Refused to reveal internal details',
  refused_not_business: 'Refused a non-business question',
  refused_injection: 'Refused a prompt injection',
  refused_scope: 'Refused an out-of-scope question',
  refused_no_data: 'Refused because no data was available',
  refused_no_table: 'Refused because no table was available',
  conversational: 'Conversational reply',
  no_data_found: 'No data found',
  partial_answer: 'Partial answer',
  data_answer: 'Data answer',
  report: 'Report',
  rechart: 'Chart revised',
};
const stages: Record<string, string> = {
  access: 'at the access check',
  router: 'at the router',
  retrieval: 'during retrieval',
  agent: 'at the agent',
  query_blocker: 'at the query blocker',
  final_answer: 'at the final answer',
};
const kinds: Record<string, string> = {
  pii: 'Privacy',
  internals: 'Internal details',
  not_business_question: 'Business questions',
  scope: 'Scope',
  injection: 'Prompt injection',
  secrets: 'Secrets',
};

export function TurnFacts({ summary }: { summary: Record<string, unknown> }) {
  const turnClass = turnClassOf(summary);
  const guardrails = guardrailsOf(summary);
  const delivered = deliveredOf(summary);
  const context = questionContextOf(summary);
  const facts: { key: string; label: string; value: ReactNode }[] = [];
  if (turnClass?.name)
    facts.push({
      key: 'type',
      label: 'Turn type',
      value: [
        turnNames[turnClass.name] ?? turnClass.name,
        turnClass.stage ? (stages[turnClass.stage] ?? turnClass.stage) : null,
      ]
        .filter(Boolean)
        .join(', '),
    });
  if (guardrails?.granted) {
    for (const [key, label] of [
      ['pii', 'Privacy'],
      ['internals', 'Internal details'],
      ['businessQuestion', 'Business questions'],
    ] as const) {
      const active = guardrails.granted[key];
      facts.push({
        key,
        label,
        value: (
          <StatusMark
            tone="neutral"
            shape={active === true ? 'check' : active === false ? 'pause' : 'ring'}
            label={active === null ? 'unknown' : active ? 'active' : 'not active'}
          />
        ),
      });
    }
  }
  if (delivered) {
    // An empty supplied list is a known zero; a missing list is not a fact.
    const raw = recordOf(summary.delivered);
    for (const [key, label, items] of [
      ['methodology', 'Methodology items beside the answer', delivered.methodology],
      ['data_notes', 'Data notes beside the answer', delivered.dataNotes],
    ] as const) {
      if (Array.isArray(raw?.[key]))
        facts.push({
          key,
          label,
          value: (
            <Text as="span" mono>
              {items.length}
            </Text>
          ),
        });
    }
    if (delivered.textTrimmedForChart !== null)
      facts.push({
        key: 'trimmed',
        label: 'Answer text',
        value: delivered.textTrimmedForChart
          ? 'Insightor trimmed the text because a chart shows the values.'
          : 'Insightor did not trim the text for a chart.',
      });
  }
  const questions = [
    ['rewrite', 'Standalone question', context?.enrichedQuestion],
    ['previous', 'Previous question', context?.previousQuestion],
    ['excerpt', 'Selected excerpt', context?.selectedExcerpt],
  ] as const;
  for (const [index, item] of (guardrails?.fired ?? []).entries()) {
    if (!item.kind && !item.stage && !item.ruleId && !item.textEn) continue;
    facts.push({
      key: `guardrail-${index}`,
      label: 'Guardrail',
      value: (
        <div className={styles.stack}>
          <div className={styles.inline}>
            <StatusMark
              tone="warning"
              shape="pause"
              label={`${item.kind ? (kinds[item.kind] ?? item.kind) : 'Guardrail'} fired`}
            />
            {item.stage ? <Text>{stages[item.stage] ?? item.stage}</Text> : null}
            {item.ruleId ? <Tag kind="data">{item.ruleId}</Tag> : null}
          </div>
          <Bilingual en={item.textEn} ar={null} />
        </div>
      ),
    });
  }
  if (guardrails?.replayWithheld)
    facts.push({
      key: 'replay',
      label: 'SQL re-run',
      value: 'For privacy the evaluator ran no SQL of its own on this turn and stored no rows.',
    });
  for (const [index, chart] of (delivered?.charts ?? []).entries()) {
    if (
      !chart.kind &&
      !chart.type &&
      !chart.title &&
      chart.categories === null &&
      chart.sourceRows === null &&
      chart.shownInAnswer === null
    )
      continue;
    const name =
      chart.kind === 'chart' || !chart.kind
        ? `${chart.type ? chart.type.charAt(0).toUpperCase() + chart.type.slice(1) + ' ' : ''}chart`
        : chart.kind.charAt(0).toUpperCase() + chart.kind.slice(1);
    facts.push({
      key: `chart-${index}`,
      label: 'Visualization',
      value: (
        <div className={styles.stack}>
          <Text as="p">
            {name}
            {chart.categories !== null ? (
              <>
                , <span className={styles.number}>{chart.categories}</span> categories
              </>
            ) : null}
            {chart.sourceRows !== null ? (
              <>
                , built from <span className={styles.number}>{chart.sourceRows}</span> rows
              </>
            ) : null}
            {chart.shownInAnswer !== null
              ? `, ${chart.shownInAnswer ? 'shown' : 'not shown'} in the answer`
              : ''}
          </Text>
          {chart.title ? <TextBlock text={chart.title} dir="auto" code={false} /> : null}
        </div>
      ),
    });
  }
  for (const [key, label, text] of questions) {
    if (text) facts.push({ key, label, value: text });
  }
  return (
    <EvidenceCard title="What Insightor did" block="turn-facts">
      {facts.length ? (
        facts.map(({ key, label, value }) => (
          <FieldRow
            key={key}
            label={label}
            labelAnchor="start"
            labelCase="sentence"
            className={styles.factRow}
          >
            {typeof value === 'string' ? <TextBlock text={value} dir="auto" code={false} /> : value}
          </FieldRow>
        ))
      ) : (
        <EmptyState compact title="No turn facts recorded for this turn" />
      )}
    </EvidenceCard>
  );
}
