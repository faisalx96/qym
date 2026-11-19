import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { modelSeriesOf } from '@/features/runs-list/model';
import type { LiveTurnDetail } from '@/api/live';
import { useSearchParamsState } from '@/lib/url-state';
import { textDirAttrs } from '@/lib/text';
import {
  Card,
  EmptyState,
  CopyButton,
  SegmentedControl,
  StateTag,
  ModelTag,
  Switch,
  Text,
  TextBlock,
} from '@/ui';
import { pairStatements, sqlDiff, type Segment } from '../../lib/sqlDiff';
import { booleanOf, judgeOf, recordOf, sqlPartsOf, stringOf, type SqlPart } from '../../lib/summary';
import { useExplanationLanguage } from '../../ExplanationLanguage';
import { Bilingual, BooleanTag, SqlCode, SqlPreview } from './Evidence';
import styles from './SqlCompare.module.css';

type Side = 'a' | 'b';
interface Pair {
  key: string;
  agent: SqlPart | null;
  a?: { part: SqlPart; index: number };
  b?: { part: SqlPart; index: number };
}

// Build one stable set of left panes across both judges. A switch changes the comparison,
// never which agent statement is shown. Repeated references retain distinct sub-questions.
function comparisonPairs(agent: SqlPart[], a: SqlPart[], b: SqlPart[]) {
  const pairs = new Map<string, Pair>();
  const used = new Set<number>();
  for (const [side, parts] of [
    ['a', a],
    ['b', b],
  ] as const) {
    const pairing = pairStatements(
      agent.map((part) => part.text ?? ''),
      parts,
    );
    const occurrences = new Map<number, number>();
    parts.forEach((part, index) => {
      const agentIndex = pairing.pairs[index] ?? null;
      const occurrence = agentIndex === null ? 0 : (occurrences.get(agentIndex) ?? 0);
      if (agentIndex !== null) {
        used.add(agentIndex);
        occurrences.set(agentIndex, occurrence + 1);
      }
      const key = agentIndex === null ? `unpaired-${index}` : `agent-${agentIndex}-${occurrence}`;
      const pair = pairs.get(key) ?? { key, agent: agentIndex === null ? null : agent[agentIndex]! };
      pair[side] = { part, index };
      pairs.set(key, pair);
    });
  }
  return { pairs: [...pairs.values()], unpaired: agent.filter((_, index) => !used.has(index)) };
}

function Verdict({ value, yes, no }: { value: boolean | null | undefined; yes: string; no: string }) {
  return value == null ? null : <BooleanTag value={value} yes={yes} no={no} />;
}

const didNotRun = (part: SqlPart | null) =>
  Boolean(
    part && (part.error || part.status === 'error' || part.status === 'blocked' || part.executed === false),
  );

function Execution({ part }: { part: SqlPart }) {
  return (
    <StateTag
      tone={
        part.error || part.status === 'error'
          ? 'danger'
          : part.status === 'blocked' || part.executed === false
            ? 'warning'
            : part.status === 'ok' || part.executed === true
              ? 'success'
              : 'neutral'
      }
    >
      {part.status === 'blocked'
        ? 'Blocked'
        : part.error || part.status === 'error'
          ? 'Failed'
          : part.executed === false
            ? 'Not executed'
            : part.status === 'ok' || part.executed === true
              ? 'Executed'
              : 'Execution unknown'}
    </StateTag>
  );
}

function Notices({ part, agent }: { part: SqlPart; agent: boolean }) {
  if (agent && part.status === 'blocked') {
    const reason =
      part.blocked === 'privacy'
        ? "Blocked by Insightor's privacy guard."
        : part.blocked === 'table_permission'
          ? 'Blocked by table permissions.'
          : part.blocked === 'validation'
            ? 'Blocked by SQL validation.'
            : 'Statement blocked.';
    return (
      <>
        <Text as="p">{reason} The evaluator did not run it.</Text>
        {part.blocked !== 'privacy' && part.error ? <TextBlock text={part.error} code={false} /> : null}
      </>
    );
  }
  return (
    <>
      {part.error ? (
        <TextBlock
          text={
            agent && part.status === null && part.executed === null && part.replay
              ? `The evaluator could not re-run this statement: ${part.error}`
              : part.error
          }
          code={false}
        />
      ) : null}
      {agent &&
      part.replay?.error &&
      (part.status !== null || part.executed !== null || part.replay.error !== part.error) ? (
        <TextBlock
          text={`The evaluator could not re-run this statement: ${part.replay.error}`}
          code={false}
        />
      ) : null}
      {agent && part.replay?.skipped ? (
        <Text as="p">
          {part.replay.skipped === 'privacy'
            ? 'The evaluator did not re-run this statement for privacy.'
            : 'The evaluator did not re-run this statement because it was not runnable.'}
        </Text>
      ) : null}
    </>
  );
}

function Preview({ part, agent, label }: { part: SqlPart | null; agent: boolean; label: string }) {
  const result = agent ? (part?.replay ?? part) : part;
  const error = agent ? (part?.replay?.error ?? (!part?.replay ? part?.error : null)) : part?.error;
  const blocked = agent && part?.status === 'blocked';
  const unavailable =
    !part ||
    blocked ||
    (agent && part.replay?.skipped) ||
    error ||
    ((!agent || !part.replay) && didNotRun(part));
  const sample =
    !unavailable && result && result.rows !== 0 && result.sample.length > 0 && result.columns.length > 0;
  return (
    <div className={styles.results} aria-label={`${label} results`}>
      {sample ? (
        <SqlPreview result={result} expanded />
      ) : error && !blocked ? (
        <div className={styles.failure} data-tone="danger">
          <TextBlock text={error} code={false} />
        </div>
      ) : (
        <EmptyState
          compact
          title={
            blocked
              ? part?.blocked === 'privacy'
                ? 'Not run (privacy guard)'
                : 'Not run'
              : unavailable
                ? 'Not run'
                : result?.rows !== null && result?.rows !== undefined
                  ? `${result.rows} rows`
                  : 'No result sample available'
          }
        />
      )}
      {agent && part?.replay && !blocked && !part.replay.skipped ? (
        <Text as="p" variant="sm" tone="muted">
          Replayed for comparison
        </Text>
      ) : null}
    </div>
  );
}

function Pane({
  part,
  agent = false,
  label,
  model,
  modelIndex,
  segments,
  selector,
  explanation,
}: {
  part: SqlPart | null;
  agent?: boolean;
  label: string;
  model?: string | null;
  modelIndex?: Record<string, number> | null;
  segments?: Segment[];
  selector?: ReactNode;
  explanation?: ReactNode;
}) {
  return (
    <div
      className={styles.pane}
      data-live-block={agent ? 'agent-sql' : 'judge-sql'}
      data-sql-pane={agent ? 'agent' : 'judge'}
    >
      <div className={styles.paneHeader}>
        {selector ?? (
          <Text as="span" weight={600}>
            {label}
          </Text>
        )}
        {part ? (
          <>
            <Execution part={part} />
            <Text as="span" mono>
              {part.rows ?? '—'} rows
            </Text>
          </>
        ) : null}
        {model ? <ModelTag name={model} series={modelSeriesOf(modelIndex ?? null, model, false)} /> : null}
        {part?.text != null ? <CopyButton text={part.text} label={`Copy ${label} SQL`} /> : null}
      </div>
      {explanation}
      <div className={styles.statement}>
        {part ? (
          <SqlCode text={part.text}>
            {segments?.map((segment, index) =>
              segment.kind === 'only' ? (
                <mark
                  key={index}
                  className={agent ? styles.agentMark : styles.judgeMark}
                  data-sql-mark={agent ? 'agent' : 'judge'}
                >
                  {segment.text}
                </mark>
              ) : (
                segment.text
              ),
            )}
          </SqlCode>
        ) : (
          <EmptyState
            compact
            title={
              agent ? 'The agent ran no statement for this sub-question.' : `No SQL available for ${label}`
            }
          />
        )}
        {part && agent ? <Notices part={part} agent /> : null}
      </div>
      <Preview part={part} agent={agent} label={label} />
    </div>
  );
}

function PairRow({
  pair,
  side,
  index,
  total,
  ignoreFormatting,
  model,
  modelIndex,
  selector,
  explanation,
}: {
  pair: Pair;
  side: Side;
  index: number;
  total: number;
  ignoreFormatting: boolean;
  model?: string | null;
  modelIndex?: Record<string, number> | null;
  selector?: ReactNode;
  explanation?: ReactNode;
}) {
  const selected = pair[side];
  const judge = selected?.part ?? null;
  const label = `Judge ${side.toUpperCase()}`;
  const agentText = pair.agent?.text;
  const judgeText = judge?.text;
  const diff = useMemo(
    () => (agentText && judgeText ? sqlDiff(agentText, judgeText, { ignoreFormatting }) : null),
    [agentText, judgeText, ignoreFormatting],
  );
  const failed = didNotRun(judge);
  const changed = diff && !diff.identical && !diff.tooLarge && !failed;
  const question = judge?.subQuestion;
  return (
    <section
      id={selected ? `part-${selected.index + 1}` : undefined}
      className={styles.pair}
      aria-label={`Sub-question ${index + 1} of ${total}`}
    >
      <Text as="h3" variant="base" weight={600}>
        Sub-question {index + 1} of {total}
        {question ? (
          <>
            : <bdi {...textDirAttrs(question)}>{question}</bdi>
          </>
        ) : null}
      </Text>
      <div className={styles.line} data-sql-clauses>
        {failed ? (
          <Text>{label}'s SQL did not run, so there are no rows to compare with the agent's.</Text>
        ) : !diff ? (
          <Text>No paired SQL available</Text>
        ) : diff.tooLarge ? (
          <Text>Too large to mark differences</Text>
        ) : diff.identical ? (
          <Text>
            {pair.agent?.text === judge?.text
              ? `The agent's SQL and ${label}'s SQL are identical.`
              : `The agent's SQL and ${label}'s SQL are identical apart from formatting.`}
          </Text>
        ) : (
          <div className={styles.line} aria-label="SQL difference legend">
            <Text as="span" tone="muted">
              Highlighted:
            </Text>
            <span className={styles.agentLegend}>only in the agent's SQL</span>
            <span className={styles.judgeLegend}>only in {label}'s SQL</span>
          </div>
        )}
      </div>
      <div className={`${styles.panes} ${explanation ? styles.withExplanation : ''}`}>
        <Pane
          part={pair.agent}
          label="Agent"
          agent
          segments={changed ? diff.left : undefined}
          explanation={
            explanation ? <div className={styles.explanationPlaceholder} aria-hidden="true" /> : null
          }
        />
        <Pane
          part={judge}
          label={label}
          model={model}
          modelIndex={modelIndex}
          segments={changed ? diff.right : undefined}
          selector={selector}
          explanation={explanation}
        />
      </div>
    </section>
  );
}

function noComparisonReason(summary: Record<string, unknown>) {
  if (booleanOf(recordOf(summary.guardrails)?.replay_withheld))
    return 'No judge SQL to compare: the evaluator withheld replay for privacy.';
  const skipped = summary.skipped;
  if (skipped === true || (typeof skipped === 'string' && skipped))
    return `No judge SQL to compare: evaluation was skipped${typeof skipped === 'string' ? ` (${skipped})` : ''}.`;
  const turnClass = stringOf(recordOf(summary.turn_class)?.name);
  return turnClass
    ? `No judge SQL to compare for this turn (${turnClass.replaceAll('_', ' ')}).`
    : 'No judge SQL available to compare for this turn.';
}

export function SqlCompare({
  data,
  modelIndex,
}: {
  data: LiveTurnDetail;
  modelIndex?: Record<string, number> | null;
}) {
  const { params } = useSearchParamsState();
  const { language } = useExplanationLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [ignoreFormatting, setIgnoreFormatting] = useState(true);
  const agent = useMemo(() => sqlPartsOf(data.turn.sql), [data.turn.sql]);
  const judges = useMemo(
    () => ({ a: judgeOf(data.summary, 'a'), b: judgeOf(data.summary, 'b') }),
    [data.summary],
  );
  const comparison = useMemo(
    () => comparisonPairs(agent, judges.a?.sqlParts ?? [], judges.b?.sqlParts ?? []),
    [agent, judges],
  );
  const side: Side = params.get('vs') === 'b' ? 'b' : 'a';
  const judge = judges[side];
  const explanation =
    (language !== 'ar' && judge?.sqlReasoningEn) || (language !== 'en' && judge?.sqlReasoningAr) ? (
      <div className={styles.explanation}>
        <Text as="p" weight={600}>
          Why the judge wrote it this way
        </Text>
        <Bilingual en={judge.sqlReasoningEn} ar={judge.sqlReasoningAr} />
      </div>
    ) : null;
  const dialect = booleanOf(recordOf(data.summary.sql_notes)?.dialect_ok);
  const failed = judge?.sqlParts.some(didNotRun);
  useEffect(() => {
    if (/^#part-\d+$/.test(location.hash))
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [location.hash, side, comparison.pairs.length]);
  const selector = (
    <SegmentedControl<Side>
      label="Compare the agent's SQL with"
      options={[
        { value: 'a', label: 'Judge A' },
        { value: 'b', label: 'Judge B' },
      ]}
      value={side}
      onChange={(value) => {
        const query = new URLSearchParams(params);
        query.set('vs', value);
        void navigate(
          { pathname: location.pathname, search: `?${query}`, hash: location.hash },
          { replace: true },
        );
      }}
    />
  );
  return (
    <Card
      data-live-block="sql-comparison"
      data-live-card="sql-comparison"
      header={
        <div className={styles.heading}>
          <Text as="h2" variant="lg" weight={600}>
            SQL comparison
          </Text>
          <div className={styles.line} aria-label={`Judge ${side.toUpperCase()} SQL summary`}>
            <Verdict value={judge?.vsAgent?.equivalent} yes="Equivalent" no="Not equivalent" />
            <Verdict value={judge?.vsAgent?.resultSetMatch} yes="Results match" no="Results differ" />
            {judge?.vsAgent?.coverage?.covered != null && judge.vsAgent.coverage.total != null ? (
              <StateTag tone="neutral">
                Coverage {judge.vsAgent.coverage.covered} of {judge.vsAgent.coverage.total}
              </StateTag>
            ) : null}
            {failed ? (
              <StateTag tone="warning">Judge {side.toUpperCase()} SQL failed</StateTag>
            ) : (
              <Verdict value={dialect} yes="Judge SQL dialect OK" no="Judge SQL dialect failed" />
            )}
          </div>
        </div>
      }
    >
      <div className={styles.compare}>
        {comparison.pairs.length ? (
          <>
            <div className={styles.options}>
              <Switch isSelected={ignoreFormatting} onChange={setIgnoreFormatting}>
                Ignore formatting
              </Switch>
            </div>
            {comparison.pairs.map((pair, index) => (
              <PairRow
                key={pair.key}
                pair={pair}
                side={side}
                index={index}
                total={comparison.pairs.length}
                ignoreFormatting={ignoreFormatting}
                model={judge?.model}
                modelIndex={modelIndex}
                selector={index === 0 ? selector : undefined}
                explanation={index === 0 ? explanation : undefined}
              />
            ))}
          </>
        ) : (
          <div data-live-block="judge-sql">
            <EmptyState compact title={noComparisonReason(data.summary)} />
          </div>
        )}
        {comparison.unpaired.length ? (
          <section className={styles.pair} aria-label="Agent-only statements">
            {comparison.pairs.length ? (
              <Text as="h3" variant="base" weight={600}>
                Agent-only statements
              </Text>
            ) : null}
            {comparison.unpaired.map((part, index) => (
              <Pane key={index} part={part} agent label={`Agent statement ${index + 1}`} />
            ))}
          </section>
        ) : !comparison.pairs.length ? (
          <EmptyState compact title="No SQL for this turn" />
        ) : null}
      </div>
    </Card>
  );
}
