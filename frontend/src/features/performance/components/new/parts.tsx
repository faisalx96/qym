/**
 * New run: the small pieces several steps share (the checks list, the three-part bar, the kind and environment
 * tags, the sign-in tag, and the option boxes).
 */
import type { ReactNode } from 'react';
import { Radio, RadioGroup as AriaRadioGroup, type RadioProps } from 'react-aria-components';
import type { PerformanceCheckTone, PerformanceSetupTarget, PerformanceTier } from '@/api/performance';
import { LevelTag } from '@/features/feedback/badges';
import { StateTag, type StateTagTone } from '@/ui';
import { KINDS, KIND_LEVEL } from '../../lib/format';
import styles from './newRun.module.css';

const CHECK: Record<PerformanceCheckTone, [StateTagTone, string]> = {
  ok: ['success', 'OK'],
  warn: ['warning', 'Warning'],
  bad: ['danger', 'Problem'],
};

export interface CheckLine {
  tone: PerformanceCheckTone;
  message: string;
  /** The word of the tag when it is not the tone's own (the upload's "Left out", "Changed"). */
  label?: string;
}

/** One line per check: what kind it is, as a tag, and one sentence. */
export function Checks({ items }: { items: CheckLine[] }) {
  return (
    <ul className={styles.checks} data-performance-block="checks">
      {items.map((item) => (
        <li key={item.message} data-performance-check={item.tone}>
          <StateTag tone={CHECK[item.tone][0]}>{item.label ?? CHECK[item.tone][1]}</StateTag>
          <span>{item.message}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * A kind of question is a complexity (DESIGN_LANGUAGE §3.3 "Level tag", `KIND_LEVEL`): simple low (grey), medium
 * orange, complex red. The tag, the bar and every legend of this page use the same three levels.
 */
const KIND_TONE: Record<PerformanceTier, 'neutral' | 'warning' | 'danger'> = {
  simple: 'neutral',
  medium: 'warning',
  complex: 'danger',
};

/** '30 simple' as a Level tag: the three level bars, then the count and the kind. */
export function KindCount({ kind, value }: { kind: PerformanceTier; value: number | string }) {
  return <LevelTag level={KIND_LEVEL[kind]} label={String(value)} value={kind} />;
}

/** A bar in three parts, one per kind, as wide as its share, in the kind's level colour. A kind at 0 has no part. */
export function MixBar({ mix, unit = '' }: { mix: Record<PerformanceTier, number>; unit?: string }) {
  return (
    <span
      className={styles.mixBar}
      role="img"
      aria-label={KINDS.map((kind) => `${mix[kind]}${unit} ${kind}`).join(', ')}
    >
      {KINDS.filter((kind) => mix[kind] > 0).map((kind) => (
        <span key={kind} data-tone={KIND_TONE[kind]} style={{ flexGrow: mix[kind], flexBasis: 0 }} />
      ))}
    </span>
  );
}

/** Whether the run can sign in on a target: the same words and tones on every step and page. */
export function SignInTag({ target }: { target: PerformanceSetupTarget }) {
  const expired = target.tokens.some((token) => token.name === 'refresh_token' && token.expired);
  return (
    <StateTag tone={target.sign_in_ready ? 'success' : 'warning'}>
      {target.sign_in_ready ? 'Sign-in saved' : expired ? 'Sign-in ran out' : 'No sign-in saved'}
    </StateTag>
  );
}

/** 'https://host.example.org' -> 'host.example.org': the host of an address, for display. */
export function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/^[a-z]+:\/\//i, '');
  }
}

/**
 * A group of option boxes (DESIGN_LANGUAGE "Option box") on React Aria's RadioGroup: one tab stop, the Arrow keys
 * move to the next box that can be chosen, round the ends, and choose it. A child that is not an `OptionBox` (the
 * "Add a target" box) is its own tab stop after the group's.
 */
export function OptionGroup({
  label,
  value,
  onChange,
  columns,
  children,
}: {
  label: string;
  value: string | null;
  onChange: (value: string) => void;
  /** Two boxes to a row instead of as many as fit. */
  columns?: 2;
  children: ReactNode;
}) {
  return (
    <AriaRadioGroup
      aria-label={label}
      value={value}
      onChange={onChange}
      className={styles.options}
      data-columns={columns}
    >
      {children}
    </AriaRadioGroup>
  );
}

/** One option box: a React Aria Radio drawn as the selectable box (selected = accent border, rail and tint). */
export function OptionBox(props: Omit<RadioProps, 'className' | 'style'>) {
  return <Radio {...props} className={styles.option} />;
}
