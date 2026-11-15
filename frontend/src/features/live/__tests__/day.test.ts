import { describe, expect, it } from 'vitest';
import { dayLabel, isToday, shiftDay } from '../lib/day';

describe('Live day keys', () => {
  it('crosses month, year and leap-day boundaries', () => {
    expect(shiftDay('2026-11-01', -1)).toBe('2026-10-31');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDay('2024-03-01', -1)).toBe('2024-02-29');
  });

  it('compares the key with the source today', () => {
    expect(isToday('2026-11-01', '2026-11-01')).toBe(true);
    expect(isToday('2026-11-02', '2026-11-01')).toBe(false);
  });

  it('labels today and other days month first without shifting the day', () => {
    expect(dayLabel('2026-11-01', '2026-11-01')).toBe('Today · Nov 1, 2026');
    expect(dayLabel('2026-10-31', '2026-11-01')).toBe('Sat Oct 31, 2026');
  });
});

it('marks today in Riyadh without shifting historical keys', () => {
  vi.useFakeTimers();
  const now = new Date('2026-11-09T22:30:00Z');
  vi.setSystemTime(now);
  expect(isToday('2026-11-10', now, 'Asia/Riyadh')).toBe(true);
  expect(isToday('2026-11-09', now, 'Asia/Riyadh')).toBe(false);
  expect(dayLabel('2026-11-10', 'Asia/Riyadh')).toBe('Today · Nov 10, 2026');
  expect(dayLabel('2026-11-09', 'Asia/Riyadh')).toBe('Mon Nov 9, 2026');
});
