import { afterEach, describe, expect, it, vi } from 'vitest';
import { easeInOutCubic, scrollDuration, smoothScrollTo } from '../smoothScroll';

describe('smooth section scroll (cv4 C1-1)', () => {
  afterEach(() => vi.useRealTimers());

  it('eases in and out, from 0 to 1', () => {
    expect(easeInOutCubic(0)).toBe(0);
    expect(easeInOutCubic(1)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5);
    expect(easeInOutCubic(0.1)).toBeLessThan(0.1);
    expect(easeInOutCubic(0.9)).toBeGreaterThan(0.9);
    expect(easeInOutCubic(2)).toBe(1);
  });

  it('takes longer for a longer travel, within 280 to 640 ms', () => {
    expect(scrollDuration(0)).toBe(280);
    expect(scrollDuration(-2000)).toBe(scrollDuration(2000));
    expect(scrollDuration(2000)).toBeGreaterThan(scrollDuration(500));
    expect(scrollDuration(50000)).toBe(640);
  });

  it('lands on the live target, and a wheel stops the travel where it is', async () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const scroller = { scrollTop: 0 } as HTMLElement;
    let target = 1000;
    const done = smoothScrollTo(scroller, () => target);
    vi.advanceTimersByTime(100);
    target = 1200; // a lazy section above the target mounted
    vi.advanceTimersByTime(1000);
    await expect(done).resolves.toBe(true);
    expect(scroller.scrollTop).toBe(1200);

    const stopped = smoothScrollTo(scroller, () => 0);
    vi.advanceTimersByTime(100);
    window.dispatchEvent(new Event('wheel'));
    await expect(stopped).resolves.toBe(false);
    const at = scroller.scrollTop;
    vi.advanceTimersByTime(1000);
    expect(scroller.scrollTop).toBe(at);
    expect(at).toBeGreaterThan(0);
  });
});
