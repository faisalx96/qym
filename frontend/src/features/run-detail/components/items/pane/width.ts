/**
 * The width rule of an item pane that grows to its content (I16): the metrics table keeps every metric on one line,
 * so with several passes in view the pane widens by itself to the width the table needs. It never covers more than
 * `GROW_SHARE` of the page area behind it (the list stays in view), it never writes the reader's stored width, and it
 * gives the growth back when the content needs less (the reader's own width, or the default, again).
 */
import { createContext, useContext } from 'react';

/** The most of the page area (the list behind the pane) a width the reader did not choose may cover. */
export const GROW_SHARE = 0.75;

/** The widest the pane becomes by itself: 75% of the page area, so a quarter of the list stays in view. */
export function growCap(area: number): number {
  return Math.max(0, Math.floor(area * GROW_SHARE));
}

/**
 * The default width of a growing pane: the design's own width, at least `minWidth`, inside the same cap as the growth
 * and leaving `inView` px of the list (whichever leaves more of the list). `minWidth` wins over the cap.
 */
export function defaultPaneWidth(wanted: number, minWidth: number, area: number, inView: number): number {
  const hi = Math.min(area - inView, growCap(area));
  return Math.max(minWidth, Math.min(wanted, hi));
}

/**
 * The width the pane shows. `base` is the width without growth: the reader's stored width, else the default.
 * `need` is the width the content asks for (null: nothing asked). The pane grows to `need` up to the cap and never
 * below `base`; when the need drops (fewer passes in view) it is `base` again.
 */
export function paneWidth({ base, need, area }: { base: number; need: number | null; area: number }): number {
  if (need === null || !Number.isFinite(need) || need <= base) return base;
  return Math.max(base, Math.min(Math.ceil(need), growCap(area)));
}

/** What a part of a growing pane tells the pane: the width it needs (`key` names the layout the need is for). */
export interface PaneGrow {
  /** The pane element: the part measures what lies between the pane's edges and its own box. */
  pane: () => HTMLElement | null;
  /** The pane width this layout needs to show without a sideways scroll; null withdraws the need. */
  need: (key: string, px: number | null) => void;
}

export const PaneGrowContext = createContext<PaneGrow | null>(null);

/** The pane the part is in, when that pane grows to its content; null elsewhere (the Compare pane, a test). */
export function usePaneGrow(): PaneGrow | null {
  return useContext(PaneGrowContext);
}
