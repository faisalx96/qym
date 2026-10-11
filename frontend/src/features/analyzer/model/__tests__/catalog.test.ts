import { describe, expect, it } from 'vitest';
import { approvalSignature, catalogFromConfig, catalogPayload, validateCatalog } from '../catalog';
import type { AnalysisConfig } from '@/api/analysis';

const config = {
  default_categories: ['Retrieval', 'Format'],
  category_details_map: { Retrieval: ['Missing context'] },
  category_taxonomy: { Retrieval: { description: 'd', when_to_use: 'w' } },
  subcategory_taxonomy: { Retrieval: { 'Missing context': { description: 'sd', when_to_use: 'sw' } } },
  category_example_counts: { Retrieval: 1, Format: 0 },
  category_examples: {
    Retrieval: [{ id: 7, root_cause_issues: [{ category: 'Retrieval', subcategory: 'Stale index' }] }],
    Format: [],
  },
  max_root_cause_categories: 3,
  category_catalog_version: 4,
  category_catalog: null,
} as unknown as AnalysisConfig;

describe('catalog draft', () => {
  it('lists every category and marks example-only labels read-only', () => {
    const draft = catalogFromConfig(config);
    expect(draft.categories.map((c) => c.name)).toEqual(['Retrieval', 'Format']);
    expect(draft.categories[0].subs.map((s) => [s.name, s.exampleOnly])).toEqual([
      ['Missing context', false],
      ['Stale index', true],
    ]);
    expect(draft.revision).toBe(4);
  });

  it('requires both taxonomy fields and never saves example-only labels', () => {
    const draft = catalogFromConfig(config);
    expect(validateCatalog(draft)).toEqual({ categories: ['Format'], subcategories: [] });
    draft.categories[1].description = 'x';
    draft.categories[1].whenToUse = 'y';
    draft.categories[0].subs[0].whenToUse = '';
    expect(validateCatalog(draft).subcategories).toEqual(['Retrieval / Missing context']);
    draft.categories[0].subs[0].whenToUse = 'sw';
    expect(validateCatalog(draft)).toEqual({ categories: [], subcategories: [] });
    const payload = catalogPayload(draft);
    expect(payload.category_details_map).toEqual({ Retrieval: ['Missing context'] });
    expect(payload.base_revision).toBe(4);
    expect(payload.categories).toEqual(['Retrieval', 'Format']);
  });

  it('changes the approval signature when examples change', () => {
    const a = approvalSignature(config);
    const b = approvalSignature({ ...config, category_example_counts: { Retrieval: 2, Format: 0 } });
    expect(a).not.toBe(b);
  });
});
