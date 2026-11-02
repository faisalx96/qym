/** Item state (disabled items) text and URL rules: A2-2, A2-3, A2-6, A2-36, A2-40. */
import type { ItemState, ItemStateCounts } from '@/api/datasets';

export type StateFilter = ItemState;
export const STATE_OPTIONS: { id: StateFilter; label: string }[] = [
  { id: 'active', label: 'Active' },
  { id: 'disabled', label: 'Disabled' },
  { id: 'all', label: 'All' },
];

/** The URL value of a state: `active` is the default and is omitted. */
export function stateUrlValue(state: StateFilter): string | undefined {
  return state === 'active' ? undefined : state;
}

/** The count shown in a state option; undefined while the list has no counts yet. */
export function stateCount(counts: ItemStateCounts | undefined, state: StateFilter): number | undefined {
  return counts ? counts[state] : undefined;
}

export function pluralItems(n: number): string {
  return n === 1 ? '1 item' : `${n} items`;
}

/** "124 items" for the selected state (A2-6). */
export function stateTotalText(
  state: StateFilter,
  counts: ItemStateCounts | undefined,
  total: number,
): string {
  return pluralItems(counts ? counts[state] : total);
}

/** "130 items (6 disabled)" (A2-36); "130 items" without disabled items. */
export function versionItemsText(itemCount: number, disabledCount: number | undefined): string {
  const base = pluralItems(itemCount);
  return disabledCount && disabledCount > 0 ? `${base} (${disabledCount} disabled)` : base;
}

/** The note of the publish dialog (A2-40); empty when nothing is disabled. */
export function publishDisabledNote(disabledCount: number, version: string): string {
  if (disabledCount <= 0) return '';
  return disabledCount === 1
    ? `1 item is disabled. Runs on ${version} skip it.`
    : `${disabledCount} items are disabled. Runs on ${version} skip them.`;
}
