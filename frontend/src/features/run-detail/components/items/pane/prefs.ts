/**
 * The item pane's choices for the session: which parts are open (Input, Expected, Output, the sections). One store for
 * every pane, so the next item opens as the reader left the last one. They live in sessionStorage: a new tab starts
 * from the defaults. (The Expected | Output splitter keeps its place in the platform SplitPane's own store.)
 */
import { useCallback, useSyncExternalStore } from 'react';

const subs = new Set<() => void>();
const memory = new Map<string, string | null>();

function read(key: string): string | null {
  if (memory.has(key)) return memory.get(key)!;
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  memory.set(key, value);
  try {
    if (value === null) window.sessionStorage.removeItem(key);
    else window.sessionStorage.setItem(key, value);
  } catch {
    // private mode or blocked storage: the choice lasts until the page reloads
  }
  subs.forEach((f) => f());
}

function subscribe(f: () => void) {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
}

/** A string choice of the session (null: the default). */
export function useSessionPref(key: string): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(subscribe, () => read(key));
  const set = useCallback((next: string | null) => write(key, next), [key]);
  return [value, set];
}

/** Whether a part of the pane is open. `fallback` is the part's default when the reader has not chosen. */
export function usePartOpen(part: string, fallback: boolean): [boolean, (open: boolean) => void] {
  const [value, set] = useSessionPref(`qym:item-pane:open:${part}`);
  const open = value === null ? fallback : value === 'open';
  const setOpen = useCallback((next: boolean) => set(next ? 'open' : 'closed'), [set]);
  return [open, setOpen];
}
