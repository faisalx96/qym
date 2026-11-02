import { describe, expect, it } from 'vitest';
import { DEFAULT_VIEW, filterSummary, modelOptionLabel } from '../urlState';

describe('status-bar sentence', () => {
  it('names filtered models exactly like the dropdown, never as internal keys', () => {
    const keys = ['openai/gpt-4.1-mini|||plain', 'anthropic/claude-sonnet-5|||reasoning'];
    const text = filterSummary({ ...DEFAULT_VIEW, models: keys }, { total: 20, filtered: 5 });
    expect(text).not.toContain('|||');
    expect(text).toContain(`model: ${keys.map(modelOptionLabel).join(', ')}`);
    expect(modelOptionLabel(keys[1]!)).toMatch(/\(reasoning\)$/);
  });
});
