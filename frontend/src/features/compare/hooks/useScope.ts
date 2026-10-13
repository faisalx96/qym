/** The compare scope for the page: chips, active flag and counts (brief 5.4), derived from the URL view. */
import { useMemo } from 'react';
import { useCompare } from '../CompareContext';
import { clearedView } from '../lib/activeChips';
import type { ChipEntry } from '../lib/activeChips';
import { compareScope } from '../lib/scope';

export function useScope() {
  const { c, model, defs, columns, items } = useCompare();
  const label = (key: string) => columns.find((col) => col.key === key)?.label ?? key;
  const scope = useMemo(
    () => compareScope(c.view, model, defs, label),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [c.view, model, defs, columns],
  );
  return {
    active: scope.active,
    chips: scope.chips,
    shown: items.length,
    total: model.itemIds.length,
    clearChip: (chip: ChipEntry) => c.setView(chip.clear(c.view)),
    clearAll: () => c.setView(clearedView()),
  };
}
