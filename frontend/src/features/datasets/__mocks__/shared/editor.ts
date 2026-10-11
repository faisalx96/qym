/* Pure Text/JSON editor semantics (brief §3 "the core editing contract"): strings stay strings;
   switching to JSON mode makes `42` a number and the type tag shows `string → number`. */

export type EditorMode = 'text' | 'json';
export type ValueType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

export function valueType(v: unknown): ValueType {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  return 'object';
}

export function initialMode(v: unknown): EditorMode {
  return typeof v === 'string' ? 'text' : 'json';
}

export function initialText(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v === undefined) return '';
  return JSON.stringify(v, null, 2);
}

export interface Evaluation {
  /** The value that would be saved (undefined when invalid). */
  next: unknown;
  valid: boolean;
  changed: boolean;
  storedType: ValueType;
  nextType: ValueType | null;
  typeChanged: boolean;
  status: string;
  tone: 'muted' | 'success' | 'warning' | 'danger';
}

export function evaluate(stored: unknown, mode: EditorMode, text: string): Evaluation {
  const storedType = valueType(stored);
  if (mode === 'text') {
    const changed = text !== (typeof stored === 'string' ? stored : initialText(stored));
    const nextType: ValueType = 'string';
    const typeChanged = storedType !== 'string';
    return {
      next: text,
      valid: true,
      changed: changed || typeChanged,
      storedType,
      nextType,
      typeChanged,
      status: !changed && !typeChanged ? 'unchanged' : typeChanged ? 'will be saved as string' : 'edited',
      tone: !changed && !typeChanged ? 'muted' : typeChanged ? 'warning' : 'success',
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      next: undefined,
      valid: false,
      changed: true,
      storedType,
      nextType: null,
      typeChanged: false,
      status: 'Not valid JSON. Switch to Text to save it as a string.',
      tone: 'danger',
    };
  }
  const nextType = valueType(parsed);
  const typeChanged = nextType !== storedType;
  const changed = JSON.stringify(parsed) !== JSON.stringify(stored);
  return {
    next: parsed,
    valid: true,
    changed,
    storedType,
    nextType,
    typeChanged,
    status: !changed ? 'unchanged' : typeChanged ? `will be saved as ${nextType}` : 'edited',
    tone: !changed ? 'muted' : typeChanged ? 'warning' : 'success',
  };
}
