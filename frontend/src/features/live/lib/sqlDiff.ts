import {
  DIFF_CHAR_BUDGET,
  DIFF_EDIT_BUDGET,
  DIFF_TOKEN_BUDGET,
  diffSequence,
} from '@/features/datasets/lib/wordDiff';

export interface Segment {
  text: string;
  kind: 'same' | 'only';
}

/** Lossless SQL tokens, including escaped quotes and comments. */
export function sqlTokens(text: string): string[] {
  return (
    text.match(
      /'(?:''|[^'])*'?|"(?:""|[^"])*"?|`(?:``|[^`])*`?|--[^\r\n]*|\/\*[\s\S]*?(?:\*\/|$)|\s+|[(),;=<>!+*/.|-]|[^\s'"`(),;=<>!+*/.|-]+/g,
    ) ?? []
  );
}

const whitespace = (token: string) => /^\s+$/.test(token);
const tokenKey = (token: string) =>
  whitespace(token) ? ' ' : /^['"`]/.test(token) ? token : token.toUpperCase();

export function sqlDiff(
  left: string,
  right: string,
  { ignoreFormatting = true } = {},
): {
  left: Segment[];
  right: Segment[];
  identical: boolean;
  tooLarge: boolean;
} {
  const fallback = () => ({
    left: [{ text: left, kind: 'same' as const }],
    right: [{ text: right, kind: 'same' as const }],
    identical: left === right,
    tooLarge: true,
  });
  if (left.length + right.length > DIFF_CHAR_BUDGET) return fallback();
  const a = sqlTokens(left);
  const b = sqlTokens(right);
  // Whitespace stays in the rendering stream, but cannot introduce edits in formatting mode.
  const keys = (tokens: string[]) =>
    ignoreFormatting ? tokens.filter((token) => !whitespace(token)).map(tokenKey) : tokens;
  const ak = keys(a);
  const bk = keys(b);
  let start = 0;
  while (start < ak.length && start < bk.length && ak[start] === bk[start]) start++;
  let endA = ak.length;
  let endB = bk.length;
  while (endA > start && endB > start && ak[endA - 1] === bk[endB - 1]) {
    endA--;
    endB--;
  }
  if (endA - start + endB - start > DIFF_TOKEN_BUDGET) return fallback();
  const ops = diffSequence(ak.slice(start, endA), bk.slice(start, endB), DIFF_EDIT_BUDGET);
  if (!ops) return fallback();
  const kindsA: Segment['kind'][] = Array.from({ length: start }, () => 'same');
  const kindsB: Segment['kind'][] = [...kindsA];
  for (const op of ops) {
    if (op.kind !== 'add') kindsA.push(op.kind === 'same' ? 'same' : 'only');
    if (op.kind !== 'del') kindsB.push(op.kind === 'same' ? 'same' : 'only');
  }
  const segments = (tokens: string[], kinds: Segment['kind'][]): Segment[] => {
    const result: Segment[] = [];
    let index = 0;
    for (const text of tokens) {
      const kind = ignoreFormatting && whitespace(text) ? 'same' : (kinds[index++] ?? 'same');
      const previous = result.at(-1);
      if (previous?.kind === kind) previous.text += text;
      else result.push({ text, kind });
    }
    return result;
  };
  return {
    left: segments(a, kindsA),
    right: segments(b, kindsB),
    identical: ops.every((op) => op.kind === 'same'),
    tooLarge: false,
  };
}

export interface StatementPairing {
  /** One agent index per judge statement, in judge order. Indices preserve duplicate statements. */
  pairs: (number | null)[];
  unpaired: number[];
}

export function pairStatements(
  agent: string[],
  judge: { text: string | null; agentIndex: number | null }[],
): StatementPairing {
  const tokens = (text: string) =>
    new Set(
      sqlTokens(text)
        .filter((token) => !whitespace(token))
        .map(tokenKey),
    );
  const candidates = agent.map(tokens);
  const pairs = judge.map(({ text, agentIndex }) => {
    if (agentIndex !== null) {
      return Number.isInteger(agentIndex) && agentIndex >= 0 && agentIndex < agent.length ? agentIndex : null;
    }
    if (!text) return null;
    const query = tokens(text);
    let best: number | null = null;
    let highest = 0;
    candidates.forEach((candidate, index) => {
      const common = [...query].filter((token) => candidate.has(token)).length;
      const union = query.size + candidate.size - common;
      const score = union ? common / union : 0;
      if (score >= 0.2 && score > highest) {
        best = index;
        highest = score;
      }
    });
    return best;
  });
  const used = new Set(pairs);
  return { pairs, unpaired: agent.flatMap((_, index) => (used.has(index) ? [] : [index])) };
}
