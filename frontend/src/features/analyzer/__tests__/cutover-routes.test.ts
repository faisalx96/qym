/**
 * Cutover of the redirect tests of tests/platform/test_analysis_routes.py (the server used to canonicalise
 * the vanilla analyzer URLs): the React route reads scope aliases the same way and keeps the other
 * query parameters when the focused run URL moves to the workspace.
 */
import { describe, expect, it } from 'vitest';
import { analysisUrl } from '../RunAnalyzerRedirect';
import { parsePass, parseScope } from '../useAnalyzerRoute';

describe('analyzer scope aliases', () => {
  it.each([
    ['diagnosis', 'categories'],
    ['project', 'rules'],
    ['dashboard', 'run'],
    ['documents', 'documents'],
    ['rules', 'rules'],
    ['categories', 'categories'],
    ['run', 'run'],
    [undefined, 'run'],
    ['nonsense', 'run'],
  ])('%s -> %s', (raw, canonical) => {
    expect(parseScope(raw as string | undefined)).toBe(canonical);
  });

  it('reads a pass only when it is a whole number from 1', () => {
    expect([parsePass('2'), parsePass('0'), parsePass('1.5'), parsePass(null), parsePass('x')]).toEqual([2, null, null, null, null]);
  });
});

describe('the focused analyzer URL moves to the workspace and keeps its query', () => {
  it('keeps metric, pass and scope', () => {
    expect(analysisUrl('analysis-project', 'analysis/run-1', '?metric=judge&mode=compact')).toBe(
      '/projects/analysis-project/analysis?metric=judge&mode=compact&run=analysis%2Frun-1',
    );
    expect(analysisUrl('analysis-project', 'r1', '?scope=documents&metric=judge')).toBe(
      '/projects/analysis-project/analysis?scope=documents&metric=judge&run=r1',
    );
  });
});
