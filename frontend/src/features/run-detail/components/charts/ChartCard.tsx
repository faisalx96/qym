/**
 * ChartCard (round 3 P1): the one card every chart on the run page lives in. A `Card fill` with a header slot
 * (title on the left; meta, legend and the card's own controls on the right) and the plot as its body. The plot slot
 * is at least 146px high and grows with a grid-stretched card, so extra height goes to the plot, never to empty space.
 */
import type { ReactNode } from 'react';
import { Card, type CardBand, type CardSeries, type CardTone } from '@/ui';
import styles from './ChartCard.module.css';

export interface ChartCardProps {
  /** Card title (also the section's accessible name). */
  title: string;
  /** Accessible name of the card when it differs from the visible title (default: the title). */
  ariaLabel?: string;
  /** Native tooltip of the title (e.g. the metric's direction). */
  titleHint?: string;
  /** Right of the title: a count Tag, a caption. */
  meta?: ReactNode;
  /** Right of the title: a legend. */
  legend?: ReactNode;
  /** Right of the title: the card's own controls (a 24px SegmentedControl). */
  controls?: ReactNode;
  /** Value and notes above the plot (a score and its error note). */
  intro?: ReactNode;
  /** Text under the plot inside the card (a caption). */
  caption?: ReactNode;
  band?: CardBand;
  tone?: CardTone;
  series?: CardSeries;
  /** The slot is a bar plot (min-height 146px, centred); false for a plot that sizes itself. */
  slot?: boolean;
  className?: string;
  children: ReactNode;
  'data-testid'?: string;
  'data-metric'?: string;
}

export function ChartCard({
  title,
  ariaLabel,
  titleHint,
  meta,
  legend,
  controls,
  intro,
  caption,
  band,
  tone,
  series,
  slot = true,
  className,
  children,
  ...rest
}: ChartCardProps) {
  return (
    <Card
      as="section"
      fill
      aria-label={ariaLabel ?? title}
      band={band}
      tone={tone}
      series={series}
      className={[styles.chartCard, className].filter(Boolean).join(' ')}
      header={
        <div className={styles.head}>
          <span className={styles.title} title={titleHint}>
            {title}
          </span>
          {legend || controls || meta ? (
            <span className={styles.headRight}>
              {legend}
              {controls}
              {meta}
            </span>
          ) : null}
        </div>
      }
      {...rest}
    >
      {intro ? <div className={styles.intro}>{intro}</div> : null}
      <div className={styles.slot} data-slot={slot ? 'plot' : 'free'}>
        {children}
      </div>
      {caption ? <div className={styles.caption}>{caption}</div> : null}
    </Card>
  );
}
