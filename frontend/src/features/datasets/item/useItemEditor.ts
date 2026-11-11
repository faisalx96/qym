/** Draft editor state for one item (shared by the item page and the docked pane): touched-only PATCH, Text/JSON contract. */
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { dsKeys, usePatchItem, type DatasetItem, type DsUser, type ItemBody } from '@/api/datasets';
import { ApiError } from '@/lib/http';
import { fieldStatus, initialFieldState, type FieldState } from '../components/FieldEditor';

interface EditState {
  key: string;
  input: FieldState;
  expected: FieldState;
  metadata: FieldState;
}

/** Someone saved the item after the editor loaded it (C015): their version, who and when, and my unsaved body. */
export interface ItemConflict {
  theirs: DatasetItem;
  by: DsUser | null;
  at: string;
  mine: ItemBody;
}

function conflictOf(e: unknown): Omit<ItemConflict, 'mine'> | null {
  if (!(e instanceof ApiError) || e.status !== 409) return null;
  const d = (
    e.body as {
      detail?: { code?: string; item?: DatasetItem; changed_by?: DsUser | null; changed_at?: string };
    }
  )?.detail;
  if (d?.code !== 'item_changed' || !d.item) return null;
  return { theirs: d.item, by: d.changed_by ?? null, at: d.changed_at ?? d.item.updated_at };
}

export function useItemEditor(slug: string, ref: string, version: string, item: DatasetItem | undefined) {
  const patch = usePatchItem(slug, ref, version);
  const qc = useQueryClient();
  const [edit, setEdit] = useState<EditState | null>(null);
  const [conflict, setConflict] = useState<ItemConflict | null>(null);
  const editKey = item ? `${item.item_id}:${item.updated_at}` : '';
  const state = useMemo<EditState | null>(
    () =>
      edit && edit.key === editKey
        ? edit
        : item
          ? {
              key: editKey,
              input: initialFieldState(item.input),
              expected: initialFieldState(item.expected_output),
              metadata: initialFieldState(item.metadata, true),
            }
          : null,
    [edit, editKey, item],
  );
  const statuses = useMemo(
    () =>
      item && state
        ? {
            input: fieldStatus(item.input, state.input),
            expected: fieldStatus(item.expected_output, state.expected),
            metadata: fieldStatus(item.metadata, state.metadata, true),
          }
        : null,
    [item, state],
  );
  const dirty = Boolean(
    statuses && (statuses.input.touched || statuses.expected.touched || statuses.metadata.touched),
  );
  const valid = Boolean(statuses && statuses.input.ok && statuses.expected.ok && statuses.metadata.ok);
  const typeChanges = statuses
    ? (['input', 'expected', 'metadata'] as const).filter(
        (k) => statuses[k].touched && statuses[k].toType && statuses[k].toType !== statuses[k].fromType,
      )
    : [];

  const set = useCallback(
    (field: 'input' | 'expected' | 'metadata', s: FieldState) => {
      if (state) setEdit({ ...state, [field]: s });
    },
    [state],
  );
  const reset = useCallback(() => setEdit(null), []);

  /**
   * Sends only touched fields with the loaded updated_at; resolves to the saved item, or to null when someone saved
   * the item since (the edits stay, and `conflict` says who and when).
   */
  const save = useCallback(async () => {
    if (!item || !statuses || !valid) return null;
    const body: ItemBody = {};
    if (statuses.input.touched) body.input = statuses.input.value;
    if (statuses.expected.touched) body.expected_output = statuses.expected.value;
    if (statuses.metadata.touched) body.metadata = (statuses.metadata.value ?? {}) as Record<string, unknown>;
    try {
      const r = await patch.mutateAsync({
        itemId: item.item_id,
        body: { ...body, expected_updated_at: item.updated_at },
      });
      setEdit(null);
      setConflict(null);
      return r.item;
    } catch (e) {
      const c = conflictOf(e);
      if (!c) throw e;
      setConflict({ ...c, mine: body });
      return null;
    }
  }, [item, statuses, valid, patch]);

  /** Keep mine: save my edits over their version. */
  const keepMine = useCallback(async () => {
    if (!item || !conflict) return null;
    const r = await patch.mutateAsync({
      itemId: item.item_id,
      body: { ...conflict.mine, expected_updated_at: conflict.at },
    });
    setEdit(null);
    setConflict(null);
    return r.item;
  }, [item, conflict, patch]);

  /** Review their version: drop my edits and show the saved item. */
  const reviewTheirs = useCallback(() => {
    if (!conflict) return;
    qc.setQueryData(dsKeys.item(slug, ref, version, conflict.theirs.item_id), { item: conflict.theirs });
    setEdit(null);
    setConflict(null);
  }, [conflict, qc, slug, ref, version]);

  return {
    state,
    statuses,
    dirty,
    valid,
    typeChanges,
    set,
    reset,
    save,
    saving: patch.isPending,
    conflict,
    keepMine,
    reviewTheirs,
  };
}
