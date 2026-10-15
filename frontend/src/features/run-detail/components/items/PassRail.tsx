/** The pass rail of an item (round 3 P5): one chip per pass, number plus verdict glyph; a pass has no colour of its own. */
import { Chip } from '@/ui';
import type { StatusKind } from '../../lib/rowDisplay';
import { MAX_SHOWN_PASSES } from '../../lib/passSelection';
import styles from './OutputRegion.module.css';

export interface RailPass {
  pass: number;
  kind: StatusKind;
}

const GLYPH: Partial<Record<StatusKind, string>> = { pass: '✓', fail: '✕', error: '✕' };
const WORD: Partial<Record<StatusKind, string>> = { pass: 'passed', fail: 'failed', error: 'failed' };

export function PassRail({
  passes,
  selected,
  onToggle,
}: {
  passes: RailPass[];
  /** Selected passes (any order). */
  selected: number[];
  onToggle: (pass: number) => void;
}) {
  return (
    <div className={styles.rail} role="group" aria-label="Passes shown">
      {passes.map((p) => {
        const tone =
          p.kind === 'pass' ? 'success' : p.kind === 'fail' || p.kind === 'error' ? 'danger' : undefined;
        return (
          <Chip
            key={p.pass}
            tone={tone}
            isSelected={selected.includes(p.pass)}
            onChange={() => onToggle(p.pass)}
            aria-label={`Pass ${p.pass}, ${WORD[p.kind] ?? 'no verdict'}`}
          >
            <span className={styles.railChip}>
              <span className={styles.mono}>{p.pass}</span>
              <span aria-hidden="true">{GLYPH[p.kind] ?? '·'}</span>
            </span>
          </Chip>
        );
      })}
      <span className={styles.railHelp}>Select up to {MAX_SHOWN_PASSES} passes to read side by side.</span>
    </div>
  );
}
