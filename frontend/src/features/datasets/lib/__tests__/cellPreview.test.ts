/** cv4 E1: three densities, three clearly different item cells. */
import { describe, expect, it } from 'vitest';
import { cellPreviewText } from '../cellPreview';

describe('item cell preview by density (cv4 E1; the line counts come from the shared table, cv4 X6)', () => {
  it('keeps the one-line preview for compact and regular', () => {
    const v = { instruction: 'Summarize', document_id: 'doc-1' };
    expect(cellPreviewText(v, 'compact')).toBe(cellPreviewText(v, 'regular'));
    expect(cellPreviewText(v, 'regular')).not.toContain('\n');
  });

  it('puts each field of an object, or each chat message, on its own line for comfortable', () => {
    expect(
      cellPreviewText({ instruction: 'Summarize  the\nclause', document_id: 'doc-1' }, 'comfortable'),
    ).toBe('instruction: Summarize the clause\ndocument_id: doc-1');
    expect(cellPreviewText('{"a": 1, "b": [2]}', 'comfortable')).toBe('a: 1\nb: [2]');
    expect(
      cellPreviewText(
        [
          { role: 'system', content: 'Be brief' },
          { role: 'user', content: 'Hi' },
        ],
        'comfortable',
      ),
    ).toBe('system: Be brief\nuser: Hi');
    expect(cellPreviewText('just text', 'comfortable')).toBe('just text');
  });
});
