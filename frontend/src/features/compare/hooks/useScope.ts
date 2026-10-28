/** The compare scope for the page: chips, active flag and counts (brief 5.4), derived from the URL view. */
import { useMemo } from 'react';
import { useCompare } from '../CompareContext';
import { clearedView } from '../lib/activeChips';
import type { ChipEntry } from '../lib/activeChips';
import { columnName } from '../lib/columnName';
import { compareScope } from '../lib/scope';

export function useScope() {
  const { c, model, defs, columns, items } = useCompare();
  const scope = useMemo(
    () =>
      compareScope(
        c.view,
        model,
        defs,
        (key: string) => {
          const col = columns.find((x) => x.key === key);
          return col ? columnName(model, col) : key;
        },
      ),
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
