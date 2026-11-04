/**
 * Cutover of test_run_page_render_browser.py::test_live_reloads_of_a_repeat_run_count_its_passes: a repeat
 * run's rows carry every pass, so the reload throttle counts rows x passes, not rows. The probe interval is the
 * deployment's QYM_RUN_LIVE_REFRESH_SECONDS (default 15 s) and floors the throttle.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVE_REFRESH_MS,
  LIVE_PROBE_STOPPING_MS,
  liveRefreshMs,
  reloadThrottleMs,
} from '../../hooks/useLiveRun';

describe('live reload throttle', () => {
  it('200 items x 3 passes is a 600-row reload, not a 200-row one (3 s probes)', () => {
    expect(reloadThrottleMs(200 * 1, 0, 3000)).toBe(3000);
    expect(reloadThrottleMs(200 * 3, 0, 3000)).toBe(10_000);
    expect(reloadThrottleMs(6000, 0, 3000)).toBe(30_000);
  });
  it('is never sooner than ten times the last reload, and never beyond 120 s', () => {
    expect(reloadThrottleMs(100, 2000, 3000)).toBe(20_000);
    expect(reloadThrottleMs(100, 60_000, 3000)).toBe(120_000);
  });
  it('is never sooner than the probe interval: 15 s by default, the deployment value otherwise', () => {
    expect(reloadThrottleMs(100, 0)).toBe(15_000);
    expect(reloadThrottleMs(200 * 3, 0)).toBe(15_000);
    expect(reloadThrottleMs(6000, 0)).toBe(30_000);
    expect(reloadThrottleMs(100, 0, 200_000)).toBe(200_000);
  });
  it('reads the server interval in seconds, at least 1 s, 15 s when unknown', () => {
    expect(liveRefreshMs(15)).toBe(15_000);
    expect(liveRefreshMs(3)).toBe(3000);
    expect(liveRefreshMs(0.5)).toBe(DEFAULT_LIVE_REFRESH_MS);
    expect(liveRefreshMs(undefined)).toBe(DEFAULT_LIVE_REFRESH_MS);
    expect(liveRefreshMs(Number.NaN)).toBe(DEFAULT_LIVE_REFRESH_MS);
  });
  it('probes every 15 s unless configured, every 1.5 s while a stop is requested', () => {
    expect([DEFAULT_LIVE_REFRESH_MS, LIVE_PROBE_STOPPING_MS]).toEqual([15_000, 1500]);
  });
});
