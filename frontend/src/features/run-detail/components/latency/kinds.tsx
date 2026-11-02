/** Kind glyphs: the icon of each kind of work on a tint of its colour (legacy .lt-glyph). */
import { Icon, type IconName } from '@/ui';
import { FAMILY_TONE, PHASE_TONE, familyOf, type Family, type StepNode } from '../../lib/latencyModel';
import { cssVars } from './Tip';
import styles from './Traces.module.css';

export const FAMILY_ICON: Record<Family, IconName> = {
  LLM: 'brain',
  RETRIEVAL: 'retriever',
  TOOL: 'wrench',
  GUARD: 'guardrail',
  OTHER: 'settings',
  EVAL: 'star',
};

export function Glyph({ icon, tone, small }: { icon: IconName; tone: string; small?: boolean }) {
  return (
    <span
      className={styles.glyph}
      data-size={small ? 'sm' : undefined}
      style={cssVars({ '--tone': tone })}
      aria-hidden="true"
    >
      <Icon name={icon} size={small ? 12 : 14} />
    </span>
  );
}

/** The glyph of a Step timings row: the phase, the sub-agent, or the step's kind. */
export function nodeGlyph(node: StepNode): { icon: IconName; tone: string } {
  if (node.type === 'phase')
    return node.phase === 'eval'
      ? { icon: 'star', tone: PHASE_TONE.eval }
      : { icon: 'agent', tone: PHASE_TONE.task };
  if (node.type === 'agent') return { icon: 'agent', tone: 'var(--k-agent)' };
  const family = node.family ?? familyOf(node.kind);
  return { icon: FAMILY_ICON[family], tone: FAMILY_TONE[family] };
}
