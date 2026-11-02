import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { Select } from '../Select';
import { Tag } from '../Tag';
import styles from './Stepper.module.css';

export interface StepperStep {
  id: string;
  label: string;
  /** Edited values on this step (info count tag, hidden at 0). */
  changes?: number;
  /** Problems on this step (danger count tag, hidden at 0). */
  problems?: number;
}

export interface StepperProps {
  steps: readonly StepperStep[];
  /** Id of the active step. */
  current: string;
  /** Rail buttons are always enabled (no gating). */
  onSelect: (id: string) => void;
  'aria-label': string;
  /** Below this width (px) the rail becomes "Step n of N: label", a progress bar and a jump select. Default 760. */
  compactBelow?: number;
  className?: string;
}

function useNarrow(px: number): boolean {
  const query = `(max-width: ${px - 1}px)`;
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setNarrow(mql.matches);
    on();
    mql.addEventListener('change', on);
    return () => mql.removeEventListener('change', on);
  }, [query]);
  return narrow;
}

function stateOf(index: number, currentIndex: number): 'done' | 'current' | 'upcoming' {
  return index < currentIndex ? 'done' : index === currentIndex ? 'current' : 'upcoming';
}

function Counts({ step }: { step: StepperStep }) {
  return (
    <>
      {step.changes ? (
        <Tag kind="count" tone="info" title={`${step.changes} changed from the starting point`}>
          {step.changes}
          <span className={styles.hidden}> changed</span>
        </Tag>
      ) : null}
      {step.problems ? (
        <Tag kind="count" tone="danger" title={`${step.problems} to fix`}>
          {step.problems}
          <span className={styles.hidden}> to fix</span>
        </Tag>
      ) : null}
    </>
  );
}

/**
 * Wizard progress rail. An ordered list of always-clickable buttons (`aria-current="step"` on the
 * active one) over 4px bars that fill with a scaleX transition; done = earlier than the current step,
 * not "valid". Narrow screens get the compact form. Logical properties only, so it flips in RTL.
 */
export function Stepper({
  steps,
  current,
  onSelect,
  'aria-label': ariaLabel,
  compactBelow = 760,
  className,
}: StepperProps) {
  const narrow = useNarrow(compactBelow);
  const currentIndex = Math.max(
    0,
    steps.findIndex((s) => s.id === current),
  );
  const vars = { '--step-count': steps.length } as CSSProperties;
  if (narrow) {
    const step = steps[currentIndex]!;
    return (
      <nav
        aria-label={ariaLabel}
        className={[styles.compact, className].filter(Boolean).join(' ')}
        style={vars}
      >
        <p className={styles.compactTitle} aria-live="polite">
          Step {currentIndex + 1} of {steps.length}: {step.label}
        </p>
        <ol className={styles.dots} aria-hidden="true">
          {steps.map((s, i) => (
            <li key={s.id} className={styles.dot} data-state={stateOf(i, currentIndex)}>
              <span className={styles.fill} />
            </li>
          ))}
        </ol>
        <Select
          label="Go to step"
          items={steps.map((s, i) => ({
            key: s.id,
            label: `${i + 1}. ${s.label}${s.changes ? ` (${s.changes} changed)` : ''}${
              s.problems ? ` (${s.problems} to fix)` : ''
            }`,
          }))}
          value={step.id}
          searchable={false}
          onChange={(key) => key != null && onSelect(String(key))}
        />
      </nav>
    );
  }
  return (
    <nav aria-label={ariaLabel} className={className}>
      <ol className={styles.rail} style={vars}>
        {steps.map((s, i) => {
          const state = stateOf(i, currentIndex);
          return (
            <li key={s.id}>
              <button
                type="button"
                className={styles.step}
                data-state={state}
                aria-current={state === 'current' ? 'step' : undefined}
                onClick={() => onSelect(s.id)}
              >
                <span className={styles.bar} aria-hidden="true">
                  <span className={styles.fill} />
                </span>
                <span className={styles.text}>
                  <span className={styles.index}>{i + 1}</span>
                  <span>{s.label}</span>
                </span>
                <span className={styles.counts}>
                  <Counts step={s} />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
