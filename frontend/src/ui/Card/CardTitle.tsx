import type { ReactNode } from 'react';
import styles from './CardTitle.module.css';

export interface CardTitleProps {
  title: ReactNode;
  /** One muted caption line directly below the title. */
  description?: ReactNode;
  /** Controls on the title row, at its end (a Select, a SegmentedControl, an Export button). */
  aside?: ReactNode;
  /** Heading level (default h3). */
  as?: 'h2' | 'h3' | 'h4' | 'h5';
  id?: string;
  className?: string;
}

/**
 * The card title role (cv4 F10, DESIGN_LANGUAGE §1 "Type scale"): the smallest of the three report title roles
 * (ReportSection > Subsection > CardTitle). The caption sits directly under the title; the aside sits on the title row.
 * Use it in `Card header` or as the first line of a card body. No local title size.
 */
export function CardTitle({ title, description, aside, as: Tag = 'h3', id, className }: CardTitleProps) {
  return (
    <div className={[styles.head, className].filter(Boolean).join(' ')} data-part="card-title">
      <div className={styles.text}>
        <Tag className={styles.title} id={id}>
          {title}
        </Tag>
        {description ? <p className={styles.desc}>{description}</p> : null}
      </div>
      {aside ? <div className={styles.aside}>{aside}</div> : null}
    </div>
  );
}
