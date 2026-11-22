import { describe, expect, it } from 'vitest';
import {
  formatAgo,
  formatAgoSeconds,
  formatDay,
  formatElapsed,
  formatHeaderDate,
  formatTableDate,
  formatTime,
  toDate,
} from '@/lib/dates';

const at = new Date(2026, 8, 14, 19, 5); // Sep 14, 2026, 19:05 local

describe('dates (C048: one set of formats)', () => {
  it('formats tables, headers, days and times in 24-hour time', () => {
    expect(formatTableDate(at, new Date(2026, 10, 1))).toBe('Sep 14 · 19:05');
    expect(formatTableDate(at, new Date(2027, 0, 2))).toBe('Sep 14, 2026 · 19:05');
    expect(formatHeaderDate(at)).toBe('Sep 14, 2026, 19:05');
    expect(formatDay(at)).toBe('Sep 14, 2026');
    expect(formatTime(at)).toBe('19:05');
  });

  it('says how fresh something is, then falls back to the day', () => {
    const now = at.getTime();
    expect(formatAgo(new Date(now - 10_000), now)).toBe('just now');
    expect(formatAgo(new Date(now - 5 * 60_000), now)).toBe('5m ago');
    expect(formatAgo(new Date(now - 3 * 3_600_000), now)).toBe('3h ago');
    expect(formatAgo(new Date(now - 2 * 86_400_000), now)).toBe('2d ago');
    expect(formatAgo(new Date(now - 40 * 86_400_000), now)).toBe(formatDay(new Date(now - 40 * 86_400_000)));
  });

  it('counts whole seconds for a live report, with no space before the unit', () => {
    const now = at.getTime();
    expect(formatElapsed(8)).toBe('8s');
    expect(formatElapsed(60)).toBe('1m');
    expect(formatElapsed(125.9)).toBe('2m 5s');
    expect(formatElapsed(3840)).toBe('1h 4m');
    expect(formatElapsed(-3)).toBe('0s');
    expect(formatElapsed(Number.NaN)).toBe('0s');
    expect(formatAgoSeconds(new Date(now - 1_900), now)).toBe('just now');
    expect(formatAgoSeconds(new Date(now - 8_400), now)).toBe('8s ago');
    expect(formatAgoSeconds(new Date(now - 125_000), now)).toBe('2m 5s ago');
    // A report from the future (clock skew) is not a negative age.
    expect(formatAgoSeconds(new Date(now + 5_000), now)).toBe('just now');
    // An hour or more reads as every other age does.
    expect(formatAgoSeconds(new Date(now - 3 * 3_600_000), now)).toBe('3h ago');
    expect(formatAgoSeconds(null)).toBe('—');
  });

  it('reads a zone-less server timestamp as UTC and rejects junk', () => {
    expect(toDate('2026-09-14T16:05:00')!.toISOString()).toBe('2026-09-14T16:05:00.000Z');
    expect(toDate('2026-09-14T16:05:00+03:00')!.toISOString()).toBe('2026-09-14T13:05:00.000Z');
    expect(toDate('nope')).toBeNull();
    expect(formatTableDate(null)).toBe('—');
    expect(formatAgo(undefined)).toBe('—');
  });
});
