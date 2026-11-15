import type { ReactNode } from 'react';
import { KeyValueGrid, StatusMark, Tag, Text, TextBlock } from '@/ui';
import { deliveredOf, guardrailsOf, questionContextOf, recordOf, turnClassOf } from '../../lib/summary';
import { EvidenceCard } from './Evidence';
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
  const deliveredFacts: typeof facts = [];
  if (delivered) {
    // An empty supplied list is a known zero; a missing list is not a fact.
    const raw = recordOf(summary.delivered);
    for (const [key, label, items] of [
      ['methodology', 'Methodology items beside the answer', delivered.methodology],
      ['data_notes', 'Data notes beside the answer', delivered.dataNotes],
    ] as const) {
      if (Array.isArray(raw?.[key]))
        deliveredFacts.push({
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
      deliveredFacts.push({
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
  const fired =
    guardrails?.fired.filter(
      (item) => item.stage || item.kind || item.ruleId || item.textEn || item.source,
    ) ?? [];
  const charts =
    delivered?.charts.filter(
      (item) =>
        item.kind ||
        item.type ||
        item.title ||
        item.categories !== null ||
        item.sourceRows !== null ||
        item.shownInAnswer !== null,
    ) ?? [];
  if (
    !facts.length &&
    !deliveredFacts.length &&
    !fired.length &&
    !charts.length &&
    !guardrails?.replayWithheld &&
    !questions.some(([, , text]) => text)
  )
    return null;
  return (
    <EvidenceCard title="What Insightor did" block="turn-facts">
      <div className={styles.stack}>
        {facts.length ? <KeyValueGrid dense columns={1} items={facts} /> : null}
        {fired.map((item, index) => (
          <div key={index} className={styles.stack}>
            <div className={styles.inline}>
              <StatusMark
                tone="warning"
                shape="pause"
                label={`${item.kind ? (kinds[item.kind] ?? item.kind) : 'Guardrail'} fired`}
              />
              {item.stage ? <Text>{stages[item.stage] ?? item.stage}</Text> : null}
              {item.ruleId ? <Tag kind="data">{item.ruleId}</Tag> : null}
            </div>
            {item.textEn ? <TextBlock text={item.textEn} dir="ltr" code={false} /> : null}
            {item.source ? (
              <Text mono dir="ltr">
                {item.source}
              </Text>
            ) : null}
          </div>
        ))}
        {guardrails?.replayWithheld ? (
          <Text as="p">For privacy the evaluator ran no SQL of its own on this turn and stored no rows.</Text>
        ) : null}
        {charts.map((chart, index) => {
          const name =
            chart.kind === 'chart' || !chart.kind
              ? `${chart.type ? chart.type.charAt(0).toUpperCase() + chart.type.slice(1) + ' ' : ''}chart`
              : chart.kind.charAt(0).toUpperCase() + chart.kind.slice(1);
          return (
            <div key={index} className={styles.stack}>
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
          );
        })}
        {deliveredFacts.length ? <KeyValueGrid dense columns={1} items={deliveredFacts} /> : null}
        {questions.some(([, , text]) => text) ? (
          <KeyValueGrid
            dense
            columns={1}
            items={questions.flatMap(([key, label, text]) =>
              text ? [{ key, label, value: <TextBlock text={text} dir="auto" code={false} /> }] : [],
            )}
          />
        ) : null}
      </div>
    </EvidenceCard>
  );
}
