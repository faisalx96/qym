/**
 * The last breadcrumb of a detail page ("Experiments / <name>"): the page that loaded the name publishes it,
 * the shell's breadcrumb trail reads it. Only the mounted page's label is kept.
 */
import { useEffect, useSyncExternalStore } from 'react';

let current = '';
const listeners = new Set<() => void>();

function set(next: string) {
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

/** Publish `label` as the page's last crumb while mounted (empty or missing publishes nothing). */
export function useCrumbLabel(label: string | null | undefined): void {
  useEffect(() => {
    if (!label) return;
    set(label);
    return () => {
      if (current === label) set('');
    };
  }, [label]);
}

/** The label the mounted page published ('' when none). */
export function useCurrentCrumbLabel(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => '',
  );
}
