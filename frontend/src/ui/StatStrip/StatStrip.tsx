import type { CSSProperties, ReactNode } from 'react';
import { HelpMarker } from '../HelpMarker';
import { useFlashOnChange } from '../motion';
import styles from './StatStrip.module.css';

export type StatTone = 'accent' | 'info' | 'success' | 'warning' | 'danger' | 'meta' | 'neutral';

export interface StatTrend {
  /** Signed change (any unit; shown through `label`). */
  delta: number;
  /** Colour of the change: good, bad, or flat (within noise). The caller decides, direction-aware. */
  verdict: 'good' | 'bad' | 'flat';
  /** Text for the pill, e.g. "+4.2 pts". */
  label: string;
}

export interface StatStripItem {
  key?: string;
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  help?: string;
  /** Rendered in a 24px tile tinted from `tone` (muted when there is no tone). */
  icon?: ReactNode;
  /** Colours the icon tile only; the number stays --text-primary (D-29, resolution 3). */
  tone?: StatTone;
  /** A change pill under the value (arrow, sign and label: colour is never the only cue). */
  trend?: StatTrend;
  /** Makes the cell a button (e.g. filter by this stat) with hover, pressed and selected states. */
  onPress?: () => void;
  isSelected?: boolean;
  /** 0..1: a thin bar under the value (tone-coloured, or `barBand` when set). */
  bar?: number;
  /** Score band 1..5 for the bar (direction-aware, from `metricBand`); without it the bar takes `tone`. */
  barBand?: 1 | 2 | 3 | 4 | 5;
  /** Group label: consecutive items sharing a group sit under one small heading, groups divided by a hairline. */
  group?: string;
  /** Extra data-* attributes on the cell (test and e2e hooks, e.g. data-live-service). */
  data?: Record<`data-${string}`, string>;
}

export interface StatStripProps {
  items: StatStripItem[];
  variant?: 'band' | 'compact-header' | 'compact' | 'mini';
  /** Flash a faint tint on a cell whose value changed (live runs). */
  live?: boolean;
  'aria-label'?: string;
}

const ARROW = { good: '▲', bad: '▼', flat: '≈' } as const;

/** A label and its help marker; the marker stays on the line of the last word when the label wraps (E-52). */
function LabelWithHelp({ label, help }: { label: ReactNode; help: string }) {
  const marker = <HelpMarker label={String(label)}>{help}</HelpMarker>;
  if (typeof label !== 'string' || !label.includes(' '))
    return (
      <span className={styles.labelTail}>
        <span>{label}</span>
        {marker}
      </span>
    );
  const cut = label.lastIndexOf(' ') + 1;
  return (
    <>
      <span>{label.slice(0, cut)}</span>
      <span className={styles.labelTail}>
        <span>{label.slice(cut)}</span>
        {marker}
      </span>
    </>
  );
}

function Cell({ item, live, variant }: { item: StatStripItem; live: boolean; variant: string }) {
  const flat = typeof item.value === 'string' || typeof item.value === 'number' ? item.value : null;
  const flash = useFlashOnChange(flat, live);
  if (variant === 'mini') {
    // D-29 mini: the label, then the tile and the number; no help, sub-line, bar, trend or press.
    return (
      <div className={styles.item} data-tone={item.tone} data-variant={variant} {...item.data}>
        <span className={styles.label}>{item.label}</span>
        <span className={styles.miniRow}>
          {item.icon ? (
            <span className={styles.icon} aria-hidden="true">
              {item.icon}
            </span>
          ) : null}
          <span className={styles.value} data-changed={flash ? '' : undefined}>
            {item.value}
          </span>
        </span>
      </div>
    );
  }
  const body = (
    <>
      {item.icon ? (
        <span className={styles.icon} aria-hidden="true">
          {item.icon}
        </span>
      ) : null}
      <span className={styles.stack}>
        <span className={styles.label}>
          {item.help && !item.onPress ? (
            <LabelWithHelp label={item.label} help={item.help} />
          ) : (
            <span>{item.label}</span>
          )}
        </span>
        <span className={styles.value} data-changed={flash ? '' : undefined}>
          {item.value}
        </span>
        {item.bar !== undefined ? (
          <span
            className={styles.bar}
            data-band={item.barBand}
            style={{ '--bar': `${Math.round(Math.min(1, Math.max(0, item.bar)) * 100)}%` } as CSSProperties}
            aria-hidden="true"
          />
        ) : null}
        {item.trend ? (
          <span className={styles.trend} data-verdict={item.trend.verdict}>
            <span aria-hidden="true">{ARROW[item.trend.verdict]}</span>
            <span>{item.trend.label}</span>
          </span>
        ) : null}
        {item.sub ? <span className={styles.sub}>{item.sub}</span> : null}
      </span>
    </>
  );
  const common = { 'data-tone': item.tone, 'data-variant': variant, ...item.data };
  if (item.onPress) {
    return (
      <div className={styles.item} {...common} data-selected={item.isSelected ? '' : undefined}>
        <button
          type="button"
          className={styles.press}
          onClick={item.onPress}
          aria-pressed={item.isSelected === undefined ? undefined : item.isSelected}
        >
          {body}
        </button>
        {item.help ? (
          <span className={styles.help}>
            <HelpMarker label={String(item.label)}>{item.help}</HelpMarker>
          </span>
        ) : null}
      </div>
    );
  }
  return (
    <div className={styles.item} {...common}>
      {body}
    </div>
  );
}

/** Connected statistics band (DESIGN_LANGUAGE §3 "Connected statistics"). */
export function StatStrip({ items, variant = 'band', live = false, ...rest }: StatStripProps) {
  if (items.some((i) => i.group)) {
    const groups: { name: string; items: StatStripItem[] }[] = [];
    for (const item of items) {
      const name = item.group ?? '';
      const last = groups[groups.length - 1];
      if (last && last.name === name) last.items.push(item);
      else groups.push({ name, items: [item] });
    }
    return (
      <div className={styles.strip} data-variant={variant} data-grouped="" role="group" {...rest}>
        {groups.map((g, gi) => (
          <div
            key={`${g.name}-${gi}`}
            className={styles.group}
            role="group"
            aria-label={g.name || undefined}
            style={{ flexGrow: g.items.length }}
          >
            {g.name ? <span className={styles.groupLabel}>{g.name}</span> : null}
            <div className={styles.groupCells}>
              {g.items.map((item, i) => (
                <Cell key={item.key ?? i} item={item} live={live} variant={variant} />
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className={styles.strip} data-variant={variant} role="group" {...rest}>
      {items.map((item, i) => (
        <Cell key={item.key ?? i} item={item} live={live} variant={variant} />
      ))}
    </div>
  );
}
