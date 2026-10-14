import type { ReactNode } from 'react';
import styles from './KeyValueGrid.module.css';

export type KeyValueKind = 'default' | 'config' | 'metadata';
export type KeyValueTone = 'success' | 'info' | 'warning' | 'danger' | 'accent' | 'meta' | 'neutral';

export interface KeyValueItem {
  key: string;
  label?: ReactNode;
  value: ReactNode;
  mono?: boolean;
  /** What the key is: `config` and `metadata` are definition metadata, so they get a meta (purple) label dot and a kind suffix. */
  kind?: KeyValueKind;
  /** Tints the tile (variant 'tiles') and the label dot from an information tone. */
  tone?: KeyValueTone;
  /** A 16px glyph before the label. */
  icon?: ReactNode;
}

export interface KeyValueGridProps {
  items: KeyValueItem[];
  columns?: 1 | 2 | 3;
  dense?: boolean;
  /** 'plain' (default) or 'tiles': each pair on a --bg-elevated tile at card rhythm (the run "Execution context"). */
  variant?: 'plain' | 'tiles';
  'aria-label'?: string;
}

const KIND_LABEL: Record<KeyValueKind, string | null> = {
  default: null,
  config: 'Config',
  metadata: 'Metadata',
};

/** Definition grid for versioning details, account info, etc. */
export function KeyValueGrid({ items, columns = 2, dense, variant = 'plain', ...rest }: KeyValueGridProps) {
  return (
    <dl
      className={styles.grid}
      data-columns={columns}
      data-dense={dense ? '' : undefined}
      data-variant={variant === 'tiles' ? 'tiles' : undefined}
      {...rest}
    >
      {items.map((item) => {
        const kind = item.kind && item.kind !== 'default' ? item.kind : undefined;
        const tone = item.tone ?? (kind ? 'meta' : undefined);
        return (
          <div key={item.key} className={styles.item} data-kind={kind} data-tone={tone}>
            <dt className={styles.label}>
              {item.icon ? (
                <span className={styles.icon} aria-hidden="true">
                  {item.icon}
                </span>
              ) : null}
              <span>{item.label ?? item.key}</span>
              {kind ? <span className={styles.kind}>{KIND_LABEL[kind]}</span> : null}
            </dt>
            <dd className={styles.value} data-mono={item.mono ? '' : undefined}>
              {item.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
