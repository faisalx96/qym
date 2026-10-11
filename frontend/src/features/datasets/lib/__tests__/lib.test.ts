import { describe, expect, it } from 'vitest';
import { slugifyDatasetName, nextVersionAfter } from '../slugify';
import { detectCSVEncoding, legacyTextScore } from '../encoding';
import { csvParse, csvTable, detectCSVDelimiter } from '../csv';
import { parseJSONRecords, unknownJsonKeys } from '../jsonRecords';
import { autoMap, csvUpserts, setColumnRole } from '../mapping';
import { diffSide, wordDiff, DIFF_TOKEN_BUDGET } from '../wordDiff';
import { catalogStateLine, resolveActiveVersion } from '../versions';
import { editorTextToValue, sameValue, sniffJson, storedType } from '../itemValue';
import type { Dataset, DatasetVersion } from '@/api/datasets';

// Fixtures pinned against api/datasets.py `_slugify` / `_legacy_text_score` (2026-10-11).
describe('slugifyDatasetName (mirrors _slugify)', () => {
  it.each([
    ['Support QA', 'support-qa'],
    ['  Hello,  World!! ', 'hello-world'],
    ['مجموعة الاختبار ١', 'مجموعة-الاختبار-١'],
    ['Ünïcödé-Name_v2', 'ünïcödé-name-v2'],
    ['a--b', 'a-b'],
    ['Q&A: v2 (final)', 'q-a-v2-final'],
    ['!!!', ''],
  ])('%s → %s', (input, expected) => {
    expect(slugifyDatasetName(input)).toBe(expected);
  });
  it('next version label', () => {
    expect(nextVersionAfter('v3')).toBe('v4');
    expect(nextVersionAfter('prod')).toBeNull();
  });
});

describe('legacyTextScore (mirrors _legacy_text_score)', () => {
  it.each([
    ['Refunds within 30 days', 0],
    ['ÇáÓíÇÓÉ ÇáÇÓÊÑÌÇÚ', -16],
    ['سياسة الاسترجاع للطلب', 19],
    ['à la carte', 0],
    ['naïve café résumé', 4],
    ['a×b', 0],
    ['Ã©tÃ©', 1],
  ])('%s → %d', (input, expected) => {
    expect(legacyTextScore(input)).toBe(expected);
  });
  it('detects Windows-1256 for an Arabic legacy CSV and UTF-8 otherwise', () => {
    const utf8 = new TextEncoder().encode('question,answer\nما هي سياسة الاسترجاع؟,نعم\n');
    expect(detectCSVEncoding(utf8)).toBe('utf-8');
    // "سياسة الاسترجاع" in Windows-1256 bytes
    const cp1256 = Uint8Array.from([
      0x71, 0x2c, 0x61, 0x0a, 0xd3, 0xed, 0xc7, 0xd3, 0xc9, 0x20, 0xc7, 0xe1, 0xc7, 0xd3, 0xca, 0xd1, 0xcc, 0xc7, 0xda, 0x2c,
      0xe4, 0xda, 0xe3, 0x0a,
    ]);
    expect(detectCSVEncoding(cp1256)).toBe('windows-1256');
    expect(detectCSVEncoding(Uint8Array.from([0xff, 0xfe, 0x61, 0x00]))).toBe('utf-16le');
  });
});

describe('csv', () => {
  it('parses quotes, escaped quotes and CRLF', () => {
    expect(csvParse('a,"b,c","say ""hi"""\r\n1,2,3\n')).toEqual([
      ['a', 'b,c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });
  it('sniffs the delimiter', () => {
    expect(detectCSVDelimiter('a;b;c\n1;2;3\n4;5;6')).toBe(';');
    expect(detectCSVDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectCSVDelimiter('a,b\n1,2')).toBe(',');
  });
  it('builds a padded table and strips the BOM', () => {
    const t = csvTable('﻿q,a,extra\nx,y\n\n');
    expect(t.headers).toEqual(['q', 'a', 'extra']);
    expect(t.rows).toEqual([['x', 'y', '']]);
  });
});

describe('json records', () => {
  it('reports the bad line and keeps the good ones', () => {
    const r = parseJSONRecords('{"input":"a"}\n\nnot json\n[1]\n', 'x.jsonl');
    expect(r.format).toBe('jsonl');
    expect(r.rows).toHaveLength(1);
    expect(r.errors).toEqual([
      { where: 'Line 3', message: 'is not valid JSON' },
      { where: 'Line 4', message: 'must be a JSON object' },
    ]);
    expect(r.total).toBe(3);
  });
  it('treats a .json array as JSON and lists unknown keys', () => {
    const r = parseJSONRecords('[{"input":"a","foo":1},{"input":"b","metadata":[]}]', 'x.json');
    expect(r.format).toBe('json');
    expect(r.rows).toHaveLength(1);
    expect(r.errors[0]?.where).toBe('Item 2');
    expect(unknownJsonKeys(r.rows)).toEqual(['foo']);
  });
});

describe('mapping', () => {
  it('auto-detects roles and combines columns', () => {
    const headers = ['question', 'answer', 'id', 'extra'];
    const m = autoMap(headers);
    expect(m).toEqual({ input: ['question'], expected: ['answer'], id: 'id', metadata: ['extra'] });
    const m2 = setColumnRole(setColumnRole(m, 'extra', 'input'), 'question', 'id');
    expect(m2.id).toBe('question');
    expect(m2.metadata).toEqual(['id']);
    expect(m2.input).toEqual(['extra']);
    const ups = csvUpserts(headers, [['q1', 'a1', 'i1', 'e1']], m);
    expect(ups[0]).toEqual({ item_id: 'i1', input: 'q1', expected_output: 'a1', metadata: { extra: 'e1' } });
    const combined = csvUpserts(headers, [['q1', 'a1', 'i1', 'e1']], { ...m, input: ['question', 'extra'] });
    expect(combined[0]?.input).toEqual({ question: 'q1', extra: 'e1' });
  });
});

describe('wordDiff', () => {
  it('highlights the changed words only', () => {
    const ops = wordDiff('Refunds within 30 days', 'Refunds within 45 days')!;
    expect(ops.filter((o) => o.kind === 'del').map((o) => o.text)).toEqual(['30']);
    expect(ops.filter((o) => o.kind === 'add').map((o) => o.text)).toEqual(['45']);
    expect(diffSide(ops, 'before').map((o) => o.text).join('')).toBe('Refunds within 30 days');
    expect(diffSide(ops, 'after').map((o) => o.text).join('')).toBe('Refunds within 45 days');
  });
  it('gives up past the token budget', () => {
    const a = Array.from({ length: DIFF_TOKEN_BUDGET }, (_, i) => `w${i}`).join(' ');
    const b = Array.from({ length: DIFF_TOKEN_BUDGET }, (_, i) => `x${i}`).join(' ');
    expect(wordDiff(a, b)).toBeNull();
  });
});

function v(partial: Partial<DatasetVersion>): DatasetVersion {
  return {
    id: partial.version ?? 'v',
    dataset_id: 'd',
    version: 'v1',
    name: '',
    description: null,
    status: 'draft',
    source_type: 'api',
    source_uri: null,
    parent_version_id: null,
    base_version_id: null,
    schema: {},
    labels: [],
    item_count: 0,
    run_count: 0,
    content_hash: null,
    created_by_user_id: null,
    published_by_user_id: null,
    created_by: null,
    published_by: null,
    created_at: '',
    updated_at: '',
    published_at: null,
    is_default: false,
    aliases: [],
    ...partial,
  };
}

describe('versions', () => {
  const versions = [
    v({ version: 'v3', status: 'draft' }),
    v({ version: 'v2', status: 'published' }),
    v({ version: 'v1', status: 'published', aliases: ['production'] }),
  ];
  it('resolves alias → label → production → newest published → newest', () => {
    expect(resolveActiveVersion(versions, 'production')?.version).toBe('v1');
    expect(resolveActiveVersion(versions, 'v2')?.version).toBe('v2');
    expect(resolveActiveVersion(versions, 'nope')?.version).toBe('v1');
    expect(resolveActiveVersion(versions, null)?.version).toBe('v1');
    expect(resolveActiveVersion(versions.slice(0, 2), null)?.version).toBe('v2');
    expect(resolveActiveVersion(versions.slice(0, 1), null)?.version).toBe('v3');
  });
  it('state line', () => {
    const base = { production_version: null, latest_version: null } as unknown as Dataset;
    expect(catalogStateLine(base)).toBe('empty');
    expect(catalogStateLine({ ...base, production_version: versions[2]!, latest_version: versions[0]! })).toBe(
      'v1 prod · v3 draft',
    );
    expect(catalogStateLine({ ...base, latest_version: versions[0]! })).toBe('v3 draft · never published');
    expect(catalogStateLine({ ...base, production_version: versions[2]!, latest_version: versions[2]! })).toBe(
      'v1 prod · current',
    );
  });
});

describe('itemValue', () => {
  it('keeps strings as strings in text mode and parses in JSON mode', () => {
    expect(editorTextToValue('42', 'text')).toEqual({ ok: true, value: '42' });
    expect(editorTextToValue('42', 'json')).toEqual({ ok: true, value: 42 });
    expect(editorTextToValue('{bad', 'json').ok).toBe(false);
    expect(storedType('x')).toBe('string');
    expect(storedType([])).toBe('array');
    expect(storedType(null)).toBe('null');
  });
  it('sniffs JSON for the add dialog and ignores CRLF differences', () => {
    expect(sniffJson('{"a":1}')).toEqual({ a: 1 });
    expect(sniffJson('hello')).toBe('hello');
    expect(sameValue('a\r\nb', 'a\nb')).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1 })).toBe(true);
    expect(sameValue('1', 1)).toBe(false);
  });
});
