/**
 * The iconography of the trace view for a fact about a trace (spans, duration, tokens, calls, errors): the icon of
 * the kind of work on a tint of its colour, the glyph of a span row in the trace tree. One place for the item pane's
 * Execution section and the trace drawer's summary, so a fact looks the same in both.
 */
import type { ComponentProps, CSSProperties } from 'react';
import { Icon, type IconName, type StatStripItem } from '@/ui';
import { KIND_ICON, KIND_TONE } from './spanKinds';
import styles from './factIcons.module.css';

interface FactLook {
  icon: IconName;
  /** A colour token (`var(--…)`): the kind colour of the trace view, or the status colour of a problem. */
  tone: string;
}

/** The look of each fact, by its key. A key that is not here has no icon. */
export const FACT_LOOK: Record<string, FactLook> = {
  spans: { icon: 'list', tone: 'var(--text-muted)' },
  duration: { icon: 'clock', tone: 'var(--info)' },
  latency: { icon: 'clock', tone: 'var(--info)' },
  tokens: { icon: 'zap', tone: KIND_TONE.LLM },
  cost: { icon: 'diamond', tone: 'var(--success)' },
  llm: { icon: KIND_ICON.LLM, tone: KIND_TONE.LLM },
  tools: { icon: KIND_ICON.TOOL, tone: KIND_TONE.TOOL },
  attempts: { icon: 'retry', tone: 'var(--text-muted)' },
  retries: { icon: 'retry', tone: 'var(--warning)' },
  'tool-errors': { icon: 'warning', tone: 'var(--error)' },
  provider: { icon: 'warning', tone: 'var(--error)' },
  errors: { icon: 'warning', tone: 'var(--error)' },
  orphans: { icon: KIND_ICON.CHAIN, tone: 'var(--warning)' },
};

/** The tinted glyph tile of the trace view (20px in a span row, the stat strip's 24px tile here). */
export function FactGlyph({
  icon,
  tone,
  size = 14,
}: FactLook & { size?: ComponentProps<typeof Icon>['size'] }) {
  return (
    <span className={styles.glyph} style={{ '--tone': tone } as CSSProperties} aria-hidden="true">
      <Icon name={icon} size={size} />
    </span>
  );
}

/**
 * Stat strip items with the trace view's glyph before each label. A count of problems that is zero ("Tool errors 0")
 * takes the muted look: only a real problem is red.
 */
export function withFactIcons(items: StatStripItem[]): StatStripItem[] {
  return items.map((item) => {
    const look = item.key ? FACT_LOOK[item.key] : undefined;
    if (!look) return item;
    const calm = look.tone === 'var(--error)' && (item.value === '0' || item.value === 0);
    return {
      ...item,
      icon: <FactGlyph icon={look.icon} tone={calm ? 'var(--text-muted)' : look.tone} />,
    };
  });
}
