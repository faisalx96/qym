import { useLayoutEffect, useRef, type ReactNode } from 'react';
import type { LiveTurnDetail } from '@/api/live';
import { formatPercentValue } from '@/lib/format';
import { EmptyState, Card, InlineNotice, KeyValueGrid, Tag, StateTag, Text, TextBlock } from '@/ui';
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
import { Bilingual, BooleanTag, EvidenceCard, MetricValue, TurnCardTitle } from './Evidence';
import { deviationEvidence } from './deviationEvidence';
import { JudgeDeviations } from './JudgeDeviations';
import { useExplanationLanguage } from '../../ExplanationLanguage';
import styles from './JudgesTab.module.css';

export function JudgesTab({ data }: { data: LiveTurnDetail; modelIndex?: Record<string, number> | null }) {
  const language = useExplanationLanguage();
  const columnsRef = useRef<HTMLDivElement>(null);
  // Measure natural content, not the stretched sections, so shorter translations can shrink again.
  useLayoutEffect(() => {
    const root = columnsRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const sections = [...root.querySelectorAll<HTMLElement>('[data-judge-facet]')];
    const measure = () => {
      const wide = root.getBoundingClientRect().width >= 900;
      const heights = new Map<string, number[]>();
      for (const section of sections) {
        const key = section.dataset.judgeFacet!;
        const height = section.firstElementChild?.getBoundingClientRect().height ?? 0;
        heights.set(key, [...(heights.get(key) ?? []), height]);
      }
      for (const section of sections) {
        const values = heights.get(section.dataset.judgeFacet!)!;
        section.style.setProperty(
          '--judge-facet-height',
          `${wide && values.length === 2 ? Math.max(...values) : 0}px`,
        );
      }
    };
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    for (const section of sections)
      if (section.firstElementChild) observer.observe(section.firstElementChild);
    measure();
    return () => observer.disconnect();
  }, [data, language]);
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
            return {
              key: axis,
              label: axis === 'sql' ? 'SQL' : axis === 'response' ? 'Response' : 'Overall',
              value: <MetricValue value={value} spec={spec} />,
            };
          })}
        />
      ),
      checks: checks.some(([, , value]) => value !== null) ? (
        <KeyValueGrid
          columns={3}
          dense
          items={checks.map(([key, label, value]) => ({ key, label, value: <BooleanTag value={value} /> }))}
        />
      ) : null,
      against: judge?.vsAgent ? (
        <KeyValueGrid
          columns={3}
          dense
          items={[
            {
              key: 'equivalent',
              label: 'Equivalent',
              value: <BooleanTag value={judge.vsAgent.equivalent} />,
            },
            {
              key: 'results',
              label: 'Results match',
              value: <BooleanTag value={judge.vsAgent.resultSetMatch} />,
            },
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
              <StateTag
                tone={
                  route.verdict === 'correct' ? 'success' : route.verdict === 'wrong' ? 'danger' : 'neutral'
                }
              >
                {{ correct: 'Correct route', wrong: 'Wrong route', unsure: 'Unsure' }[route.verdict]}
              </StateTag>
            ) : null}
            <Bilingual en={route.reasoningEn || null} ar={route.reasoningAr || null} />
          </>
        ) : null,
      deviations: <JudgeDeviations summary={data.summary} side={side} />,
      reasoning:
        judge?.reasoningEn || judge?.reasoningAr ? (
          <Bilingual en={judge.reasoningEn || null} ar={judge.reasoningAr || null} />
        ) : (
          <EmptyState compact title="No reasoning available for this judge" />
        ),
      review:
        review && (review.agreement !== null || review.betterSql || review.textEn || review.textAr) ? (
          <>
            {review.agreement !== null || review.betterSql ? (
              <KeyValueGrid
                columns={3}
                dense
                items={[
                  ...(review.agreement !== null
                    ? [
                        {
                          key: 'agreement',
                          label: 'Agreement',
                          value: <BooleanTag value={review.agreement} />,
                        },
                      ]
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
            {review.textEn || review.textAr ? (
              <div className={styles.reviewReasoning}>
                <Text as="h4" variant="base" weight={600}>
                  Reasoning
                </Text>
                <Bilingual en={review.textEn || null} ar={review.textAr || null} />
              </div>
            ) : null}
          </>
        ) : null,
    };
    return { side, judge, facets };
  });
  const facets = [
    ['scores', null],
    ['reasoning', 'Reasoning'],
    ['deviations', 'Deviations'],
    ['checks', 'Checks'],
    ['against', 'Against the agent'],
    ['privacy', 'Privacy'],
    ['route', 'Route review'],
    ['review', 'Review of the other judge'],
  ] as const;
  return (
    <div className={styles.stack}>
      <div className={styles.columns} ref={columnsRef}>
        {columns.map(({ side, judge, facets: contents }) => (
          <Card
            key={side}
            flush
            className={styles.judge}
            data-live-block={`judge-${side}`}
            data-live-card={`judge-${side}`}
            header={
              <div className={styles.aligned} data-judge-facet="identity">
                <TurnCardTitle
                  as="h2"
                  title={`Judge ${side.toUpperCase()}`}
                  aside={
                    judge?.model ? (
                      <Tag kind="data" dir="auto">
                        {judge.model}
                      </Tag>
                    ) : undefined
                  }
                />
              </div>
            }
          >
            {facets.map(([key, title]) =>
              contents[key] ? (
                <section key={key} className={styles.facet} data-judge-facet={key}>
                  <div className={styles.facetInner}>
                    {title ? (
                      <Text as="h3" variant="base" weight={600}>
                        {title}
                        {key === 'deviations' ? ` · ${deviationEvidence(data.summary, side).length}` : ''}
                      </Text>
                    ) : null}
                    <div className={styles.facetBody}>{contents[key]}</div>
                  </div>
                </section>
              ) : null,
            )}
          </Card>
        ))}
      </div>
      <EvidenceCard title="Judge comparison">
        <KeyValueGrid
          columns={3}
          dense
          aria-label="Judge comparison"
          items={[
            { key: 'agreement', label: 'Judges agree', value: <BooleanTag value={agreement} /> },
            ...(confidence !== null
              ? [
                  {
                    key: 'confidence',
                    label: 'Diagnosis confidence',
                    value: formatPercentValue(confidence, 1),
                    mono: true,
                  },
                ]
              : []),
            ...(delta !== null ? [{ key: 'gap', label: 'SQL score gap', value: delta, mono: true }] : []),
          ]}
        />
      </EvidenceCard>
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
    </div>
  );
}
