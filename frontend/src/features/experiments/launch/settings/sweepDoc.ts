import {
  buildSpec,
  pruneLinks,
  sameValue,
  setConfig,
  setValue,
  stopSweep,
  type FormContext,
  type JsonValue,
  type LaunchDocument,
} from '../model';

/** Drops linked groups whose values stopped being swept (the service rejects stale links). */
export function withPrunedLinks(
  doc: LaunchDocument,
  ctx: Pick<FormContext, 'evaluatorPanel'>,
): LaunchDocument {
  if (!doc.links) return doc;
  const links = pruneLinks(doc.links, buildSpec(doc, ctx.evaluatorPanel));
  return sameValue(links, doc.links) ? doc : { ...doc, links };
}

/** Where an axis pointer (spec pointer) lives in the document. */
export type AxisTarget =
  | { kind: 'setting'; pointer: string }
  | { kind: 'evaluator'; name: string }
  | { kind: 'model' }
  | { kind: 'other' };

export function axisTarget(specPointer: string): AxisTarget {
  if (specPointer.startsWith('/env_overrides/'))
    return { kind: 'setting', pointer: specPointer.slice('/env_overrides'.length) };
  const m = /^\/evaluator\/config\/([^/]+)$/.exec(specPointer);
  if (m) return { kind: 'evaluator', name: m[1] as string };
  if (specPointer.startsWith('/slot_bindings/')) return { kind: 'model' };
  return { kind: 'other' };
}

/** Writes a swept value (or a single one when `value` is not a sweep) at an axis. */
export function writeAxis(
  doc: LaunchDocument,
  target: AxisTarget,
  value: JsonValue | undefined,
): LaunchDocument {
  if (target.kind === 'setting') return setValue(doc, target.pointer, value);
  if (target.kind === 'evaluator') return setConfig(doc, target.name, value);
  return doc;
}

/** "Single value" on an axis: keep the first value. */
export function singleAxis(doc: LaunchDocument, target: AxisTarget, current: unknown): LaunchDocument {
  return writeAxis(doc, target, stopSweep(current));
}
