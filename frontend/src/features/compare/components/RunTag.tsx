/**
 * Run identity for the whole compare page: a colour swatch, the letter (the unique key beyond 8 runs and for
 * colour-blind readers) and the run's name. Hovering or focusing a tag highlights that run everywhere
 * (SeriesHighlightRoot dims every `[data-mark][data-series]` of another run).
 */
import type { CSSProperties, FocusEvent } from 'react';
import { isBareRunId, useSeriesHighlight } from '@/ui';
import { letterOf, runColor, runSeries } from '../CompareContext';
import styles from './RunTag.module.css';

/** Props that make an element part of the run-focus linking: it dims when another run is hovered or focused. */
export function useRunMark(index: number) {
  const handlers = useSeriesHighlight(runSeries(index));
  return {
    'data-mark': '',
    'data-series': runSeries(index),
    ...handlers,
    // Keyboard focus highlights the run; a mouse click that leaves focus behind does not hold the dimming.
    onFocus: (e: FocusEvent<HTMLElement>) => {
      if (e.target.matches(':focus-visible')) handlers.onFocus();
    },
  };
}

export interface RunTagProps {
  /** Position of the run among the compared runs (palette and letter). */
  index: number;
  name?: string;
  /** Show the letter (default true). */
  showLetter?: boolean;
  /** Show the name (default true when given). */
  showName?: boolean;
  baseline?: boolean;
  compact?: boolean;
  /** Full label for the tooltip. */
  title?: string;
  /** Inside an element that already carries `useRunMark`: no marks or handlers of its own. */
  bare?: boolean;
  className?: string;
}

function Inner({
  index,
  name,
  showLetter = true,
  showName = true,
  baseline,
  compact,
  title,
  className,
  rest,
}: RunTagProps & { rest: object }) {
  return (
    <span
      className={[styles.tag, className].filter(Boolean).join(' ')}
      data-compact={compact ? '' : undefined}
      data-testid="run-tag"
      title={title ?? name}
      {...rest}
    >
      <span className={styles.swatch} style={{ background: runColor(index) } as CSSProperties} aria-hidden />
      {showLetter ? <span className={styles.letter}>{letterOf(index)}</span> : null}
      {showName && name ? <span className={styles.name} data-id={isBareRunId(name) ? '' : undefined}>
          {name}
        </span> : null}
      {baseline ? (
        <span className={styles.star} role="img" aria-label="baseline">
          {'★'}
        </span>
      ) : null}
    </span>
  );
}

function Marked(props: RunTagProps) {
  const mark = useRunMark(props.index);
  return <Inner {...props} rest={mark} />;
}

export function RunTag(props: RunTagProps) {
  return props.bare ? <Inner {...props} rest={{}} /> : <Marked {...props} />;
}
