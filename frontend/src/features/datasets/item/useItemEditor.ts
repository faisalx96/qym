/** Draft editor state for one item (shared by the item page and the docked pane): touched-only PATCH, Text/JSON contract. */
import { useCallback, useMemo, useState } from 'react';
import { usePatchItem, type DatasetItem, type ItemBody } from '@/api/datasets';
import { fieldStatus, initialFieldState, type FieldState } from '../components/FieldEditor';

interface EditState {
  key: string;
  input: FieldState;
  expected: FieldState;
  metadata: FieldState;
}

export function useItemEditor(slug: string, ref: string, version: string, item: DatasetItem | undefined) {
  const patch = usePatchItem(slug, ref, version);
  const [edit, setEdit] = useState<EditState | null>(null);
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

  /** Sends only touched fields; resolves to the saved item. */
  const save = useCallback(async () => {
    if (!item || !statuses || !valid) return null;
    const body: ItemBody = {};
    if (statuses.input.touched) body.input = statuses.input.value;
    if (statuses.expected.touched) body.expected_output = statuses.expected.value;
    if (statuses.metadata.touched) body.metadata = (statuses.metadata.value ?? {}) as Record<string, unknown>;
    const r = await patch.mutateAsync({ itemId: item.item_id, body });
    setEdit(null);
    return r.item;
  }, [item, statuses, valid, patch]);

  return { state, statuses, dirty, valid, typeChanges, set, reset, save, saving: patch.isPending };
}
