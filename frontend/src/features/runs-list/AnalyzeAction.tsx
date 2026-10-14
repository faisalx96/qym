/**
 * The Analyze action of a run or pass (runs list, passes panel): an explicit button with its state written on it.
 *   not analysed  -> "Analyze" (sparkle, meta tone)  : starts the auto-analysis
 *   analysing     -> "Analyzing" (pulsing dot)       : an analysis job is running; opens it
 *   analysed      -> "N causes" (filled sparkle)     : root causes were found; opens the result
 * Live runs have nothing to analyse yet, so they show a dash.
 */
import { LinkButton } from '@/ui';
import styles from './AnalyzeAction.module.css';

export type AnalyzeState = 'idle' | 'running' | 'done';

export function analyzeState(causeCount: number, analyzing: boolean): AnalyzeState {
  if (analyzing) return 'running';
  return causeCount > 0 ? 'done' : 'idle';
}

export function analyzeLabel(state: AnalyzeState, causeCount: number): string {
  if (state === 'running') return 'Analyzing';
  if (state === 'done') return `${causeCount} cause${causeCount === 1 ? '' : 's'}`;
  return 'Analyze';
}

function Spark({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      aria-hidden="true"
      className={styles.spark}
      data-filled={filled ? '' : undefined}
    >
      <path
        d="M9.6 2.2C9.6 6.1 13.4 10 17.3 10C13.4 10 9.6 13.9 9.6 17.8C9.6 13.9 5.8 10 1.9 10C5.8 10 9.6 6.1 9.6 2.2Z"
        fill={filled ? 'currentColor' : 'none'}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path
        d="M17.2 13C17.2 15.6 19.4 18 22 18C19.4 18 17.2 20.4 17.2 23C17.2 20.4 15 18 12.4 18C15 18 17.2 15.6 17.2 13Z"
        fill="currentColor"
        className={styles.sparkMinor}
      />
    </svg>
  );
}

export function AnalyzeAction({
  to,
  causeCount,
  analyzing = false,
  subject,
}: {
  to: string;
  causeCount: number;
  analyzing?: boolean;
  /** "pass 2" / run name, for the accessible name. */
  subject?: string;
}) {
  const state = analyzeState(causeCount, analyzing);
  const label = analyzeLabel(state, causeCount);
  const title =
    state === 'done'
      ? `${label} found: open the auto-analysis`
      : state === 'running'
        ? 'An analysis is running: open it'
        : 'Run auto-analysis';
  return (
    <LinkButton
      to={to}
      variant="meta"
      className={styles.action}
      data-state={state}
      data-testid="analyze-action"
      title={title}
      aria-label={`${state === 'idle' ? 'Analyze' : label}${subject ? ` ${subject}` : ''}${
        state === 'running' ? ' (running)' : ''
      }`}
      icon={
        state === 'running' ? (
          <span className={styles.pulse} aria-hidden="true" />
        ) : (
          <Spark filled={state === 'done'} />
        )
      }
    >
      {label}
    </LinkButton>
  );
}
