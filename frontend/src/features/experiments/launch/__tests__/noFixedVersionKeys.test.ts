import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import fg from 'fast-glob';
import { describe, expect, it } from 'vitest';

/**
 * Round 10, C-3-9: versioning details are drawn as the Evaluation Service reports them, so the UI holds no fixed key list.
 * Tests, fixtures and the dev mocks (`features/dev`) may name the sample keys; nothing else may.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '../../../..');

describe('no fixed versioning key list (R10 C-3-9)', () => {
  it('names agent_version, image_version or kb_version nowhere outside tests, fixtures and features/dev', () => {
    const files = fg.sync('**/*.{ts,tsx,css}', {
      cwd: SRC,
      absolute: true,
      ignore: ['**/__tests__/**', '**/*.test.*', '**/__fixtures__/**', 'features/dev/**'],
    });
    expect(files.length).toBeGreaterThan(100);
    const hits = files.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => [line, i] as const)
        .filter(([line]) => /agent_version|image_version|kb_version|VERSION_KEYS|VERSION_LABELS/.test(line))
        .map(([, i]) => `${relative(SRC, f)}:${i + 1}`),
    );
    expect(hits).toEqual([]);
  });
});
