/** Deterministic identicon (shell.js identiconHTML): FNV-1a hue + symmetric 5x5. */
export interface IdenticonModel {
  hue: number;
  rows: (string | null)[][];
}

export function identiconModel(seed: string): IdenticonModel {
  const s = String(seed ?? '');
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h >>>= 0;
  const hue = h % 360;
  const palette = [`hsl(${hue}, 66%, 58%)`, `hsl(${hue}, 70%, 40%)`];
  const halves: (string | null)[][] = [];
  let bits = h;
  let filled = 0;
  for (let row = 0; row < 5; row++) {
    const r: (string | null)[] = [null, null, null];
    for (let col = 0; col < 3; col++) {
      bits = Math.imul(bits ^ (row * 3 + col + 0x9e3779b9), 16777619) >>> 0;
      bits = (bits ^ (bits >>> 13)) >>> 0;
      const v = bits % 4;
      r[col] = v >= 2 ? (palette[v - 2] ?? null) : null;
      if (r[col]) filled++;
    }
    halves.push(r);
  }
  for (let k = 0; filled < 4 && k < 30; k++) {
    bits = Math.imul(bits ^ (k + 0x85ebca6b), 16777619) >>> 0;
    bits = (bits ^ (bits >>> 13)) >>> 0;
    const at = bits % 15;
    const fr = (at / 3) | 0;
    const fc = at % 3;
    const row = halves[fr]!;
    if (!row[fc]) {
      row[fc] = palette[bits % 2] ?? null;
      filled++;
    }
  }
  const rows = halves.map((half) => [half[0]!, half[1]!, half[2]!, half[1]!, half[0]!]);
  return { hue, rows };
}
