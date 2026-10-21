import { describe, expect, it } from 'vitest';
import { DETAIL_TABS, datasetPath, parseDatasetRoute } from '../route';

describe('dataset tabs (QA5-17, QA5-19)', () => {
  it('lists Items, Runs, Lineage, Access, Settings in that order', () => {
    expect(DETAIL_TABS).toEqual(['items', 'runs', 'lineage', 'access', 'settings']);
  });
  it('reads ?tab=access with the version kept', () => {
    const route = parseDatasetRoute('qa', new URLSearchParams('tab=access&v=v2'));
    expect(route.tab).toBe('access');
    expect(route.version).toBe('v2');
  });
  it('keeps settings working and falls back to items for an unknown tab', () => {
    expect(parseDatasetRoute('qa', new URLSearchParams('tab=settings')).tab).toBe('settings');
    expect(parseDatasetRoute('qa', new URLSearchParams('tab=nope')).tab).toBe('items');
  });
  it('builds the access URL', () => {
    expect(datasetPath('demo', 'qa', { tab: 'access', v: 'v1' })).toContain('tab=access');
  });
});
