/**
 * JSON-pointer helpers, env_overrides <-> flat `{pointer: value}` conversion and the
 * RHF-safe field-name encoding.
 *
 * Pointers are RFC 6901, relative to `env_overrides` unless a function says
 * "document pointer" (`/env_overrides/…`, `/slot_bindings/…`, `/evaluator/…`).
 */
import type { DescriptorEntry, FormDescriptor, JsonObject, JsonValue, Values } from './types';

// ── Plain-data helpers ───────────────────────────────────────────────────

export function isPlainObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function deepCopy<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Deep equality by JSON text (undefined only equals undefined). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** JSON with sorted keys: compares documents built in different orders. */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  if (isPlainObject(value)) {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stableStringify(value[k]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** A `{"sweep": [...]}` value (services/eval_config.is_sweep). */
export function isSweepValue(value: unknown): value is { sweep: JsonValue[] } {
  return isPlainObject(value) && Object.keys(value).length === 1 && Array.isArray(value['sweep']);
}

/** Whether a sweep value is anywhere under `node`. */
export function containsSweep(node: unknown): boolean {
  if (isSweepValue(node)) return true;
  if (Array.isArray(node)) return node.some(containsSweep);
  return isPlainObject(node) && Object.keys(node).some((k) => containsSweep(node[k]));
}

export function has(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// ── Pointers ─────────────────────────────────────────────────────────────

export function escapeSegment(segment: string | number): string {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

export function unescapeSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

export function splitPointer(pointer: string): string[] {
  if (!pointer) return [];
  return pointer.split('/').slice(1).map(unescapeSegment);
}

export function joinPointer(segments: readonly string[]): string {
  return segments.map((s) => '/' + escapeSegment(s)).join('');
}

export function appendSegment(pointer: string, segment: string | number): string {
  return pointer + '/' + escapeSegment(segment);
}

export function isUnder(pointer: string, prefix: string): boolean {
  return pointer === prefix || pointer.startsWith(prefix + '/');
}

export function isTemplateSegment(segment: string): boolean {
  return segment.length > 2 && segment.startsWith('{') && segment.endsWith('}');
}

/** A child's concrete pointer: its template relative to the parent's template. */
export function childPointer(parentTemplate: string, parentConcrete: string, childTemplate: string): string {
  return parentConcrete + childTemplate.slice(parentTemplate.length);
}

/**
 * The descriptor template for a concrete pointer, walking the descriptor tree
 * (mirrors services/eval_schema_form.match_pointer: literal names win over role
 * rows, which win over collection keys). Null when no entry describes it.
 */
export function matchPointer(
  descriptor: Pick<FormDescriptor, 'root' | 'fields'>,
  pointer: string,
): string | null {
  const fields = descriptor.fields;
  let candidates: string[] = descriptor.root ?? [];
  let current: string | null = null;
  for (const segment of splitPointer(pointer)) {
    let chosen: string | null = null;
    for (const rank of ['literal', 'row', 'key'] as const) {
      for (const child of candidates) {
        const entry = fields[child];
        if (!entry) continue;
        const last = entry.path[entry.path.length - 1] ?? '';
        if (rank === 'literal') {
          if (!isTemplateSegment(last) && last === segment) chosen = child;
        } else if (rank === 'row') {
          if (entry.kind === 'role_table' && (entry.rows ?? []).some((r) => r.key === segment))
            chosen = child;
        } else if (isTemplateSegment(last) && entry.kind !== 'role_table') {
          chosen = child;
        }
        if (chosen) break;
      }
      if (chosen) break;
    }
    if (!chosen) return null;
    current = chosen;
    const entry: DescriptorEntry | undefined = fields[chosen];
    candidates = (entry?.children ?? []).slice();
    if (entry?.additional_pointer) candidates.push(entry.additional_pointer);
  }
  return current;
}

/** Template for a concrete pointer by shape only (exact match first, then fewest wildcards). */
export function matchTemplate(fields: Record<string, DescriptorEntry>, concrete: string): string | null {
  if (has(fields, concrete)) return concrete;
  const segs = splitPointer(concrete);
  let best: string | null = null;
  let bestWild = Infinity;
  for (const template of Object.keys(fields)) {
    const parts = splitPointer(template);
    if (parts.length !== segs.length) continue;
    let wild = 0;
    const fits = parts.every((part, i) => {
      if (part === segs[i]) return true;
      if (isTemplateSegment(part)) {
        wild += 1;
        return true;
      }
      return false;
    });
    if (fits && wild < bestWild) {
      best = template;
      bestWild = wild;
    }
  }
  return best;
}

// ── env_overrides <-> flat values ────────────────────────────────────────

/**
 * env_overrides -> flat `{pointer: value}`. A leaf is a descriptor `field`, a sweep
 * value, or any non-object; objects are descended. Null/undefined are skipped
 * ("inherit").
 */
export function flattenOverrides(
  node: unknown,
  fields: Record<string, DescriptorEntry>,
  pointer = '',
  out: Values = {},
): Values {
  if (node === null || node === undefined) return out;
  if (pointer) {
    const template = matchTemplate(fields, pointer);
    const entry = template ? fields[template] : null;
    if (!isPlainObject(node) || isSweepValue(node) || (entry && entry.kind === 'field')) {
      out[pointer] = deepCopy(node) as JsonValue;
      return out;
    }
  }
  if (!isPlainObject(node)) return out;
  for (const key of Object.keys(node)) flattenOverrides(node[key], fields, appendSegment(pointer, key), out);
  return out;
}

/** env_overrides from the flat `{pointer: value}` edits. */
export function buildOverrides(values: Values): JsonObject {
  const out: JsonObject = {};
  for (const pointer of Object.keys(values).sort()) {
    const segments = splitPointer(pointer);
    if (!segments.length) continue;
    let node = out;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i] as string;
      const next = node[seg];
      if (!isPlainObject(next)) node[seg] = {};
      node = node[seg] as JsonObject;
    }
    node[segments[segments.length - 1] as string] = values[pointer] as JsonValue;
  }
  return out;
}

// ── React Hook Form field names ──────────────────────────────────────────
// RHF reads "." and "[" as nesting and numeric segments as array indexes, so a
// pointer cannot be a field name. Encoding: prefix "f"; characters outside
// [A-Za-z0-9-] become "_<hex codepoint>_" ("_" itself too), which is reversible.

const SAFE = /[A-Za-z0-9-]/;

export function pointerToFieldName(pointer: string): string {
  let out = 'f';
  for (const ch of pointer) {
    out += SAFE.test(ch) ? ch : `_${(ch.codePointAt(0) as number).toString(16)}_`;
  }
  return out;
}

export function fieldNameToPointer(name: string): string {
  const body = name.startsWith('f') ? name.slice(1) : name;
  return body.replace(/_([0-9a-f]+)_/g, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)));
}

/** The best-matching known pointer for an error pointer (exact, else the longest ancestor). */
export function nearestPointer(pointer: string, candidates: Iterable<string>): string | null {
  let best: string | null = null;
  for (const candidate of candidates) {
    if (candidate === pointer) return candidate;
    if (pointer.startsWith(candidate + '/') && (best === null || candidate.length > best.length))
      best = candidate;
  }
  return best;
}
