import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayLabel, isToday, shiftDay } from '../lib/day';

afterEach(() => vi.useRealTimers());

describe('UTC day navigation', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('compares UTC keys even when the local day differs', () => {
    const now = new Date('2026-11-02T01:00:00+03:00');
    expect(isToday('2026-11-01', now)).toBe(true);
    expect(isToday('2026-11-02', now)).toBe(false);
  });

  it('labels today and historical days without shifting the day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T22:00:00Z'));
    expect(dayLabel('2026-11-01')).toBe('Today · 1 Nov 2026');
    expect(dayLabel('2026-10-31')).toBe('Sat 31 Oct 2026');
  });
});

it('marks today in Riyadh without shifting historical keys', () => {
  vi.useFakeTimers();
  const now = new Date('2026-11-09T22:30:00Z');
  vi.setSystemTime(now);
  expect(isToday('2026-11-10', now, 'Asia/Riyadh')).toBe(true);
  expect(isToday('2026-11-09', now, 'Asia/Riyadh')).toBe(false);
  expect(dayLabel('2026-11-10', 'Asia/Riyadh')).toBe('Today · 10 Nov 2026');
  expect(dayLabel('2026-11-09', 'Asia/Riyadh')).toBe('Mon 9 Nov 2026');
});
