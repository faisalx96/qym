import type { ReactNode } from 'react';
import type { CardBand } from '../Card';
import { HelpMarker } from '../HelpMarker';
import styles from './StatTiles.module.css';

export interface StatTile {
  key: string;
  /** Short label (uppercase). */
  label: string;
  /** Long explanation behind the info marker after the label. */
  help?: string;
  value: ReactNode;
  /** One plain sentence: the cell's tooltip and accessible description (not drawn). */
  meaning: string;
  /** Score band of the value (direction-aware): colours the value. */
  band?: CardBand;
  /** A danger value (errors above 0). */
  danger?: boolean;
}

export interface StatTilesProps {
  items: StatTile[];
  'aria-label': string;
}

/**
 * Stat tiles (DESIGN_LANGUAGE "Stat tiles", owner 2026-11-18: the first qym's tiles): seven or fewer separate framed
 * tiles, each a centred uppercase label with its help marker over a large value in its band colour; a banded tile
 * draws the band colour as a rail along its bottom edge. The help marker explains the figure, so no sentence sits
 * under the value (`meaning` is the tile's tooltip and accessible description). No hover. The row answers to the
 * report column (container queries): one row of N from 900px, 4 + 3 from 480px, 2 per row below that.
 */
export function StatTiles({ items, 'aria-label': label }: StatTilesProps) {
  return (
    <div className={styles.tiles} role="list" aria-label={label} data-count={items.length}>
      {items.map((t) => (
        <div
          key={t.key}
          className={styles.tile}
          role="listitem"
          data-tile={t.key}
          data-band={t.band}
          title={t.meaning}
        >
          <span className={styles.label} data-part="label">
            <span>{t.label}</span>
            {t.help ? <HelpMarker label={t.label}>{t.help}</HelpMarker> : null}
          </span>
          <span
            className={styles.value}
            data-part="value"
            data-band={t.band}
            data-danger={t.danger ? '' : undefined}
          >
            {t.value}
          </span>
          <span className={styles.srOnly} data-part="meaning">
            {t.meaning}
          </span>
        </div>
      ))}
    </div>
  );
}
