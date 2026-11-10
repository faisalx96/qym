import { recordOf } from './summary';

export function stringsOf(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export function recordsOf(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.flatMap((item) => (recordOf(item) ? [recordOf(item)!] : [])) : [];
}
