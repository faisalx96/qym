/** UI state shared by the items table, cards and heatmap (text mode, hidden columns, expansion, highlight, trace opener). */
import { createContext, useContext } from 'react';
import type { TextMode } from '@/lib/text';
import type { ItemDetailsApi } from '../../hooks/useItemDetails';

export interface ItemsUiValue {
  textMode: TextMode;
  hiddenFields: Set<string>;
  hiddenMetricFields: Set<string>;
  details: ItemDetailsApi;
  expanded: Set<string>;
  toggleExpanded: (itemId: string, open?: boolean) => void;
  highlight: string | null;
  openTrace: (itemId: string, pass: number | null) => void;
  /** Item the table must bring into view once its row is mounted. */
  scrollTarget: string | null;
  requestScroll: (itemId: string) => void;
  clearScroll: () => void;
}

export const ItemsUi = createContext<ItemsUiValue | null>(null);

export function useItemsUi(): ItemsUiValue {
  const v = useContext(ItemsUi);
  if (!v) throw new Error('useItemsUi outside <ItemsSection>');
  return v;
}
