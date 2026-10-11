/**
 * Docs information architecture + content loading. The IA is data
 * (`ia.json`, also read by tests/platform/test_platform_docs.py); page bodies
 * are compiled at build time by frontend/plugins/docs-content.ts.
 */
import type { Root } from 'hast';
import ia from './ia.json';
import { loaders } from 'virtual:qym-docs/pages';

export interface DocsHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

export interface DocsPagePayload {
  hast: Root;
  headings: DocsHeading[];
}

export interface SearchRecord {
  key: string;
  section: string;
  sectionTitle: string;
  title: string;
  headings: DocsHeading[];
  text: string;
}

export interface DocsPageRef {
  key: string;
  section: string;
  page: string;
  title: string;
  sectionTitle: string;
}

export interface DocsSection {
  id: string;
  title: string;
  icon: string;
  pages: { id: string; title: string }[];
}

export const SECTIONS: DocsSection[] = ia.sections;

/** Flattened reading order (prev/next, lookups). */
export const PAGES: DocsPageRef[] = SECTIONS.flatMap((s) =>
  s.pages.map((p) => ({ key: `${s.id}/${p.id}`, section: s.id, page: p.id, title: p.title, sectionTitle: s.title })),
);

export const FIRST_PAGE = PAGES[0]!;

export function findPage(section: string | undefined, page: string | undefined): DocsPageRef | null {
  if (!section || !page) return null;
  return PAGES.find((p) => p.section === section && p.page === page) ?? null;
}

export function docsPath(ref: { section: string; page: string }, heading?: string | null): string {
  return `/docs/${ref.section}/${ref.page}${heading ? `#${heading}` : ''}`;
}

/** `#section/page[/heading]` (vanilla docs.js hash routes) → app path, or null. */
export function legacyHashToPath(hash: string): string | null {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [section, page, ...rest] = parts;
  const ref = findPage(section, page);
  if (!ref) return null;
  return docsPath(ref, rest.join('/') || null);
}

export function neighbours(ref: DocsPageRef): { prev: DocsPageRef | null; next: DocsPageRef | null } {
  const i = PAGES.findIndex((p) => p.key === ref.key);
  return { prev: i > 0 ? PAGES[i - 1]! : null, next: i >= 0 && i < PAGES.length - 1 ? PAGES[i + 1]! : null };
}

const cache = new Map<string, Promise<DocsPagePayload | null>>();

/** Code-split page body; `null` when the partial does not exist ("not written yet"). */
export function loadPage(key: string): Promise<DocsPagePayload | null> {
  let p = cache.get(key);
  if (!p) {
    const loader = loaders[key];
    p = loader ? loader().then((m) => m.default) : Promise.resolve(null);
    cache.set(key, p);
  }
  return p;
}

let searchIndex: Promise<SearchRecord[]> | null = null;
/** Lazy full-text index (titles, headings, body text), loaded on first search. */
export function loadSearchIndex(): Promise<SearchRecord[]> {
  searchIndex ??= import('virtual:qym-docs/search').then((m) => m.default);
  return searchIndex;
}

export interface SearchHit {
  ref: DocsPageRef;
  heading: DocsHeading | null;
  /** Short excerpt around the match (body hits only). */
  excerpt: string | null;
  score: number;
}

/** Rank: title > heading > body; substring, case-insensitive, all terms must match. */
export function searchDocs(records: SearchRecord[], query: string, limit = 12): SearchHit[] {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const hits: SearchHit[] = [];
  for (const r of records) {
    const ref = findPage(r.section, r.key.split('/')[1]);
    if (!ref) continue;
    const title = r.title.toLowerCase();
    const sectionTitle = r.sectionTitle.toLowerCase();
    if (terms.every((t) => title.includes(t) || sectionTitle.includes(t))) {
      hits.push({ ref, heading: null, excerpt: null, score: 100 });
      continue;
    }
    let headingHit: DocsHeading | null = null;
    for (const h of r.headings) {
      const text = h.text.toLowerCase();
      if (terms.every((t) => text.includes(t))) {
        headingHit = h;
        break;
      }
    }
    if (headingHit) {
      hits.push({ ref, heading: headingHit, excerpt: null, score: 60 });
      continue;
    }
    const body = r.text.toLowerCase();
    if (terms.every((t) => body.includes(t))) {
      const at = body.indexOf(terms[0]!);
      const start = Math.max(0, at - 60);
      const excerpt = `${start ? '…' : ''}${r.text.slice(start, at + 90).trim()}…`;
      hits.push({ ref, heading: null, excerpt, score: 20 });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
