import type { CSSProperties, ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { LiveTurnDetail } from '@/api/live';
import { Card, InlineNotice, KeyValueGrid, ScoreValue, StatusMark, Tag, Text, TextBlock } from '@/ui';
import {
  booleanOf,
  crossReviewOf,
  judgeFactsOf,
  judgeOf,
  numberOf,
  recordOf,
  servicesOf,
  verdictOf,
} from '../../lib/summary';
import { Bilingual, EvidenceCard } from './Evidence';
import { deviationEvidence } from './deviationEvidence';
import { JudgeDeviations } from './JudgeDeviations';
import { scoreText } from './presentation';
import styles from './JudgesTab.module.css';

function Check({ value }: { value: boolean | null | undefined }) {
  return (
    <StatusMark
      tone={value == null ? 'neutral' : value ? 'success' : 'danger'}
      shape={value == null ? 'ring' : value ? 'check' : 'cross'}
      label={value == null ? 'Unknown' : value ? 'Yes' : 'No'}
    />
  );
}

export function JudgesTab({ data }: { data: LiveTurnDetail }) {
  const location = useLocation();
  const agreement = booleanOf(data.summary.judges_agree);
  const confidence =
    verdictOf(data.summary)?.confidence ??
    numberOf(recordOf(data.scores.find((score) => score.metric_name === 'manifest_eval')?.meta)?.confidence);
  const delta = numberOf(
    servicesOf(data.summary).find((service) => service.name === 'sql_generation')?.signals?.delta,
  );
  const facts = judgeFactsOf(data.summary).filter((fact) => fact.textEn || fact.source);
  const columns = (['a', 'b'] as const).map((side) => {
    const judge = judgeOf(data.summary, side);
    const score = data.scores.find((item) => item.metric_name === `compliance_${side}`);
    const meta = recordOf(score?.meta);
    const spec = data.specs.find((item) => item.metric_name === `compliance_${side}`) ?? score?.spec;
    const threshold = spec?.pass_threshold ?? 0.7;
    const review = crossReviewOf(data.summary, side === 'a' ? 'a_on_b' : 'b_on_a');
    const coverage = judge?.vsAgent?.coverage;
    const route = judge?.routeReview;
    const checks = [
      [
        'manifest',
        'Followed manifest',
        judge?.checks?.followedManifest ?? booleanOf(meta?.followed_manifest),
      ],
      ['sql', 'SQL well formed', judge?.checks?.sqlWellFormed ?? booleanOf(meta?.sql_well_formed)],
      ['response', 'Response correct', judge?.checks?.responseCorrect ?? booleanOf(meta?.response_correct)],
    ] as const;
    const facets: Record<string, ReactNode> = {
      scores: (
        <KeyValueGrid
          columns={3}
          dense
          aria-label={`Judge ${side.toUpperCase()} compliance`}
          items={(['sql', 'response', 'overall'] as const).map((axis) => {
            const value =
              judge?.compliance[axis] ??
              (score?.skipped
                ? null
                : axis === 'overall'
                  ? (score?.score_numeric ?? null)
                  : numberOf(meta?.[`${axis}_score`]));
            const passes =
              value !== null && (spec?.direction === 'minimize' ? value <= threshold : value >= threshold);
            return {
              key: axis,
              label: `${axis === 'sql' ? 'SQL' : axis === 'response' ? 'Response' : 'Overall'} compliance`,
              value: (
                <ScoreValue
                  value={value}
                  text={scoreText(value, spec)}
                  variant="plain"
                  verdict={value === null ? null : passes ? 'pass' : 'fail'}
                />
              ),
            };
          })}
        />
      ),
      checks: checks.some(([, , value]) => value !== null) ? (
        <KeyValueGrid
          columns={1}
          dense
          items={checks.map(([key, label, value]) => ({ key, label, value: <Check value={value} /> }))}
        />
      ) : null,
      against: judge?.vsAgent ? (
        <KeyValueGrid
          columns={1}
          dense
          items={[
            { key: 'equivalent', label: 'Equivalent', value: <Check value={judge.vsAgent.equivalent} /> },
            { key: 'results', label: 'Results match', value: <Check value={judge.vsAgent.resultSetMatch} /> },
            ...(coverage
              ? [
                  {
                    key: 'coverage',
                    label: 'Coverage',
                    value: `${coverage.covered ?? '—'}/${coverage.total ?? '—'}`,
                    mono: true,
                  },
                ]
              : []),
          ]}
        />
      ) : null,
      privacy: judge?.privacyViolation ? (
        <InlineNotice tone="danger">This judge found the answer reveals one person's data.</InlineNotice>
      ) : null,
      route:
        route && (route.verdict || route.reasoningEn || route.reasoningAr) ? (
          <>
            {route.verdict ? (
              <StatusMark
                tone={
                  route.verdict === 'correct' ? 'success' : route.verdict === 'wrong' ? 'danger' : 'neutral'
                }
                shape={route.verdict === 'correct' ? 'check' : route.verdict === 'wrong' ? 'cross' : 'ring'}
                label={{ correct: 'Correct route', wrong: 'Wrong route', unsure: 'Unsure' }[route.verdict]}
              />
            ) : null}
            <Bilingual en={route.reasoningEn || null} ar={route.reasoningAr || null} />
          </>
        ) : null,
      deviations: deviationEvidence(data.summary, side).length ? (
        <JudgeDeviations summary={data.summary} side={side} />
      ) : null,
      reasoning:
        judge?.reasoningEn || judge?.reasoningAr ? (
          <Bilingual en={judge.reasoningEn || null} ar={judge.reasoningAr || null} />
        ) : (
          <Text tone="muted">No reasoning available for this judge.</Text>
        ),
      review:
        review && (review.agreement !== null || review.betterSql || review.textEn || review.textAr) ? (
          <>
            {review.agreement !== null || review.betterSql ? (
              <KeyValueGrid
                columns={1}
                dense
                items={[
                  ...(review.agreement !== null
                    ? [{ key: 'agreement', label: 'Agreement', value: <Check value={review.agreement} /> }]
                    : []),
                  ...(review.betterSql
                    ? [
                        {
                          key: 'better',
                          label: 'Better SQL',
                          value: { self: 'its own SQL', other: "the other judge's SQL", tie: 'equivalent' }[
                            review.betterSql
                          ],
                        },
                      ]
                    : []),
                ]}
              />
            ) : null}
            <Bilingual en={review.textEn || null} ar={review.textAr || null} />
          </>
        ) : null,
      sql:
        judge?.sqlParts.length || judge?.sqlReasoningEn || judge?.sqlReasoningAr ? (
          <>
            {judge.sqlParts.length ? (
              <ol className={styles.statements}>
                {judge.sqlParts.map((part, index) => {
                  const params = new URLSearchParams(location.search);
                  params.set('tab', 'answer');
                  params.set('vs', side);
                  return (
                    <li key={index}>
                      <div className={styles.facetBody}>
                        {part.subQuestion ? (
                          <TextBlock text={part.subQuestion} dir="auto" code={false} />
                        ) : null}
                        <div className={styles.inline}>
                          <StatusMark
                            tone={
                              part.executed === true
                                ? 'success'
                                : part.executed === false
                                  ? 'warning'
                                  : 'neutral'
                            }
                            shape={
                              part.executed === true ? 'check' : part.executed === false ? 'pause' : 'ring'
                            }
                            label={
                              part.executed === true
                                ? 'Executed'
                                : part.executed === false
                                  ? 'Not executed'
                                  : 'Execution unknown'
                            }
                          />
                          <Text as="span" mono>
                            {part.rows ?? '—'} rows
                          </Text>
                        </div>
                        {part.error ? (
                          <InlineNotice tone="danger">
                            <span dir="auto">{part.error}</span>
                          </InlineNotice>
                        ) : null}
                        <Link
                          to={{
                            pathname: location.pathname,
                            search: `?${params}`,
                            hash: `#part-${index + 1}`,
                          }}
                        >
                          Compare with the agent's SQL
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : null}
            <Bilingual en={judge.sqlReasoningEn || null} ar={judge.sqlReasoningAr || null} />
          </>
        ) : null,
    };
    return { side, judge, facets };
  });
  const facets = [
    ['scores', 'Scores'],
    ['checks', 'Checks'],
    ['against', 'Against the agent'],
    ['privacy', 'Privacy'],
    ['route', 'Route review'],
    ['deviations', 'Deviations'],
    ['reasoning', 'Reasoning'],
    ['review', 'Review of the other judge'],
    ['sql', 'Own SQL'],
  ].filter(([key]) => columns.some((column) => column.facets[key!]));
  return (
    <>
      <KeyValueGrid
        columns={3}
        dense
        aria-label="Judge comparison"
        items={[
          { key: 'agreement', label: 'Judges agree', value: <Check value={agreement} /> },
          ...(confidence !== null
            ? [{ key: 'confidence', label: 'Diagnosis confidence', value: confidence, mono: true }]
            : []),
          ...(delta !== null ? [{ key: 'gap', label: 'SQL score gap', value: delta, mono: true }] : []),
        ]}
      />
      {facts.length ? (
        <EvidenceCard title="Facts given to both judges" block="judge-facts">
          <ul className={styles.facts}>
            {facts.map((fact, index) => (
              <li key={index}>
                {fact.textEn ? <TextBlock text={fact.textEn} dir="ltr" code={false} /> : null}
                {fact.source ? (
                  <Text as="span" mono dir="ltr">
                    {fact.source}
                  </Text>
                ) : null}
              </li>
            ))}
          </ul>
        </EvidenceCard>
      ) : null}
      <div className={styles.columns}>
        {columns.map(({ side, judge, facets: contents }) => (
          <Card
            key={side}
            className={styles.judge}
            style={{ '--judge-rows': facets.length + 1 } as CSSProperties}
            data-live-block={`judge-${side}`}
            data-live-card={`judge-${side}`}
          >
            <div className={styles.identity}>
              <Text as="h2" variant="md" weight={600}>
                Judge {side.toUpperCase()}
              </Text>
              {judge?.model ? <Tag kind="model">{judge.model}</Tag> : null}
            </div>
            {facets.map(([key, title]) => (
              <section
                key={key}
                className={styles.facet}
                data-judge-facet={key}
                data-empty={!contents[key!] ? 'true' : undefined}
              >
                {contents[key!] ? (
                  <>
                    <Text as="h3" variant="md" weight={600}>
                      {title}
                    </Text>
                    <div className={styles.facetBody}>{contents[key!]}</div>
                  </>
                ) : null}
              </section>
            ))}
          </Card>
        ))}
      </div>
    </>
  );
}
