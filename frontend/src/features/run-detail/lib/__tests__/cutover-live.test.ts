/**
 * Cutover of test_run_page_render_browser.py::test_live_reloads_of_a_repeat_run_count_its_passes: a repeat
 * run's rows carry every pass, so the reload throttle counts rows x passes, not rows.
 */
import { describe, expect, it } from 'vitest';
import { LIVE_PROBE_MS, LIVE_PROBE_STOPPING_MS, reloadThrottleMs } from '../../hooks/useLiveRun';

describe('live reload throttle', () => {
  it('200 items x 3 passes is a 600-row reload, not a 200-row one', () => {
    expect(reloadThrottleMs(200 * 1, 0)).toBe(3000);
    expect(reloadThrottleMs(200 * 3, 0)).toBe(10_000);
    expect(reloadThrottleMs(6000, 0)).toBe(30_000);
  });
  it('is never sooner than ten times the last reload, and never beyond 120 s', () => {
    expect(reloadThrottleMs(100, 2000)).toBe(20_000);
    expect(reloadThrottleMs(100, 60_000)).toBe(120_000);
  });
  it('probes every 3 s, every 1.5 s while a stop is requested', () => {
    expect([LIVE_PROBE_MS, LIVE_PROBE_STOPPING_MS]).toEqual([3000, 1500]);
  });
});
