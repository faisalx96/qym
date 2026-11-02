/**
 * A global sweep: several values chosen once on a global ("All roles" / "All endpoints") row are
 * written as the same `{ sweep: [...] }` to every target and the targets are linked (zipped), so one
 * launch makes one run per value, not one per combination of targets.
 */
import { setValue } from './layering';
import { isSweepValue } from './pointers';
import { cleanLinks, startSweep, stopSweep } from './sweeps';
import type { DescriptorEntry, JsonValue, LaunchDocument } from './types';

const specPointer = (docPointer: string) => '/env_overrides' + docPointer;

/** Writes `values` as the sweep of every target and links the targets into one group. */
export function setGlobalSweep(
  doc: LaunchDocument,
  pointers: readonly string[],
  values: JsonValue[],
): LaunchDocument {
  let next = doc;
  for (const p of pointers) next = setValue(next, p, { sweep: values });
  return { ...next, links: withGroup(doc.links, pointers.map(specPointer)) };
}

/** Starts a global sweep from the shared current value (or a boolean's both options). */
export function startGlobalSweep(
  doc: LaunchDocument,
  entry: DescriptorEntry,
  pointers: readonly string[],
  current: JsonValue | undefined,
): LaunchDocument {
  return setGlobalSweep(doc, pointers, startSweep(entry, current).sweep);
}

/** "Single value": every target keeps the first value; the group is dropped. */
export function stopGlobalSweep(doc: LaunchDocument, pointers: readonly string[]): LaunchDocument {
  let next = doc;
  for (const p of pointers) next = setValue(next, p, stopSweep(doc.values[p]));
  const gone = new Set(pointers.map(specPointer));
  const kept = (next.links ?? []).map((g) => g.filter((p) => !gone.has(p))).filter((g) => g.length >= 2);
  return { ...next, links: kept.length ? kept : undefined };
}

/** The sweep every target shares, or undefined when the targets differ or are not swept. */
export function sharedSweep(
  doc: Pick<LaunchDocument, 'values'>,
  pointers: readonly string[],
): JsonValue[] | undefined {
  if (!pointers.length) return undefined;
  const first = doc.values[pointers[0] as string];
  if (!isSweepValue(first)) return undefined;
  const sig = JSON.stringify(first.sweep);
  return pointers.every((p) => {
    const v = doc.values[p];
    return isSweepValue(v) && JSON.stringify(v.sweep) === sig;
  })
    ? first.sweep
    : undefined;
}

function withGroup(links: readonly string[][] | undefined, group: string[]): string[][] | undefined {
  if (group.length < 2) return links as string[][] | undefined;
  const swept = new Set<string>([...(links ?? []).flat(), ...group]);
  const others = cleanLinks(links, swept)
    .map((g) => g.filter((p) => !group.includes(p)))
    .filter((g) => g.length >= 2);
  return others.concat([group]);
}
