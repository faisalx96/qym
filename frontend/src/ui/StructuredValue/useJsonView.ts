import { useCallback, useSyncExternalStore } from 'react';

export type JsonView = 'sections' | 'raw';
const KEY = 'qym:json-view';
const listeners = new Set<() => void>();
let memory: JsonView = 'sections';

function read(): JsonView {
  try {
    const v = window.localStorage.getItem(KEY);
    return v === 'raw' ? 'raw' : 'sections';
  } catch {
    /* storage can be blocked: the preference is a convenience */
  }
  return memory;
}

/** The Sections | Raw preference, shared by every StructuredValue on the page (localStorage `qym:json-view`). */
export function useJsonView(): [JsonView, (v: JsonView) => void] {
  const view = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    read,
    () => 'sections' as JsonView,
  );
  const set = useCallback((v: JsonView) => {
    memory = v;
    try {
      window.localStorage.setItem(KEY, v);
    } catch {
      /* ignore */
    }
    listeners.forEach((l) => l());
  }, []);
  return [view, set];
}
