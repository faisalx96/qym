import { describe, expect, it } from 'vitest';

const sources = import.meta.glob(['../*.ts', '../*.tsx', '../../admin/feedback/*.tsx', '../../../api/feedback.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('QE-171: the scale is called Complexity, never Size', () => {
  it('has no visible word "Size", no `size` URL or API parameter in the feedback feature', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(10);
    for (const [file, text] of Object.entries(sources)) {
      expect(text, file).not.toMatch(/(?<![A-Za-z])Size(?![A-Za-z])/);
      expect(text, file).not.toMatch(/[?&]size=/);
      expect(text, file).not.toMatch(/['"`]size['"`]\s*[:,)\]]/);
    }
  });
});
