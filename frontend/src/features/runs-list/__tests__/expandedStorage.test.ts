import { beforeEach, describe, expect, it } from 'vitest';
import { expandedKey, pruneExpanded, readExpanded, writeExpanded } from '../passes/expandedStorage';

beforeEach(() => sessionStorage.clear());

describe('expandedStorage', () => {
  it('round-trips the open groups per project', () => {
    writeExpanded('p', new Set(['a', 'b']));
    expect([...readExpanded('p')].sort()).toEqual(['a', 'b']);
    expect(readExpanded('other').size).toBe(0);
  });
  it('removes the key when nothing is open', () => {
    writeExpanded('p', new Set(['a']));
    writeExpanded('p', new Set());
    expect(sessionStorage.getItem(expandedKey('p'))).toBeNull();
  });
  it('survives a corrupt value', () => {
    sessionStorage.setItem(expandedKey('p'), '{not json');
    expect(readExpanded('p').size).toBe(0);
    sessionStorage.setItem(expandedKey('p'), JSON.stringify({ a: 1 }));
    expect(readExpanded('p').size).toBe(0);
    sessionStorage.setItem(expandedKey('p'), JSON.stringify(['a', 3, null, 'b']));
    expect([...readExpanded('p')]).toEqual(['a', 'b']);
  });
  it('prunes ids of loaded runs that cannot expand and keeps ids of other pages', () => {
    const out = pruneExpanded(new Set(['rep', 'single', 'elsewhere']), [
      { run_id: 'rep', samples: 3 },
      { run_id: 'single', samples: 1 },
    ]);
    expect([...out].sort()).toEqual(['elsewhere', 'rep']);
  });
});
