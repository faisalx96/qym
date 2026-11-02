import { sameValue } from '../model';
import type { LeafNode } from '../model';

/** Whether a rebuilt node renders the same as the previous one (the tree is rebuilt on every edit). */
export function leafEqual(a: LeafNode, b: LeafNode): boolean {
  return (
    a.pointer === b.pointer &&
    a.visible === b.visible &&
    a.changed === b.changed &&
    a.swept === b.swept &&
    a.boundBy === b.boundBy &&
    a.removable === b.removable &&
    a.entry === b.entry &&
    a.kind === b.kind &&
    a.label === b.label &&
    a.title === b.title &&
    a.hint === b.hint &&
    a.placeholder === b.placeholder &&
    a.edit.type === b.edit.type &&
    a.edit.fallback === b.edit.fallback &&
    a.invalid?.raw === b.invalid?.raw &&
    a.invalid?.message === b.invalid?.message &&
    a.missingEnvs.join('|') === b.missingEnvs.join('|') &&
    a.notInEnvErrors.join('|') === b.notInEnvErrors.join('|') &&
    sameValue(a.value, b.value)
  );
}
