/**
 * The item of a Sweep row, in the item pane of the compare page (ComparePane): the same frame, blocks and keys. The
 * pane steps through the Sweep table in its own order, and its header adds the passes of each cohort side.
 */
import { useMemo } from 'react';
import { useCompare } from '../../CompareContext';
import type { SweepItem } from '../../lib/cohort';
import type { FilteredItem } from '../../lib/filters';
import { itemOutcomes } from '../../lib/scoring';
import { ComparePane } from '../items/pane/ComparePane';
import { useItemsUi } from '../items/ItemsUi';
import { RunTag } from '../RunTag';
import styles from './SweepView.module.css';

/** The executions of one cohort side on one item: a dot for each run in the order of the side, then passes / runs. */
export function PassTrack({ passes }: { passes: boolean[] }) {
  const ok = passes.filter(Boolean).length;
  return (
    <span className={styles.passCell} data-part="sweep-pass-cell">
      <span className={styles.track} role="img" aria-label={`${ok} of ${passes.length} pass`}>
        {passes.map((p, i) => (
          <span key={i} className={styles.dot} data-pass={p || undefined} aria-hidden />
        ))}
      </span>
      <b aria-hidden>
        {ok}/{passes.length}
      </b>
    </span>
  );
}

/** A cohort side as the Sweep table shows it: the left column first. */
export interface SweepSide {
  /** The letter of the side: its runs carry it with a number (A1, A2). */
  letter: 'A' | 'B';
  label: string;
  passes: (item: SweepItem) => boolean[];
}

/** The id of the row element of an item: the pane brings it into view and gives the focus back to it. */
export const sweepRowId = (itemId: string) => `item-${itemId}`;

/** The item open in the pane: the last one opened, when the Sweep table shows it. */
export function useSweepOpen(items: SweepItem[]): { id: string | null; at: number } {
  const open = [...useItemsUi().expanded].pop() ?? null;
  const at = open === null ? -1 : items.findIndex((i) => i.itemId === open);
  return { id: at < 0 ? null : open, at };
}

/** The pane of the item opened last in the Sweep table. It shows nothing when no item is open. */
export function SweepPaneHost({ items, sides }: { items: SweepItem[]; sides: SweepSide[] }) {
  const { model, ctx, cohorts } = useCompare();
  const { at } = useSweepOpen(items);
  // The pane steps through this list: the Sweep table, as filtered and sorted. The Sweep table turns its own pages
  // (SweepView), so the pane does not turn the page of the compare list (`list` on ComparePane).
  const list = useMemo<FilteredItem[]>(
    () =>
      items.map((i) => {
        const { rows, scores } = itemOutcomes(model, i.itemId, ctx);
        return { itemId: i.itemId, rows, scores };
      }),
    [items, model, ctx],
  );
  const item = at < 0 ? undefined : items[at];
  if (!item) return null;
  const firstRunOf = (letter: 'A' | 'B') => {
    const refs = letter === 'A' ? cohorts?.left : cohorts?.right;
    return Math.max(
      0,
      model.runs.findIndex((r) => refs?.includes(r.ref)),
    );
  };
  return (
    <ComparePane
      list={list}
      item={list[at]!}
      at={at}
      pageSize={Math.max(1, items.length)}
      ident={
        <span className={styles.paneSides} data-part="sweep-pane-sides">
          {sides.map((side) => (
            <span
              key={side.letter}
              className={styles.paneSide}
              title={`Cohort ${side.letter}: ${side.label}`}
            >
              <RunTag index={firstRunOf(side.letter)} letter={side.letter} showName={false} bare />
              <span className={styles.srOnly}>{side.label}</span>
              <PassTrack passes={side.passes(item)} />
            </span>
          ))}
        </span>
      }
    />
  );
}
