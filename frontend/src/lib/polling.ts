/** Visibility-aware polling (qym_live.js): pauses when the tab is hidden. */
import { useEffect, useState } from 'react';

export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() =>
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden',
  );
  useEffect(() => {
    const on = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
}

/** TanStack `refetchInterval` value: `false` while hidden. */
export function usePollingInterval(ms: number): number | false {
  const visible = usePageVisible();
  return visible ? ms : false;
}
