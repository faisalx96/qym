import { useMemo } from 'react';
import { identiconModel } from '@/lib/identicon';
import styles from './Identicon.module.css';

export interface IdenticonProps {
  seed: string;
  cell?: number;
  gap?: number;
  chip?: boolean;
  className?: string;
}

/** Deterministic 5x5 identicon for projects/datasets (shell.js identiconHTML). */
export function Identicon({ seed, cell = 10, gap = 3, chip, className }: IdenticonProps) {
  const model = useMemo(() => identiconModel(seed), [seed]);
  const radius = Math.max(1, Math.round(cell / 5));
  const mark = (
    <span
      className={[styles.mark, className].filter(Boolean).join(' ')}
      aria-hidden="true"
      style={{ gridTemplateColumns: `repeat(5, ${cell}px)`, gridAutoRows: `${cell}px`, gap }}
    >
      {model.rows.flatMap((row, r) =>
        row.map((color, c) => (
          <i key={`${r}-${c}`} style={{ borderRadius: radius, background: color ?? 'transparent' }} />
        )),
      )}
    </span>
  );
  if (!chip) return mark;
  const size = 5 * cell + 4 * gap + 6;
  return (
    <span className={styles.chip} aria-hidden="true" style={{ width: size, height: size }}>
      {mark}
    </span>
  );
}
