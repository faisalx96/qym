import type { HTMLAttributes, ReactNode } from 'react';
import styles from './Tag.module.css';

export type TagKind =
  'role' | 'accent' | 'count' | 'data' | 'version' | 'task' | 'config' | 'dataset' | 'model' | 'origin';
export type TagTone = 'success' | 'info' | 'warning' | 'danger' | 'meta' | 'accent';

export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  kind?: TagKind;
  tone?: TagTone;
  /** Series 1..8: `kind="model"` renders this series' dot before the label. */
  series?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  children: ReactNode;
}

/** Tone implied by a kind: task, version and config describe what was run, so they share the meta (purple) tone. */
const KIND_TONE: Partial<Record<TagKind, TagTone>> = {
  role: 'accent',
  accent: 'accent',
  version: 'meta',
  task: 'meta',
  config: 'meta',
};

/** Role/metadata tag: borderless, --control-radius, tinted fill; mono for role/count/data/version/task/config. */
export function Tag({ kind, tone, series, className, children, ...rest }: TagProps) {
  const resolved = tone ?? (kind ? KIND_TONE[kind] : undefined);
  return (
    <span
      className={[styles.tag, className].filter(Boolean).join(' ')}
      data-kind={kind}
      data-tone={resolved}
      {...rest}
    >
      {kind === 'model' && series ? (
        <span className={styles.dot} data-series={series} aria-hidden="true" />
      ) : null}
      {children}
    </span>
  );
}
