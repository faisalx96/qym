import type { ReactNode } from 'react';
import { Card, type CardBand } from '../Card';
import { HelpMarker } from '../HelpMarker';
import styles from './StatTiles.module.css';

export interface StatTile {
  key: string;
  /** Short label (uppercase). */
  label: string;
  /** Long explanation behind the info marker after the label. */
  help?: string;
  value: ReactNode;
  /** One plain sentence under the value. */
  meaning: string;
  /** Score band of the value (direction-aware): colours the value and the bottom rail. */
  band?: CardBand;
  /** A danger value (errors above 0). */
  danger?: boolean;
}

export interface StatTilesProps {
  items: StatTile[];
  'aria-label': string;
}

/**
 * Stat tiles (DESIGN_LANGUAGE "Stat tiles"): seven or fewer equal, separate, centred tiles. Each tile is a passive
 * `Card compact` with a bottom rail in the value's band; no hover, no groups. The grid answers to the report column
 * (container queries): one row of N from 900px, 4 + 3 in a 12-column grid from 480px, 2 per row below that and a
 * wide last tile. Three tiles always share one row from 480px.
 */
export function StatTiles({ items, 'aria-label': label }: StatTilesProps) {
  return (
    <div className={styles.tiles} role="list" aria-label={label} data-count={items.length}>
      {items.map((t) => (
        <Card
          key={t.key}
          compact
          band={t.band}
          rail="bottom"
          className={styles.tile}
          role="listitem"
          data-tile={t.key}
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
          <span className={styles.meaning} data-part="meaning">
            {t.meaning}
          </span>
        </Card>
      ))}
    </div>
  );
}
