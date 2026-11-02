import { describe, expect, it } from 'vitest';
import { SecretStore } from './secrets';

describe('SecretStore', () => {
  it('stores keys by ref and never serialises them', () => {
    const store = new SecretStore();
    const ref = store.put('sk-secret-value');
    expect(ref).toMatch(/^tmp-/);
    expect(store.get(ref)).toBe('sk-secret-value');
    expect(JSON.stringify(store)).toBe('{}');
    expect(JSON.stringify({ store })).not.toContain('sk-secret-value');
    expect(String(store)).toBe('[SecretStore]');
    expect(Object.keys(store)).toEqual([]);
  });

  it('issues distinct refs', () => {
    const store = new SecretStore();
    expect(store.newRef()).not.toBe(store.newRef());
  });

  it('keeps only the refs in use and picks the request subset', () => {
    const store = new SecretStore();
    store.put('a', 'r1');
    store.put('b', 'r2');
    store.put('c', 'r3');
    store.retainOnly(['r1', 'r3']);
    expect(store.has('r2')).toBe(false);
    expect(store.pick(['r1', 'r2', 'r3'])).toEqual({ r1: 'a', r3: 'c' });
  });

  it('clears everything', () => {
    const store = new SecretStore();
    store.put('a', 'r1');
    store.clear();
    expect(store.size).toBe(0);
    expect(store.get('r1')).toBeUndefined();
  });
});
