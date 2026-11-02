import { describe, expect, it } from 'vitest';
import {
  batchButtonLabel,
  batchSentence,
  batchTitle,
  batchToast,
  filterSentence,
  menuLabel,
  needsTypedConfirm,
  sampleIds,
  typedConfirmMatches,
} from '../batchCopy';

const criteria = {
  meta: [
    { path: 'domain', values: ['finance'], mode: 'any' as const },
    { path: 'source.region.code', values: ['sa'], mode: 'any' as const },
  ],
};

describe('sentence (A3-29)', () => {
  it('names the filters and the state suffix', () => {
    expect(batchSentence('disable', criteria, 40, 130)).toBe(
      '40 of 130 items match domain: finance, source.region.code: sa and are active.',
    );
    expect(batchSentence('enable', criteria, 2, 130)).toBe(
      '2 of 130 items match domain: finance, source.region.code: sa and are disabled.',
    );
    expect(batchSentence('delete', criteria, 42, 130)).toBe(
      '42 of 130 items match domain: finance, source.region.code: sa.',
    );
  });
  it('writes search and label criteria', () => {
    expect(filterSentence({ search: 'refund', label: 'gold', meta: [] })).toBe(
      'search “refund”, label: gold',
    );
  });
  it('uses the selected-rows form (A3-41)', () => {
    expect(batchSentence('disable', { meta: [], selectedCount: 3 }, 2, 130)).toBe(
      '2 of 3 selected items are active.',
    );
  });
});

describe('sample ids (A3-30)', () => {
  it('shows five and counts the rest', () => {
    expect(sampleIds(['a', 'b', 'c', 'd', 'e', 'f'], 40)).toEqual({
      ids: ['a', 'b', 'c', 'd', 'e'],
      more: 35,
    });
  });
  it('never goes negative', () => {
    expect(sampleIds(['a', 'b'], 2)).toEqual({ ids: ['a', 'b'], more: 0 });
    expect(sampleIds(['a', 'b', 'c'], 1).more).toBe(0);
  });
});

describe('typed confirmation (A3-34)', () => {
  it('is required for deletes over 50 only', () => {
    expect(needsTypedConfirm('delete', 50)).toBe(false);
    expect(needsTypedConfirm('delete', 51)).toBe(true);
    expect(needsTypedConfirm('disable', 500)).toBe(false);
  });
  it('matches the trimmed number', () => {
    expect(typedConfirmMatches(' 120 ', 120)).toBe(true);
    expect(typedConfirmMatches('12', 120)).toBe(false);
    expect(typedConfirmMatches('', 120)).toBe(false);
  });
});

describe('labels (A3-16, A3-31 to A3-36)', () => {
  it('words titles, buttons, toasts and menu entries', () => {
    expect(batchTitle('disable', 40)).toBe('Disable 40 items?');
    expect(batchTitle('delete', 1)).toBe('Delete 1 item?');
    expect(batchButtonLabel('enable', 2)).toBe('Enable 2');
    expect(batchToast('disable', 40)).toBe('Disabled 40 items');
    expect(batchToast('delete', 1)).toBe('Deleted 1 item');
    expect(menuLabel('enable', 0)).toBe('Enable all 0 matching…');
    expect(menuLabel('delete', 42)).toBe('Delete all 42 matching…');
  });
});

describe('multi-value filters (QA1-25)', () => {
  it('names a list filter with its values and mode', () => {
    const tags = { meta: [{ path: 'tags', values: ['billing', 'refund'], mode: 'any' as const }] };
    expect(batchSentence('disable', tags, 46, 130)).toBe(
      '46 of 130 items match tags: billing, refund (any) and are active.',
    );
  });
});
