import { describe, expect, it, vi } from 'vitest';
import { installChunkRecovery, isChunkLoadError, recoverFromChunkError, reloadOnce } from '../chunk-recovery';

function deps(now = 1_000_000) {
  const store = new Map<string, string>();
  const reload = vi.fn();
  return {
    reload,
    deps: {
      now: () => now,
      reload,
      storage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    },
    store,
  };
}

describe('isChunkLoadError', () => {
  it('matches the browser and Vite wordings for a missing chunk', () => {
    expect(isChunkLoadError(new Error('Unable to preload CSS for ./assets/DatasetComparePage-i_KEChzG.css'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: http://x/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module: http://x/a.js'))).toBe(true);
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isChunkLoadError('Loading chunk 42 failed')).toBe(true);
  });
  it('leaves other errors alone', () => {
    expect(isChunkLoadError(new Error('Request failed with status 500'))).toBe(false);
    expect(isChunkLoadError({ status: 404, detail: 'Not found' })).toBe(false);
    expect(isChunkLoadError(undefined)).toBe(false);
  });
});

describe('reloadOnce', () => {
  it('reloads the first time and records when', () => {
    const d = deps();
    expect(reloadOnce(d.deps)).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
    expect(d.store.get('qym.chunk-reload-at')).toBe('1000000');
  });
  it('does not reload again inside a minute', () => {
    const d = deps();
    reloadOnce(d.deps);
    expect(reloadOnce({ ...d.deps, now: () => 1_000_000 + 59_000 })).toBe(false);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });
  it('reloads again after the window', () => {
    const d = deps();
    reloadOnce(d.deps);
    expect(reloadOnce({ ...d.deps, now: () => 1_000_000 + 60_000 })).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(2);
  });
  it('still reloads once when storage is unavailable', () => {
    const reload = vi.fn();
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(reloadOnce({ now: () => 1_000_000, reload, storage: throwing })).toBe(true);
    expect(reloadOnce({ now: () => 1_000_000, reload, storage: null })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe('recoverFromChunkError', () => {
  it('reloads only for chunk errors', () => {
    const d = deps();
    expect(recoverFromChunkError(new Error('Request failed'), d.deps)).toBe(false);
    expect(d.reload).not.toHaveBeenCalled();
    expect(recoverFromChunkError(new Error('Unable to preload CSS for ./assets/x.css'), d.deps)).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
  });
});

describe('installChunkRecovery', () => {
  it('cancels the vite:preloadError event and reloads once', () => {
    const d = deps();
    const uninstall = installChunkRecovery(window, d.deps);
    const first = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(d.reload).toHaveBeenCalledTimes(1);
    const second = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
    expect(d.reload).toHaveBeenCalledTimes(1);
    uninstall();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    expect(d.reload).toHaveBeenCalledTimes(1);
  });
});
