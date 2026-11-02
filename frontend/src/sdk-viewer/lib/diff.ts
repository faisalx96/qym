/** Word-level diff (LCS) between the expected and the actual output. */
export interface DiffPart {
  type: 'same' | 'del' | 'ins';
  text: string;
}

const MAX_TOKENS = 1500;

function tokens(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

/** `del` = in `a` only (expected), `ins` = in `b` only (actual). */
export function wordDiff(a: string, b: string): DiffPart[] {
  const x = tokens(a);
  const y = tokens(b);
  if (x.length > MAX_TOKENS || y.length > MAX_TOKENS) {
    return a === b
      ? [{ type: 'same', text: a }]
      : [
          { type: 'del', text: a },
          { type: 'ins', text: b },
        ];
  }
  const w = y.length + 1;
  const lcs = new Uint16Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--) {
    for (let j = y.length - 1; j >= 0; j--) {
      const down = lcs[(i + 1) * w + j] ?? 0;
      const right = lcs[i * w + j + 1] ?? 0;
      lcs[i * w + j] = x[i] === y[j] ? (lcs[(i + 1) * w + j + 1] ?? 0) + 1 : Math.max(down, right);
    }
  }
  const parts: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.type === type) last.text += text;
    else parts.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < x.length && j < y.length) {
    const xi = x[i] ?? '';
    const yj = y[j] ?? '';
    if (xi === yj) {
      push('same', xi);
      i++;
      j++;
    } else if ((lcs[(i + 1) * w + j] ?? 0) >= (lcs[i * w + j + 1] ?? 0)) {
      push('del', xi);
      i++;
    } else {
      push('ins', yj);
      j++;
    }
  }
  while (i < x.length) push('del', x[i++] ?? '');
  while (j < y.length) push('ins', y[j++] ?? '');
  return parts;
}
