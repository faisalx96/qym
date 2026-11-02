/** `localStorage qym:report-sidebar-hidden`: the reader chose to hide the quick-filter sidebar while a scope is active (run and compare share it). */
import { useCallback, useState } from 'react';
import { readLocal, writeLocal } from './storage';

export const SIDEBAR_HIDDEN_KEY = 'qym:report-sidebar-hidden';

export function useSidebarHidden(): [boolean, (hidden: boolean) => void] {
  const [hidden, setHidden] = useState(() => readLocal(SIDEBAR_HIDDEN_KEY) === '1');
  const set = useCallback((next: boolean) => {
    setHidden(next);
    writeLocal(SIDEBAR_HIDDEN_KEY, next ? '1' : null);
  }, []);
  return [hidden, set];
}
