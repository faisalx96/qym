/** Performance home: a time in a stat value, its unit glyph tight on the number (§3.3 "48.0s"), then quiet words. */
import type { ReactNode } from 'react';
import { secs } from '../../lib/format';
import { Quantity } from '../shared';

export function Seconds({ ms, digits, after }: { ms: number | null; digits?: number; after?: ReactNode }) {
  const text = secs(ms, digits);
  const value = text.endsWith('s') ? <Quantity value={text.slice(0, -1)} unit="s" tight /> : text;
  return after ? <Quantity value={value} unit={after} /> : <>{value}</>;
}
