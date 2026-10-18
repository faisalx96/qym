/**
 * The three entities every run is about, written the same way everywhere (runs list, overview, charts, compare):
 *   task    mono tag in the meta tone
 *   dataset database glyph, name, version suffix (and alias tags)
 *   model   tag tinted with the model's series colour and its dot
 * and the run's own name (RunName): sans, a link when it has a target, mono only when the label is a bare id.
 * Long names truncate with an ellipsis and show in full as a tooltip.
 */
import type { FocusEventHandler, MouseEventHandler, PointerEventHandler, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../Icon';
import { Tag } from '../Tag';
import styles from './EntityTag.module.css';

export interface EntityTagBase {
  className?: string;
}

export function TaskTag({ name, className }: EntityTagBase & { name: string | null | undefined }) {
  if (!name) return <span className={styles.none}>—</span>;
  return (
    <Tag kind="task" title={name} className={[styles.entity, className].filter(Boolean).join(' ')}>
      <span className={styles.text}>{name}</span>
    </Tag>
  );
}

export function DatasetTag({
  name,
  version,
  aliases,
  className,
}: EntityTagBase & {
  name: string | null | undefined;
  version?: string | number | null;
  aliases?: string[] | null;
}) {
  if (!name) return <span className={styles.none}>—</span>;
  const v = version === null || version === undefined || version === '' ? null : String(version);
  const title = [name, v ? `version ${v}` : null, aliases?.length ? `aliases: ${aliases.join(', ')}` : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <span className={[styles.group, className].filter(Boolean).join(' ')}>
      <Tag kind="dataset" title={title} className={styles.entity}>
        <Icon name="database" size={12} />
        <span className={styles.text}>{name}</span>
        {v ? <span className={styles.version}>v{v.replace(/^v/i, '')}</span> : null}
      </Tag>
      {aliases?.map((a) => (
        <Tag key={a} className={styles.alias}>
          {a}
        </Tag>
      ))}
    </span>
  );
}

export function ModelTag({
  name,
  series,
  reasoning,
  mark,
  title,
  className,
}: EntityTagBase & {
  name: string;
  /** Series 1..8 (the model's colour everywhere); without one the tag is neutral. */
  series?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  reasoning?: boolean;
  /** Replaces the series dot (the runs list draws a shape for the 9th model onwards). */
  mark?: ReactNode;
  title?: string;
}) {
  return (
    <Tag
      kind="model"
      series={mark ? undefined : series}
      data-series={series}
      title={title ?? name}
      className={[styles.entity, className].filter(Boolean).join(' ')}
    >
      {mark}
      <span className={styles.text}>{name}</span>
      {reasoning ? <span className={styles.version}>reasoning</span> : null}
    </Tag>
  );
}

const BARE_ID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$|^[0-9a-f]{8,32}$/i;

/** True when a run label is only an identifier (no human name was given), so it reads in the mono face. */
export function isBareRunId(label: string, runId?: string): boolean {
  return label === runId || BARE_ID.test(label);
}

/** The run's name, written the same way on every surface (list, overview, admin, header, compare, analysis). */
export function RunName({
  name,
  runId,
  to,
  title,
  onClick,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onFocus,
  onBlur,
  className,
  ...rest
}: EntityTagBase & {
  name: string | null | undefined;
  runId?: string;
  to?: string;
  title?: string;
  onClick?: MouseEventHandler<HTMLAnchorElement>;
  onPointerEnter?: PointerEventHandler<HTMLAnchorElement>;
  onPointerLeave?: PointerEventHandler<HTMLAnchorElement>;
  onPointerDown?: PointerEventHandler<HTMLAnchorElement>;
  onFocus?: FocusEventHandler<HTMLAnchorElement>;
  onBlur?: FocusEventHandler<HTMLAnchorElement>;
  dir?: 'auto' | 'ltr' | 'rtl';
  lang?: string;
}) {
  const label = name || (runId ? runId.slice(0, 8) : '—');
  const cls = [styles.runName, className].filter(Boolean).join(' ');
  const id = isBareRunId(label, runId) ? '' : undefined;
  const tip = title ?? runId ?? label;
  if (!to) {
    return (
      <span className={cls} data-id={id} title={tip} {...rest}>
        {label}
      </span>
    );
  }
  return (
    <Link
      to={to}
      className={cls}
      data-id={id}
      title={tip}
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onPointerDown={onPointerDown}
      onFocus={onFocus}
      onBlur={onBlur}
      {...rest}
    >
      {label}
    </Link>
  );
}
