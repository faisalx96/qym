import { describe, expect, it } from 'vitest';
import { isNavActive, parseRoute, projectNav } from '../chrome/nav';

describe('Live project navigation', () => {
  it.each([
    ['/projects/p/live', 'live', 'Live', undefined],
    ['/projects/p/live/worker', 'live-worker', 'Worker', undefined],
    ['/projects/p/live/turns', 'live-turns', 'Turns', undefined],
    ['/projects/p/live/turns/abc', 'live-turn', 'Turn', 'abc'],
    ['/projects/p/live/turns/abc/def', 'live-turn', 'Turn', 'abc/def'],
    ['/projects/p/live/turns/abc%2Fdef', 'live-turn', 'Turn', 'abc/def'],
  ])('parses %s without using runId', (path, page, label, turnId) => {
    expect(parseRoute(path!)).toMatchObject({ page, projectSlug: 'p', runId: null, label });
    expect(parseRoute(path!).turnId).toBe(turnId);
  });

  it('puts Live second and keeps it active for its nested pages, including archived projects', () => {
    const item = projectNav('p')[1]!;
    expect(item).toMatchObject({
      id: 'live',
      label: 'Live',
      to: '/projects/p/live',
      activeFor: ['live-turns', 'live-turn', 'live-worker'],
    });
    expect(item.hiddenWhenArchived).not.toBe(true);
    for (const page of ['live', 'live-turns', 'live-turn', 'live-worker'])
      expect(isNavActive(item, page)).toBe(true);
    expect(isNavActive(item, 'runs')).toBe(false);
  });
});
