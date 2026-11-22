/**
 * Kind glyphs: the icon of each kind of work on a tint of its colour, as the trace drawer draws a span's kind (the
 * colours and icons are traces/spanKinds.ts, the one source for the trace and the Latency tab).
 */
import { Icon, type IconName } from '@/ui';
import { FAMILY_ICON } from '../../lib/latencyModel';
import { cssVars } from './Tip';
import styles from './Traces.module.css';

export { FAMILY_ICON };

/** A 24px tile (a kind card's head), or the trace drawer's 20px tile (`small`, a Step timings row). */
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
