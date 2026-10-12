import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { nextBackoff, useBackoffInterval } from '@/lib/backoff';

describe('nextBackoff', () => {
  it('multiplies by 1.5 and caps at 60 s', () => {
    expect(nextBackoff(5000)).toBe(7500);
    expect(nextBackoff(7500)).toBe(11250);
    expect(nextBackoff(50000)).toBe(60000);
    expect(nextBackoff(60000)).toBe(60000);
  });
});

describe('useBackoffInterval', () => {
  it('starts at 5 s, backs off per refresh, resets on a new key and stops when idle', () => {
    const { result, rerender } = renderHook(
      (props: { active: boolean; at: number; key: string }) =>
        useBackoffInterval(props.active, { dataUpdatedAt: props.at, resetKey: props.key }),
      { initialProps: { active: true, at: 0, key: 'a' } },
    );
    expect(result.current).toBe(5000);
    rerender({ active: true, at: 1, key: 'a' }); // first load keeps the minimum
    expect(result.current).toBe(5000);
    rerender({ active: true, at: 2, key: 'a' });
    expect(result.current).toBe(7500);
    rerender({ active: true, at: 3, key: 'a' });
    expect(result.current).toBe(11250);
    rerender({ active: true, at: 4, key: 'b' }); // data changed: restart
    expect(result.current).toBe(5000);
    rerender({ active: false, at: 5, key: 'b' });
    expect(result.current).toBe(false);
  });

  it('pauses while the tab is hidden', () => {
    const { result } = renderHook(() => useBackoffInterval(true));
    expect(result.current).toBe(5000);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe(false);
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current).toBe(5000);
  });
});
