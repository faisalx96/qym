import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { modelSeriesOf } from '@/features/runs-list/model';
import type { LiveTurnDetail } from '@/api/live';
import { useSearchParamsState } from '@/lib/url-state';
import {
  Button,
  EmptyState,
  CopyButton,
  SegmentedControl,
  StateTag,
  ModelTag,
  Tag,
  Text,
  TextBlock,
} from '@/ui';
import { clauseDiff, pairStatements, sqlDiff, type Segment } from '../../lib/sqlDiff';
import { booleanOf, judgeOf, recordOf, sqlPartsOf, stringOf, type SqlPart } from '../../lib/summary';
import { SqlParts, SqlPreview } from './Evidence';
import styles from './SqlCompare.module.css';

type Side = 'a' | 'b';

function compareParts(agent: SqlPart[], parts: SqlPart[], ignoreFormatting: boolean) {
  const pairing = pairStatements(
    agent.map((part) => part.text ?? ''),
    parts,
  );
  const pairs = parts.map((judge, index) => {
    const agentIndex = pairing.pairs[index];
    const left = agentIndex == null ? null : agent[agentIndex]!;
    // Missing statements are absence of evidence, not an all-insertions diff.
    const comparable = Boolean(left?.text && judge.text);
    const diff = comparable ? sqlDiff(left!.text!, judge.text!, { ignoreFormatting }) : null;
    const clauses = comparable ? clauseDiff(left!.text!, judge.text!, { ignoreFormatting }) : null;
    return { agent: left, judge, index, diff, clauses };
  });
  return {
    pairs,
    unpaired: pairing.unpaired,
    weight: pairs.reduce(
      (sum, pair) => sum + (pair.clauses?.leftOnly ?? 0) + (pair.clauses?.rightOnly ?? 0),
      0,
    ),
  };
}

type Pair = ReturnType<typeof compareParts>['pairs'][number];

function differenceLabel(pair: Pair) {
  if (!pair.diff) return 'No paired SQL available';
  if (pair.diff.tooLarge) return 'Too large to mark differences';
  if (pair.diff.identical)
    return pair.agent?.text === pair.judge.text ? 'Identical' : 'Same apart from formatting';
  return pair.clauses?.clauses.length
    ? `Differs in: ${pair.clauses.clauses.join(' · ')}`
    : 'Different fragments';
}

function Verdict({ value, yes, no }: { value: boolean | null | undefined; yes: string; no: string }) {
  return value == null ? null : <StateTag tone={value ? 'success' : 'danger'}>{value ? yes : no}</StateTag>;
}

function Notices({ part, agent }: { part: SqlPart; agent: boolean }) {
  if (agent && part.status === 'blocked') {
    return <Text as="p">Blocked by Insightor's privacy guard. The evaluator did not run it.</Text>;
  }
  return (
    <>
      {part.error ? (
        <TextBlock
          text={
            agent && part.status === null
              ? `The evaluator could not re-run this statement: ${part.error}`
              : part.error
          }
          code={false}
        />
      ) : null}
      {agent && part.replay?.error && (part.status !== null || part.replay.error !== part.error) ? (
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

function Pane({
  part,
  label,
  agent = false,
  model,
  modelIndex,
  segments,
  hook,
}: {
  part: SqlPart | null;
  label: string;
  agent?: boolean;
  model?: string | null;
  modelIndex?: Record<string, number> | null;
  segments?: Segment[];
  hook?: string;
}) {
  return (
    <div className={styles.pane} data-live-block={hook} data-sql-pane={agent ? 'agent' : 'judge'}>
      <div className={styles.line}>
        <Text weight={600}>{label}</Text>
        {model ? <ModelTag name={model} series={modelSeriesOf(modelIndex ?? null, model, false)} /> : null}
        {part?.text != null ? <CopyButton text={part.text} label={`Copy ${label} SQL`} /> : null}
      </div>
      {part ? (
        <>
          <pre className={styles.sql} dir="ltr">
            <code>
              {segments
                ? segments.map((segment, index) =>
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
                  )
                : (part.text ?? 'No statement text available.')}
            </code>
          </pre>
          <Notices part={part} agent={agent} />
        </>
      ) : (
        <Text tone="muted">The agent ran no statement for this sub-question.</Text>
      )}
    </div>
  );
}

function Preview({ part, agent, label }: { part: SqlPart | null; agent: boolean; label: string }) {
  const result = agent ? part?.replay : part;
  const unavailable =
    !part ||
    (agent && (part.status === 'blocked' || part.replay?.skipped || part.replay?.error)) ||
    (!agent && part.error);
  return (
    <div className={styles.pane} aria-label={`${label} results`}>
      <Text weight={600}>{label} results</Text>
      {!unavailable &&
      result &&
      result.rows !== 0 &&
      result.sample.length > 0 &&
      result.columns.length > 0 ? (
        <SqlPreview result={result} expanded />
      ) : (
        <Text as="p" tone="muted">
          {agent && part?.status === 'blocked'
            ? 'Not run (privacy guard)'
            : agent && part?.replay?.skipped
              ? 'Not run'
              : agent && part?.replay?.error
                ? part.replay.error
                : !agent && part?.error
                  ? part.error
                  : result?.rows != null
                    ? `${result.rows} rows`
                    : !part || (!agent && part.executed === false)
                      ? 'Not run'
                      : 'No result sample available'}
        </Text>
      )}
    </div>
  );
}

function PairRow({
  pair,
  side,
  model,
  modelIndex,
  total,
  compact,
}: {
  pair: Pair;
  side: Side;
  model?: string | null;
  modelIndex?: Record<string, number> | null;
  total: number;
  compact: boolean;
}) {
  const label = `Judge ${side.toUpperCase()}`;
  const changed = pair.diff && !pair.diff.identical && !pair.diff.tooLarge;
  return (
    <section
      id={compact ? undefined : `part-${pair.index + 1}`}
      className={styles.pair}
      aria-label={`Sub-question ${pair.index + 1} of ${total}`}
    >
      <Text as="h3" variant="md" weight={600}>
        Sub-question {pair.index + 1} of {total}
      </Text>
      {pair.judge.subQuestion ? <TextBlock text={pair.judge.subQuestion} code={false} /> : null}
      <div className={styles.line} data-sql-verdict>
        <Verdict value={pair.judge.semanticEquivalent} yes="Equivalent" no="Not equivalent" />
        <Verdict value={pair.judge.resultSetMatch} yes="Results match" no="Results differ" />
        <span>
          Agent{' '}
          <span className={styles.number}>
            {pair.agent?.status === 'blocked' || pair.agent?.replay?.skipped || pair.agent?.replay?.error
              ? '—'
              : (pair.agent?.replay?.rows ?? '—')}
          </span>{' '}
          rows · Judge <span className={styles.number}>{pair.judge.rows ?? '—'}</span> rows
        </span>
      </div>
      <div className={styles.line} data-sql-clauses>
        {changed && pair.clauses?.clauses.length ? (
          <>
            Differs in:{' '}
            {pair.clauses.clauses.map((clause) => (
              <Tag key={clause} kind="data">
                {clause}
              </Tag>
            ))}
          </>
        ) : (
          differenceLabel(pair)
        )}
      </div>
      <div className={styles.panes}>
        <Pane
          part={pair.agent}
          label="Agent"
          agent
          segments={pair.diff?.left}
          hook={compact ? 'agent-sql' : undefined}
        />
        <Pane
          part={pair.judge}
          label={label}
          model={model}
          modelIndex={modelIndex}
          segments={pair.diff?.right}
          hook={compact ? 'judge-sql' : undefined}
        />
      </div>
      {!compact ? (
        <div className={styles.panes}>
          <Preview part={pair.agent} agent label="Agent" />
          <Preview part={pair.judge} agent={false} label={label} />
        </div>
      ) : null}
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

/** Full statement comparison, or the most-different pair plus links for Diagnosis. */
export function SqlCompare({
  data,
  compact = false,
  modelIndex,
}: {
  data: LiveTurnDetail;
  compact?: boolean;
  modelIndex?: Record<string, number> | null;
}) {
  const { params } = useSearchParamsState();
  const location = useLocation();
  const navigate = useNavigate();
  const [ignoreFormatting, setIgnoreFormatting] = useState(true);
  const agent = useMemo(() => sqlPartsOf(data.turn.sql), [data.turn.sql]);
  const judges = useMemo(
    () => ({ a: judgeOf(data.summary, 'a'), b: judgeOf(data.summary, 'b') }),
    [data.summary],
  );
  const normalized = useMemo(
    () => ({
      a: compareParts(agent, judges.a?.sqlParts ?? [], true),
      b: compareParts(agent, judges.b?.sqlParts ?? [], true),
    }),
    [agent, judges],
  );
  const comparisons = useMemo(
    () =>
      ignoreFormatting
        ? normalized
        : {
            a: compareParts(agent, judges.a?.sqlParts ?? [], false),
            b: compareParts(agent, judges.b?.sqlParts ?? [], false),
          },
    [agent, judges, ignoreFormatting, normalized],
  );
  // The default judge is stable when the viewer toggles formatting.
  const defaultSide =
    (!normalized.a.pairs.length && normalized.b.pairs.length) || normalized.b.weight > normalized.a.weight
      ? 'b'
      : 'a';
  const requested = params.get('vs');
  const side: Side = compact
    ? comparisons.a.pairs.length
      ? 'a'
      : 'b'
    : requested === 'a' || requested === 'b'
      ? requested
      : defaultSide;
  const comparison = comparisons[side];
  const judge = judges[side];
  useEffect(() => {
    if (!compact && /^#part-\d+$/.test(location.hash)) {
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
    }
  }, [compact, location.hash, side, comparison.pairs.length]);
  const otherSide = side === 'a' ? 'b' : 'a';
  const worst = (pairs: Pair[]) =>
    pairs.reduce<Pair | null>(
      (best, pair) =>
        !best ||
        (pair.clauses?.leftOnly ?? 0) + (pair.clauses?.rightOnly ?? 0) >
          (best.clauses?.leftOnly ?? 0) + (best.clauses?.rightOnly ?? 0)
          ? pair
          : best,
      null,
    );
  const selected = worst(comparison.pairs);
  const other = worst(comparisons[otherSide].pairs);
  const link = (target: Side, index: number) => {
    const query = new URLSearchParams(params);
    query.set('tab', 'answer');
    query.set('vs', target);
    return { pathname: location.pathname, search: `?${query}`, hash: `#part-${index + 1}` };
  };
  const dialect = booleanOf(recordOf(data.summary.sql_notes)?.dialect_ok);
  if (!comparisons.a.pairs.length && !comparisons.b.pairs.length)
    return (
      <div className={styles.compare}>
        <div data-live-block="agent-sql">
          {agent.length ? (
            agent.map((part, index) => (
              <div key={index}>
                <SqlParts
                  parts={[
                    {
                      ...part,
                      error: null,
                      replay:
                        part.status === 'blocked' || part.replay?.skipped || part.replay?.error
                          ? null
                          : part.replay,
                    },
                  ]}
                />
                <Notices part={part} agent />
              </div>
            ))
          ) : (
            <SqlParts parts={[]} />
          )}
        </div>
        <Text as="p" tone="muted" data-live-block="judge-sql">
          {noComparisonReason(data.summary)}
        </Text>
      </div>
    );
  return (
    <div className={styles.compare}>
      {!compact ? (
        <div className={styles.line}>
          <Text>Compare the agent's SQL with:</Text>
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
          <Button
            className={styles.toggle}
            variant={ignoreFormatting ? 'accent' : 'neutral'}
            aria-pressed={ignoreFormatting}
            onPress={() => setIgnoreFormatting((value) => !value)}
          >
            Ignore formatting
          </Button>
        </div>
      ) : null}
      <div className={styles.summary} aria-label={`Judge ${side.toUpperCase()} SQL summary`}>
        <Verdict value={judge?.vsAgent?.equivalent} yes="Equivalent" no="Not equivalent" />
        <Verdict value={judge?.vsAgent?.resultSetMatch} yes="Results match" no="Results differ" />
        <span>
          Coverage{' '}
          <span className={styles.number}>
            {judge?.vsAgent?.coverage?.covered ?? '—'}/{judge?.vsAgent?.coverage?.total ?? '—'}
          </span>
        </span>
        <Verdict value={dialect} yes="Judge SQL dialect OK" no="Judge SQL dialect failed" />
      </div>
      {comparison.pairs.length ? (
        <div className={styles.line} aria-label="SQL difference legend">
          <span>
            <mark className={styles.agentMark}>only in the agent's SQL</mark>
          </span>
          <span>
            <mark className={styles.judgeMark}>only in Judge {side.toUpperCase()}'s SQL</mark>
          </span>
        </div>
      ) : (
        <EmptyState compact title={`No SQL available for Judge ${side.toUpperCase()}`} />
      )}
      {(compact ? (selected ? [selected] : []) : comparison.pairs).map((pair) => (
        <PairRow
          key={pair.index}
          pair={pair}
          side={side}
          model={judge?.model}
          modelIndex={modelIndex}
          total={comparison.pairs.length}
          compact={compact}
        />
      ))}
      {compact && selected ? <Link to={link(side, selected.index)}>Open the full comparison</Link> : null}
      {compact ? (
        <div className={styles.line} data-live-block={otherSide === 'b' ? 'judge-b' : 'judge-a'}>
          <Text>
            Judge {otherSide.toUpperCase()}:{' '}
            {other
              ? differenceLabel(other).replace(/^./, (letter) => letter.toLowerCase())
              : 'no SQL available'}
          </Text>
          <Link to={link(otherSide, other?.index ?? 0)}>Compare with Judge {otherSide.toUpperCase()}</Link>
        </div>
      ) : comparison.unpaired.length ? (
        <section className={styles.pair} aria-label="Agent-only statements">
          <Text as="h3" variant="md" weight={600}>
            Agent-only statements
          </Text>
          {comparison.unpaired.map((index) => {
            const part = agent[index]!;
            return (
              <div key={index} className={styles.pair}>
                <div className={styles.line}>
                  <StateTag tone={part.status === 'error' ? 'danger' : part.executed ? 'success' : 'neutral'}>
                    {part.status ??
                      (part.executed === true
                        ? 'Executed'
                        : part.executed === false
                          ? 'Not executed'
                          : 'Execution unknown')}
                  </StateTag>
                  <span>
                    <span className={styles.number}>{part.rows ?? '—'}</span> rows
                  </span>
                </div>
                <Pane part={part} label={`Agent statement ${index + 1}`} agent />
                <Preview part={part} agent label={`Agent statement ${index + 1}`} />
              </div>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
