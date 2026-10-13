import { createContext, useContext, type ReactNode } from 'react';
import type { DataTableModel } from './useDataTableModel';
import type { Column } from './types';

export interface DataTableCtx {
  model: DataTableModel;
  /** Every column (including hidden ones). */
  columns: Column<never>[];
  selectedCount: number;
  clearSelection: () => void;
  bulkActions: ReactNode;
  isFiltered: boolean;
}

export const DataTableContext = createContext<DataTableCtx | null>(null);

export function useDataTableCtx(): DataTableCtx {
  const ctx = useContext(DataTableContext);
  if (!ctx) throw new Error('DataTable.Toolbar and DataTable.Footer must be children of DataTable');
  return ctx;
}
