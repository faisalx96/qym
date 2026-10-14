import { useState, type CSSProperties } from 'react';
import { TextBlock, type TextBlockProps } from '../TextBlock';
import styles from './StructuredValue.module.css';

export interface ClampedTextProps extends Omit<TextBlockProps, 'text'> {
  text: string;
  /** Lines shown before "Show more" (default 12). */
  lines?: number;
}

/** Long text clamps to `lines` lines with a Show more / Show less toggle. */
export function ClampedText({ text, lines = 12, ...rest }: ClampedTextProps) {
  const [open, setOpen] = useState(false);
  const long = text.length > lines * 60 || text.split('\n').length > lines;
  const clamp = long && !open;
  return (
    <div className={styles.clampHost}>
      <div
        className={clamp ? styles.clamped : undefined}
        style={clamp ? ({ '--lines': lines } as CSSProperties) : undefined}
      >
        <TextBlock text={text} {...rest} />
      </div>
      {long ? (
        <button type="button" className={styles.more} aria-expanded={open} onClick={() => setOpen(!open)}>
          {open ? 'Show less' : 'Show more'}
        </button>
      ) : null}
    </div>
  );
}
