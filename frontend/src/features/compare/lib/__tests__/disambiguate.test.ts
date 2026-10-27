import { describe, expect, it } from 'vitest';
import { disambiguateRunNames } from '../labels';

const NOW = new Date('2026-10-26T12:00:00Z');

describe('disambiguateRunNames (round 8, D2)', () => {
  it('leaves distinct names alone', () => {
    const names = disambiguateRunNames(
      [
        { base: 'a', name: 'baseline', started: '2026-10-01T15:00:00Z' },
        { base: 'b', name: 'candidate', started: '2026-10-02T15:00:00Z' },
      ],
      NOW,
    );
    expect(names).toEqual(['baseline', 'candidate']);
  });

  it('appends the start time to every run that shares a name with another run', () => {
    const names = disambiguateRunNames(
      [
        { base: 'a', name: 'nightly', started: '2026-10-01T15:00:00Z' },
        { base: 'b', name: 'nightly', started: '2026-10-02T09:30:00Z' },
        { base: 'c', name: 'other', started: '2026-10-02T09:30:00Z' },
      ],
      NOW,
    );
    expect(names[0]).toMatch(/^nightly · Oct 1/);
    expect(names[1]).toMatch(/^nightly · Oct 2/);
    expect(names[0]).not.toBe(names[1]);
    expect(names[2]).toBe('other');
  });

  it('keeps the passes of one repeat run on one name', () => {
    const names = disambiguateRunNames(
      [
        { base: 'a', name: 'repeat', started: '2026-10-01T15:00:00Z' },
        { base: 'a', name: 'repeat', started: '2026-10-01T15:00:00Z' },
      ],
      NOW,
    );
    expect(names).toEqual(['repeat', 'repeat']);
  });

  it('numbers runs that share both the name and the start minute', () => {
    const names = disambiguateRunNames(
      [
        { base: 'a', name: 'same', started: '2026-10-01T15:00:00Z' },
        { base: 'b', name: 'same', started: '2026-10-01T15:00:20Z' },
        { base: 'c', name: 'same', started: '2026-10-01T15:00:40Z' },
      ],
      NOW,
    );
    expect(new Set(names).size).toBe(3);
    expect(names[0]).toMatch(/#1$/);
    expect(names[2]).toMatch(/#3$/);
  });

  it('falls back to the bare name without a start time', () => {
    const names = disambiguateRunNames(
      [
        { base: 'a', name: 'same', started: '' },
        { base: 'b', name: 'same', started: '' },
      ],
      NOW,
    );
    expect(names).toEqual(['same #1', 'same #2']);
  });
});
