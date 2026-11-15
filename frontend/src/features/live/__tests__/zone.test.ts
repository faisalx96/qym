import { describe, expect, it } from 'vitest';
import { safeZone, zoneDateTime, zoneLabel, zoneToday } from '../lib/zone';

describe('source timezone formatting', () => {
  it.each([undefined, null, '', 'Invalid/Timezone'])('falls back to UTC for %s', (zone) => {
    expect(safeZone(zone)).toBe('UTC');
    expect(zoneLabel(zone)).toBe('UTC');
    expect(zoneDateTime('2026-11-09T22:30:00Z', zone)).toBe('2026-11-09 22:30');
    expect(zoneToday(zone, new Date('2026-11-09T22:30:00Z'))).toBe('2026-11-09');
  });

  it('uses the source day after midnight in Riyadh', () => {
    expect(safeZone('Asia/Riyadh')).toBe('Asia/Riyadh');
    expect(zoneToday('Asia/Riyadh', new Date('2026-11-09T22:30:00Z'))).toBe('2026-11-10');
    expect(zoneDateTime('2026-11-09T22:30:12Z', 'Asia/Riyadh')).toBe('2026-11-10 01:30');
    expect(zoneDateTime('2026-11-09T22:30:12Z', 'Asia/Riyadh', true)).toBe('2026-11-10 01:30:12');
  });

  it.each(['2026-11-09T22:30:00Z', '2026-11-09T22:30:00', '2026-11-10T01:30:00+03:00'])(
    'interprets %s as the same instant, including naive UTC timestamps',
    (iso) => {
      expect(zoneDateTime(iso, 'Asia/Riyadh')).toBe('2026-11-10 01:30');
      expect(zoneDateTime(iso, 'UTC')).toBe('2026-11-09 22:30');
    },
  );

  it.each(['Etc/GMT-3', 'Etc/GMT+3', 'Etc/GMT', 'Etc/GMT0', 'Etc/Greenwich'])(
    'preserves the full identifier for %s',
    (zone) => {
      expect(zoneLabel(zone)).toBe(zone);
    },
  );

  it.each(['Etc/UTC', 'Etc/Universal', 'Etc/Zulu'])('labels %s as UTC', (zone) => {
    expect(zoneLabel(zone)).toBe('UTC');
  });

  it('provides readable labels and handles invalid timestamps', () => {
    expect(zoneLabel('UTC')).toBe('UTC');
    expect(zoneLabel('Asia/Riyadh')).toBe('Riyadh');
    expect(zoneLabel('America/New_York')).toBe('New York');
    expect(zoneDateTime('', 'UTC')).toBe('—');
  });
});
