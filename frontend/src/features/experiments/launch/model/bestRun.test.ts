import { describe, expect, it } from 'vitest';
import { driftLines, versionText } from './bestRun';

describe('versioning text as reported (round 10, C-3-10)', () => {
  it('prints every key as written, in the payload order, objects as compact JSON', () => {
    expect(versionText({ release: '2026.11.0', build: 4127, routing: { primary: 'gpt-4o' }, gone: null })).toBe(
      'release 2026.11.0 / build 4127 / routing {"primary":"gpt-4o"}',
    );
    expect(versionText(null)).toBe('');
  });

  it('names a drifted key as reported', () => {
    expect(
      driftLines({ status: 'changed', changes: [{ key: 'release', run: 'v1', latest: 'v2' }] } as never),
    ).toEqual(['release: v1 in this run, v2 now']);
  });
});
