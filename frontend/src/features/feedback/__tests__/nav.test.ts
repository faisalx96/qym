import { describe, expect, it } from 'vitest';
import { GLOBAL_NAV, isNavActive, parseRoute } from '@/features/shell/chrome/nav';

describe('feedback navigation', () => {
  it('is the third entry of the global group and active on every feedback page', () => {
    expect(GLOBAL_NAV.map((i) => i.id)).toEqual(['projects', 'docs', 'feedback']);
    const entry = GLOBAL_NAV[2]!;
    for (const path of ['/feedback', '/feedback/new', '/feedback/FB-0044', '/feedback/3f2a']) {
      const route = parseRoute(path);
      expect(route).toMatchObject({ page: 'feedback', label: 'Feedback', projectSlug: null });
      expect(isNavActive(entry, route.page)).toBe(true);
    }
  });
});
