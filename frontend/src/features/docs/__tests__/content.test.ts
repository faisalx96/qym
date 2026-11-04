import { describe, expect, it } from 'vitest';
import {
  FIRST_PAGE,
  PAGES,
  findPage,
  legacyHashToPath,
  loadPage,
  loadSearchIndex,
  neighbours,
  searchDocs,
} from '../content';

describe('docs IA', () => {
  it('flattens 28 pages in reading order, with Live after run detail', () => {
    expect(PAGES).toHaveLength(28);
    expect(FIRST_PAGE.key).toBe('get-started/what-is-qym');
    expect(neighbours(FIRST_PAGE).prev).toBeNull();
    expect(neighbours(FIRST_PAGE).next?.key).toBe('get-started/install');
    const live = findPage('platform-guide', 'live')!;
    expect(live.title).toBe('Live evaluation');
    expect(neighbours(live).prev?.key).toBe('platform-guide/run-detail');
    expect(neighbours(live).next?.key).toBe('platform-guide/projects-data-review');
  });

  it('maps legacy hashes to routes', () => {
    expect(legacyHashToPath('#developer/endpoints/conventions')).toBe(
      '/docs/developer/endpoints#conventions',
    );
    expect(legacyHashToPath('#/sdk-guide/judges')).toBe('/docs/sdk-guide/judges');
    expect(legacyHashToPath('#nope/none')).toBeNull();
    expect(findPage('developer', 'cli')?.title).toBe('CLI reference');
  });
});

describe('compiled content (frontend/plugins/docs-content.ts)', () => {
  it('compiles a partial to hast with heading ids and highlighted code', async () => {
    const page = await loadPage('developer/endpoints');
    expect(page).not.toBeNull();
    expect(page!.headings[0]).toEqual({ id: 'conventions', text: 'Conventions', level: 2 });
    const json = JSON.stringify(page!.hast);
    expect(json).not.toContain('"position":{');
    expect(json).toContain('"dataLang":"bash"');
    expect(json).toContain('tok-');
    expect(json).not.toMatch(/"style":/);
  });

  it('returns null for an unknown page and builds a search index', async () => {
    expect(await loadPage('developer/missing')).toBeNull();
    const index = await loadSearchIndex();
    expect(index.length).toBe(28);
    const hits = searchDocs(index, 'judge');
    expect(hits[0]?.ref.key).toBe('sdk-guide/judges');
    expect(searchDocs(index, 'metric_max_retries').map((h) => h.ref.key)).toContain('sdk-guide/config');
    expect(searchDocs(index, 'heartbeat').map((h) => h.ref.key)).toContain('platform-guide/live');
  });
});
