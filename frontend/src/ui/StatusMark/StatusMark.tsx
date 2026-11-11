import type { HTMLAttributes } from 'react';
import styles from './StatusMark.module.css';

export type StatusTone = 'success' | 'info' | 'danger' | 'warning' | 'neutral';

/**
 * The 3 x 3 pixel figure of a status (the identicon grammar of the project marks):
 * `full` done, `check` approved, `cross` failed or rejected, `pause` stopped, `orbit` running (the ring with one
 * lit pixel), `ring` waiting to start, `hourglass` waiting for review, `dot` draft.
 */
export type StatusShape = 'full' | 'check' | 'cross' | 'pause' | 'orbit' | 'ring' | 'hourglass' | 'dot';

export interface StatusMarkProps extends HTMLAttributes<HTMLSpanElement> {
  tone: StatusTone;
  shape: StatusShape;
  /** The status word; shown in sentence case. */
  label: string;
}

const ON: Record<StatusShape, readonly number[]> = {
  full: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  check: [2, 3, 5, 7],
  cross: [0, 2, 4, 6, 8],
  pause: [0, 2, 3, 5, 6, 8],
  orbit: [],
  ring: [],
  hourglass: [0, 1, 2, 4, 6, 7, 8],
  dot: [4],
};

/** Ring cells clockwise from the top left. */
const RING = [0, 1, 2, 5, 8, 7, 6, 3];

const CELL = 3;
const PITCH = 4;

/** Upper-cases the first letter only; the rest stays as the caller gives it (a span status "OK" stays "OK"). */
function sentenceCase(label: string): string {
  const text = label.trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * Lifecycle status: a 3 x 3 pixel figure and the word, no pill, no fill (DESIGN_LANGUAGE §3.3 "Status mark").
 * The figure is decorative (shape and colour are both cues); the word carries the meaning.
 */
export function StatusMark({ tone, shape, label, className, ...rest }: StatusMarkProps) {
  const on = new Set(ON[shape]);
  const ringed = shape === 'orbit' || shape === 'ring';
  return (
    <span
      className={[styles.mark, className].filter(Boolean).join(' ')}
      data-tone={tone}
      data-shape={shape}
      {...rest}
    >
      <svg
        className={styles.figure}
        viewBox="0 0 11 11"
        width="11"
        height="11"
        aria-hidden="true"
        focusable="false"
      >
        {Array.from({ length: 9 }, (_, i) => {
          const ring = RING.indexOf(i);
          return (
            <rect
              key={i}
              x={(i % 3) * PITCH}
              y={Math.floor(i / 3) * PITCH}
              width={CELL}
              height={CELL}
              rx={0.6}
              data-on={on.has(i) ? '' : undefined}
              data-ring={ringed && ring >= 0 ? '' : undefined}
            />
          );
        })}
      </svg>
      <span className={styles.label}>{sentenceCase(label)}</span>
    </span>
  );
}
