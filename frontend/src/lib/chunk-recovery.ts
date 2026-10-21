/**
 * Recover from a stale bundle. After a deploy the hashed chunks and stylesheets an open tab's `index.html` names are
 * gone, so the next lazy route fails with "Unable to preload CSS for …" or "Failed to fetch dynamically imported
 * module". The only fix is a fresh `index.html`: reload the page once. A second failure inside a minute (the server
 * really lacks the file) is shown as an error instead of looping.
 */

const STORAGE_KEY = 'qym.chunk-reload-at';
const RELOAD_WINDOW_MS = 60_000;
/** Chromium, Firefox and Safari wording for a missing chunk, plus Vite's own preload helper. */
const CHUNK_ERROR_PATTERNS = [
  /Unable to preload CSS/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
  /Loading (CSS )?chunk [^ ]+ failed/i,
];

export interface ChunkRecoveryDeps {
  now: () => number;
  reload: () => void;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
}

function defaultDeps(): ChunkRecoveryDeps {
  let storage: ChunkRecoveryDeps['storage'] = null;
  try {
    storage = window.sessionStorage;
  } catch {
    storage = null;
  }
  return { now: () => Date.now(), reload: () => window.location.reload(), storage };
}

export function isChunkLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return CHUNK_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

/** Reload the page unless one was already triggered inside the window. Returns whether it reloaded. */
export function reloadOnce(deps: ChunkRecoveryDeps): boolean {
  let last = 0;
  try {
    last = Number(deps.storage?.getItem(STORAGE_KEY) ?? 0) || 0;
  } catch {
    last = 0;
  }
  const now = deps.now();
  if (now - last < RELOAD_WINDOW_MS) return false;
  try {
    deps.storage?.setItem(STORAGE_KEY, String(now));
  } catch {
    // Private mode or blocked storage: still reload once; the window guard is best effort.
  }
  deps.reload();
  return true;
}

/** For error boundaries: reload once when the caught error is a missing chunk. */
export function recoverFromChunkError(error: unknown, deps: ChunkRecoveryDeps = defaultDeps()): boolean {
  return isChunkLoadError(error) && reloadOnce(deps);
}

/**
 * Vite's production preload helper dispatches a cancelable `vite:preloadError` on `window` before it throws;
 * cancelling it and reloading replaces the error page with a fresh bundle. Returns the uninstaller.
 */
export function installChunkRecovery(target: Window = window, deps: ChunkRecoveryDeps = defaultDeps()): () => void {
  const handler = (event: Event) => {
    if (reloadOnce(deps)) event.preventDefault();
  };
  target.addEventListener('vite:preloadError', handler);
  return () => target.removeEventListener('vite:preloadError', handler);
}
