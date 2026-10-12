import { describe, expect, it } from 'vitest';
import type { CorrectionRow } from '@/api/reviews';
import {
  applyFilterParams,
  bulkSelection,
  correctionPriority,
  filtersFromParams,
  hasActiveFilters,
  issuesChanged,
} from '../filters';

function row(partial: Partial<CorrectionRow>): CorrectionRow {
  return {
    id: 1,
    status: 'pending',
    ai_root_cause_issues: [],
    human_root_cause_issues: [],
    ai_confidence: null,
    created_at: new Date().toISOString(),
    ...partial,
  } as CorrectionRow;
}

describe('filters ↔ URL', () => {
  it('parses every param with the __none__ sentinel and clamps confidence', () => {
    const p = new URLSearchParams(
      'status=approved&source=corrected&conf_min=120&conf_max=60&q=foo&task=a&task=b&dataset=__none__&sort=confidence',
    );
    const f = filtersFromParams(p, 'acme');
    expect(f).toMatchObject({
      projectSlug: 'acme',
      status: 'approved',
      source: 'corrected',
      confMin: 60,
      confMax: 100,
      search: 'foo',
      task: ['a', 'b'],
      dataset: [],
      model: null,
      run: null,
      sort: 'confidence',
    });
    expect(hasActiveFilters(f)).toBe(true);
  });
  it('defaults: pending tab, oldest first, no filters', () => {
    const f = filtersFromParams(new URLSearchParams(''), null);
    expect(f.status).toBe('pending');
    expect(f.sort).toBe('oldest');
    expect(hasActiveFilters(f)).toBe(false);
    const url = applyFilterParams(new URLSearchParams('id=7'), f);
    expect(url.toString()).toBe('id=7&status=pending');
  });
  it('round-trips multiselects', () => {
    const f = filtersFromParams(new URLSearchParams('model=x&run=__none__'), null);
    const url = applyFilterParams(new URLSearchParams(''), f);
    expect(url.getAll('model')).toEqual(['x']);
    expect(url.getAll('run')).toEqual(['__none__']);
    expect(url.has('task')).toBe(false);
  });
});

describe('priority and bulk fit', () => {
  it('ranks by confidence, changed diagnosis and waiting time', () => {
    expect(correctionPriority(row({ ai_confidence: 0.4 }))?.level).toBe('high');
    expect(correctionPriority(row({ ai_confidence: 0.7 }))?.level).toBe('medium');
    expect(correctionPriority(row({ ai_confidence: 0.9 }))).toBeNull();
    expect(correctionPriority(row({ status: 'approved', ai_confidence: 0.1 }))).toBeNull();
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString();
    expect(correctionPriority(row({ created_at: old }))?.reasons[0]).toMatch(/Waiting 20 days/);
  });
  it('detects a changed diagnosis', () => {
    const same = row({
      ai_root_cause_issues: [{ category: 'A', subcategory: 'b', finding: 'f' }],
      human_root_cause_issues: [{ category: 'a', subcategory: 'B', finding: 'f' }],
    });
    expect(issuesChanged(same)).toBe(false);
    expect(issuesChanged(row({ human_root_cause_issues: [{ category: 'X' }] }))).toBe(true);
  });
  it('bulk selection keeps only fitting rows', () => {
    const rows = [row({ id: 1 }), row({ id: 2, status: 'approved' }), row({ id: 3 })];
    expect(bulkSelection(rows, new Set([1, 2, 3]), 'approve')).toEqual({ ids: [1, 3], selected: 3, skipped: 1 });
    expect(bulkSelection(rows, new Set([1, 2]), 'reset')).toEqual({ ids: [2], selected: 2, skipped: 1 });
  });
});
