/**
 * Ported from the retired tests/platform/test_dataset_editing_browser.py: the
 * pure import / encoding / diff rules of the dataset editing flow. Server-side
 * fixtures were computed with api/datasets.py `_slugify` and `_decode_csv`
 * (the Python side is pinned in tests/platform/test_dataset_integrity.py).
 */
import { describe, expect, it } from 'vitest';
import { detectCSVEncoding, legacyTextScore } from '../encoding';
import { parseJSONRecords, unknownJsonKeys } from '../jsonRecords';
import { autoMap, csvUpserts, jsonUpserts, setColumnRole } from '../mapping';
import { slugifyDatasetName } from '../slugify';
import { diffSide, DIFF_TOKEN_BUDGET, wordDiff } from '../wordDiff';
import { editorTextToValue, sameValue, storedType } from '../itemValue';

const hex = (value: string) => Uint8Array.from(value.match(/../g) ?? [], (h) => parseInt(h, 16));

describe('slugifyDatasetName matches the server', () => {
  it.each([
    ['Customer Support QA!', 'customer-support-qa'],
    ['snake_case name', 'snake-case-name'],
    ['بيانات التقييم', 'بيانات-التقييم'],
    ['قيِّم', 'قيِّم'],
    ['Café crème', 'café-crème'],
    ['  a -- b  ', 'a-b'],
  ])('%s', (name, slug) => {
    expect(slugifyDatasetName(name)).toBe(slug);
  });
});

// [label, bytes (hex) encoded in the legacy code page, label the server reports]
const ENCODING_CASES: [string, string, string][] = [
  ['arabic header and body', 'c7e1d3c4c7e12cc7e1c5ccc7c8c90ae3c720e5ed20dac7d5e3c920c7e1e3e3e1dfc920c7e1dad1c8edc920c7e1d3dae6cfedc9bf2cc7e1d1edc7d60adfe320dacfcf20c3edc7e320c7e1c3d3c8e6dabf2cd3c8dac90a', 'windows-1256'],
  ['persian', '712c610a81d1d3d4208dedd3cabf2c90d2c7d1d4208ed1dd0a', 'windows-1256'],
  ['french semicolon', '7175657374696f6e3b616e737765720a436166e93f3b4372e86d65206272fb6ce9650ac7612076613f3b5472e873206269656e0a', 'windows-1252'],
  ['german', '712c610a4772fcdf6520617573206465722053747261df652c536368f66e0a', 'windows-1252'],
  ['spanish', '712c610a5365f16f722c20bf63f36d6f20657374e13f2c4d7579206269656e0a', 'windows-1252'],
  ['a-grave', '712c610a496c2068616269746520e0204c6f6e647265732e2c4f75690a', 'windows-1252'],
  ['a-grave 2', '712c610a456c6c6520766120e0206c27e9636f6c6520e020706965642e2c4f75690a', 'windows-1252'],
  ['multiplication sign', '712c610a3220d720332c360a', 'windows-1252'],
  ['not sign', '712c610aac502c767261690a', 'windows-1252'],
  ['short arabic', '712c610ac7e1d4c7ed20e620c7e1dee5e6c92ce4dae30a', 'windows-1256'],
  ['ascii', '712c610a706c61696e2061736369692c6f6e6c790a', 'utf-8'],
];

describe('browser encoding detection matches the server', () => {
  it.each(ENCODING_CASES)('%s', (_name, bytes, label) => {
    const raw = hex(bytes);
    expect(detectCSVEncoding(raw)).toBe(label);
    // the preview warns only about text that looks mis-decoded
    expect(legacyTextScore(new TextDecoder(label).decode(raw)) < 0).toBe(false);
  });
});

describe('draft JSON / JSONL import', () => {
  it('flags every bad line with its line number and keeps the good ones', () => {
    const r = parseJSONRecords('{"input": "ok"}\n{bad json}\n\n["array"]\n{"input": "fine"}\n', 'rows.jsonl');
    expect(r.errors).toEqual([
      { where: 'Line 2', message: 'is not valid JSON' },
      { where: 'Line 4', message: 'must be a JSON object' },
    ]);
    expect(r.total).toBe(4);
    expect(r.rows).toHaveLength(2);
  });

  it('imports a JSON array with the server aliases and lists the keys it will not read', () => {
    const r = parseJSONRecords('[{"id": 1, "input": "q1", "expected": "a1", "extra": true}, {"item_id": "b", "input": {"q": 2}}]', 'rows.json');
    expect(r.format).toBe('json');
    expect(unknownJsonKeys(r.rows)).toEqual(['extra']);
    expect(jsonUpserts(r.rows)).toEqual([
      { item_id: '1', input: 'q1', expected_output: 'a1' },
      { item_id: 'b', input: { q: 2 } },
    ]);
  });

  it('reads ids and labels like the server (comma strings, non-string list items, id 0)', () => {
    const r = parseJSONRecords(
      '{"item_id": " a ", "input": "q1", "labels": "gold, hard"}\n{"id": 0, "input": "q2", "labels": ["x", 3, ""]}\n',
      'rows.jsonl',
    );
    expect(jsonUpserts(r.rows)).toEqual([
      { item_id: 'a', input: 'q1', labels: ['gold', 'hard'] },
      { input: 'q2', labels: ['x', '3'] },
    ]);
  });
});

describe('column mapping', () => {
  it('keeps unrecognised columns as Metadata, and one Item ID demotes the previous one', () => {
    const headers = ['prompt_text', 'gold', 'ref'];
    let m = autoMap(headers);
    expect(m.input).toEqual([]); // nothing recognised as Input: the wizard asks the user to choose one
    expect(m.metadata).toEqual(headers);
    m = setColumnRole(m, 'prompt_text', 'input');
    m = setColumnRole(m, 'ref', 'id');
    m = setColumnRole(m, 'gold', 'id');
    expect(m.id).toBe('gold');
    expect(m.metadata).toEqual(['ref']);
    expect(csvUpserts(headers, [['q', 'g1', 'r1']], m)).toEqual([{ item_id: 'g1', input: 'q', metadata: { ref: 'r1' } }]);
  });
});

describe('item field values', () => {
  it('an untouched multiline string counts as unchanged even when a textarea reports \\n for \\r\\n', () => {
    expect(sameValue('line 1\r\nline 2', 'line 1\nline 2')).toBe(true);
  });
  it('a string stays a string in Text mode and only becomes a number in JSON mode', () => {
    expect(storedType('51')).toBe('string');
    expect(editorTextToValue('51', 'text')).toEqual({ ok: true, value: '51' });
    expect(editorTextToValue('51', 'json')).toEqual({ ok: true, value: 51 });
    expect(editorTextToValue('abc', 'json').ok).toBe(false);
    expect(sameValue('51', 51)).toBe(false); // a type-only change is a change
  });
});

describe('word diff on long fields', () => {
  it('marks only the real change in a long field', () => {
    const words = Array.from({ length: 8000 }, (_, i) => `w${i}`).join(' ');
    const ops = wordDiff(words, words.replace('w4000', 'CHANGED'));
    expect(ops).not.toBeNull();
    expect(ops!.filter((o) => o.kind === 'del').map((o) => o.text)).toEqual(['w4000']);
    expect(ops!.filter((o) => o.kind === 'add').map((o) => o.text)).toEqual(['CHANGED']);
    expect(diffSide(ops!, 'after').map((o) => o.text).join('')).toContain('CHANGED');
  });
  it('gives up (no highlights) when a huge field changes everywhere', () => {
    const a = Array.from({ length: DIFF_TOKEN_BUDGET }, (_, i) => `a${i}`).join(' ');
    const b = Array.from({ length: DIFF_TOKEN_BUDGET }, (_, i) => `b${i}`).join(' ');
    expect(wordDiff(a, b)).toBeNull();
  });
  it('small diffs are word-level', () => {
    const ops = wordDiff('the cat sat', 'the dog sat')!;
    expect(ops.filter((o) => o.text.trim()).map((o) => `${o.kind}:${o.text.trim()}`)).toEqual(['same:the', 'del:cat', 'add:dog', 'same:sat']);
  });
});
