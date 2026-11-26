/** Performance area: the small marks every page shares (a run's step, a test's result, a kind, a legend). */
import type { ReactNode } from 'react';
import type { PerformanceRunStatus, PerformanceTier } from '@/api/performance';
import { LevelTag } from '@/features/feedback/badges';
import { StateTag, StatusMark, type StateTagTone } from '@/ui';
import { KIND_LEVEL, KIND_NAME } from '../../lib/format';
import { RUN_STATUS, verdictWords, type VerdictFacts } from '../../lib/status';
import styles from './shared.module.css';

/** The step of a run: a StatusMark (a process step is never a tag). */
export function RunStatus({ status }: { status: PerformanceRunStatus }) {
  const { tone, shape, label } = RUN_STATUS[status];
  return <StatusMark tone={tone} shape={shape} label={label} data-performance-status={status} />;
}

/** The result of a test: a StateTag (the result of a check), or nothing while there is none. */
export function Verdict({ run }: { run: VerdictFacts }) {
  const words = verdictWords(run);
  return words ? (
    <StateTag tone={words[0]} data-performance-verdict={run.verdict ?? ''}>
      {words[1]}
    </StateTag>
  ) : null;
}

/**
 * A number with its unit in quiet words: "30 of 60 users". `tight` is a unit glyph that sits on the number with no gap,
 * smaller and muted (the stat card rule, §3.3: "3.1s"); default off: a space, then the words.
 */
export function Quantity({
  value,
  unit,
  tight = false,
}: {
  value: ReactNode;
  unit?: ReactNode;
  tight?: boolean;
}) {
  return (
    <span>
      {value}
      {unit ? (
        <span className={styles.unit} data-tight={tight ? '' : undefined}>
          {tight ? unit : <> {unit}</>}
        </span>
      ) : null}
    </span>
  );
}

export interface LegendItem {
  label: string;
  tone?: StateTagTone | 'accent';
  series?: number;
  /** A dashed line instead of a square: a limit or a planned line. */
  line?: boolean;
}

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className={styles.legend}>
      {items.map((item) => (
        <span key={item.label} className={styles.legendItem}>
          <span
            className={styles.swatch}
            data-tone={item.tone}
            data-series={item.series}
            data-shape={item.line ? 'line' : undefined}
          />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/**
 * A kind of question as a label (tables, filters, a dataset box): the Level tag of §3.3, three level bars then the
 * word, as Complexity reads on the feedback pages (Simple one grey bar, Medium two orange, Complex three red). A chart
 * that draws one line per kind keeps its series colour (`KIND_SERIES`) with the word in its legend.
 */
export function KindTag({ kind }: { kind: PerformanceTier }) {
  return <LevelTag label={KIND_NAME[kind]} value="" level={KIND_LEVEL[kind]} />;
}

/**
 * The environment of a target, as Live marks the environment of a source (§3.3 "State tag", cv5 M2): a production
 * target is the `success` StateTag "Production". The read says only whether a target is production, so any other
 * target shows nothing.
 */
export function TargetEnvironment({ production }: { production: boolean }) {
  return production ? (
    <StateTag tone="success" data-performance-environment="production">
      Production
    </StateTag>
  ) : null;
}
