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
  it('flattens 27 pages in reading order', () => {
    expect(PAGES).toHaveLength(27);
    expect(FIRST_PAGE.key).toBe('get-started/what-is-qym');
    expect(neighbours(FIRST_PAGE).prev).toBeNull();
    expect(neighbours(FIRST_PAGE).next?.key).toBe('get-started/install');
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
    expect(index.length).toBe(27);
    const hits = searchDocs(index, 'judge');
    expect(hits[0]?.ref.key).toBe('sdk-guide/judges');
    expect(searchDocs(index, 'metric_max_retries').map((h) => h.ref.key)).toContain('sdk-guide/config');
  });
});
