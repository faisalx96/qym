import { describe, expect, it } from 'vitest';
import {
  DIFF_CHAR_BUDGET,
  DIFF_TOKEN_BUDGET,
  DIFF_EDIT_BUDGET,
  diffSequence,
} from '@/features/datasets/lib/wordDiff';
import { pairStatements, sqlDiff, sqlTokens } from '../lib/sqlDiff';

describe('SQL tokens and diff', () => {
  it('keeps quotes, escapes, comments, Arabic and whitespace losslessly', () => {
    const text = "SELECT 'a, (b)', 'it''s', \"a\"\"b\", `a``b`, 'الرياض' -- comma, (\n/* keep ) */ FROM t;";
    const tokens = sqlTokens(text);
    expect(tokens.join('')).toBe(text);
    expect(tokens).toEqual(
      expect.arrayContaining([
        "'a, (b)'",
        "'it''s'",
        '"a""b"',
        '`a``b`',
        "'الرياض'",
        '-- comma, (',
        '/* keep ) */',
      ]),
    );
  });
  it('ignores case and whitespace, including inserted whitespace around punctuation', () => {
    const left = ' SELECT a,b FROM t\nWHERE a=1;';
    const right = 'select A, B from T where A = 1;  ';
    const result = sqlDiff(left, right);
    expect(result).toEqual({
      left: [{ text: left, kind: 'same' }],
      right: [{ text: right, kind: 'same' }],
      identical: true,
      tooLarge: false,
    });
    expect(sqlDiff(left, right, { ignoreFormatting: false }).identical).toBe(false);
  });
  it.each([
    ["SELECT 'old'", "SELECT 'new'", "'old'", "'new'"],
    ["SELECT 'الرياض'", "SELECT 'جدة'", "'الرياض'", "'جدة'"],
    ['SELECT a FROM t', 'SELECT a FROM t WHERE a=1', '', 'WHEREa=1'],
    ['SELECT a,b FROM t', 'SELECT b,a FROM t', 'a,', ',a'],
    ['SELECT a -- before', 'SELECT a -- after', '-- before', '-- after'],
    ['SELECT "MixedCase"', 'SELECT "mixedcase"', '"MixedCase"', '"mixedcase"'],
  ])('marks changed tokens and preserves both strings %#', (left, right, removed, added) => {
    const result = sqlDiff(left, right);
    expect(result.identical).toBe(false);
    expect(result.left.map((part) => part.text).join('')).toBe(left);
    expect(result.right.map((part) => part.text).join('')).toBe(right);
    expect(
      result.left
        .filter((part) => part.kind === 'only')
        .map((part) => part.text)
        .join(''),
    ).toBe(removed);
    expect(
      result.right
        .filter((part) => part.kind === 'only')
        .map((part) => part.text)
        .join(''),
    ).toBe(added);
    for (const side of [result.left, result.right]) {
      expect(side.every((part, index) => index === 0 || side[index - 1]?.kind !== part.kind)).toBe(true);
    }
  });
  it.each([
    ['x'.repeat(DIFF_CHAR_BUDGET + 1), ''],
    [Array.from({ length: DIFF_TOKEN_BUDGET }, (_, i) => `a${i}`).join(' '), 'SELECT x'],
    [Array.from({ length: DIFF_EDIT_BUDGET + 1 }, (_, i) => `a${i}`).join(' '), ''],
  ])('returns unmarked originals over budget %#', (left, right) => {
    expect(sqlDiff(left, right)).toEqual({
      left: [{ text: left, kind: 'same' }],
      right: [{ text: right, kind: 'same' }],
      identical: false,
      tooLarge: true,
    });
  });
  it('normalizes unquoted comment case without splitting the comment token', () => {
    expect(sqlDiff('SELECT a -- note', 'select A -- NOTE').identical).toBe(true);
  });
  it('exports the bounded sequence core and handles empty inputs', () => {
    expect(diffSequence(['a'], ['b'], 1)).toBeNull();
    expect(diffSequence(['a'], ['b'], 2)).toEqual([
      { kind: 'del', text: 'a' },
      { kind: 'add', text: 'b' },
    ]);
    expect(sqlDiff('', '').identical).toBe(true);
    expect(sqlDiff('', 'SELECT').right).toEqual([{ text: 'SELECT', kind: 'only' }]);
  });
});

describe('statement pairing', () => {
  const agent = ['SELECT city FROM cities', 'SELECT salary FROM employees', 'SHOW TABLES'];
  it('honors worker indices, including repeated indices and invalid indices', () => {
    expect(
      pairStatements(agent, [
        { text: agent[0]!, agentIndex: 1 },
        { text: null, agentIndex: 1 },
        { text: agent[0]!, agentIndex: 9 },
      ]),
    ).toEqual({ pairs: [1, 1, null], unpaired: [0, 2] });
  });
  it('finds the most similar SQL and rejects unrelated or absent SQL', () => {
    expect(
      pairStatements(agent, [
        { text: 'select SALARY\nfrom employees', agentIndex: null },
        { text: 'DROP unrelated', agentIndex: null },
        { text: null, agentIndex: null },
      ]),
    ).toEqual({ pairs: [1, null, null], unpaired: [0, 2] });
    expect(pairStatements([], [{ text: 'SELECT a', agentIndex: null }])).toEqual({
      pairs: [null],
      unpaired: [],
    });
  });
});
