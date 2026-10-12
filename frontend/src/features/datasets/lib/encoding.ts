/**
 * CSV encoding detection, mirroring `_detect_csv_encoding` / `_legacy_text_score`
 * in api/datasets.py. BOMs and strict UTF-8 win; otherwise the legacy single-byte
 * code page whose decoded sample looks most like real words wins (Arabic read as
 * Windows-1252 becomes runs of accented Latin letters and scores badly).
 */
export const CSV_ENCODINGS: { value: string; label: string }[] = [
  { value: 'utf-8', label: 'UTF-8' },
  { value: 'utf-16le', label: 'UTF-16 LE' },
  { value: 'utf-16be', label: 'UTF-16 BE' },
  { value: 'windows-1256', label: 'Windows-1256 (Arabic)' },
  { value: 'iso-8859-6', label: 'ISO-8859-6 (Arabic)' },
  { value: 'windows-1252', label: 'Windows-1252 (Western European)' },
];

/** Tried in this order when a file is not UTF-8; ties keep the historic Windows-1252. */
export const LEGACY_CSV_ENCODINGS = ['windows-1252', 'windows-1256', 'iso-8859-6'] as const;

export const ENCODING_SAMPLE_CHARS = 262144;

const NEUTRAL_TEXT_CHARS = new Set(
  Array.from(
    ' «»“”‘’„–—…•€£¥°©®™§·¿¡×¬،؛؟٪٫٬',
  ),
);

export function encodingLabel(value: string): string {
  return CSV_ENCODINGS.find((e) => e.value === value)?.label ?? value;
}

export function isArabicCodePoint(cp: number): boolean {
  return (
    (cp >= 0x0600 && cp <= 0x06ff) ||
    (cp >= 0x0750 && cp <= 0x077f) ||
    (cp >= 0x08a0 && cp <= 0x08ff) ||
    (cp >= 0xfb50 && cp <= 0xfdff) ||
    (cp >= 0xfe70 && cp <= 0xfeff)
  );
}

const LETTER_OR_MARK = /[\p{L}\p{M}]/u;
const NUMBER_OR_SPACE = /[\p{N}\p{Z}]/u;

/** How much a legacy-decoded text looks like real words (higher is better). */
export function legacyTextScore(text: string): number {
  let total = 0;
  let word: string[] = [];
  const flush = () => {
    const nonAscii = word.filter((ch) => (ch.codePointAt(0) ?? 0) > 0x7f);
    if (nonAscii.length && word.length > 1) {
      const arabic = word.some((ch) => isArabicCodePoint(ch.codePointAt(0) ?? 0));
      const latin = word.some((ch) => (ch.codePointAt(0) ?? 0) < 0x250);
      const other = word.some((ch) => {
        const cp = ch.codePointAt(0) ?? 0;
        return cp >= 0x250 && !isArabicCodePoint(cp);
      });
      if (other || (arabic && latin)) total -= 2 * nonAscii.length;
      else if (arabic) total += word.length;
      else if (2 * nonAscii.length <= word.length) total += nonAscii.length;
      else total -= nonAscii.length;
    }
    word = [];
  };
  for (const ch of text) {
    if (LETTER_OR_MARK.test(ch)) {
      word.push(ch);
      continue;
    }
    flush();
    const cp = ch.codePointAt(0) ?? 0;
    if (cp > 0x7f && !NUMBER_OR_SPACE.test(ch) && !NEUTRAL_TEXT_CHARS.has(ch)) total -= 1;
  }
  flush();
  return total;
}

export function decodeBytes(bytes: Uint8Array, encoding: string): string {
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

/** Detected encoding value (one of CSV_ENCODINGS) for raw CSV bytes. */
export function detectCSVEncoding(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return 'utf-16le';
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return 'utf-16be';
  try {
    decodeBytes(bytes, 'utf-8');
    return 'utf-8';
  } catch {
    /* not UTF-8: score the legacy code pages */
  }
  let best: { encoding: string; score: number } | null = null;
  for (const encoding of LEGACY_CSV_ENCODINGS) {
    let text: string;
    try {
      text = decodeBytes(bytes.subarray(0, ENCODING_SAMPLE_CHARS), encoding);
    } catch {
      continue;
    }
    const score = legacyTextScore(text);
    if (!best || score > best.score) best = { encoding, score };
  }
  return best ? best.encoding : 'windows-1252';
}

/** Text looks mis-decoded (replacement chars or a negative word score). */
export function looksGarbled(text: string): boolean {
  if (text.includes('�')) return true;
  return legacyTextScore(text.slice(0, ENCODING_SAMPLE_CHARS)) < 0;
}
