/**
 * Raw JSON editor state: the text follows the form until the user types; unapplied text and
 * errors survive form edits. Apply validates the whole document (literal API keys are refused)
 * before it replaces the form.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  applyRawJson,
  editRawJson,
  initRawJson,
  rawJsonStatus,
  syncRawFromForm,
  type FormContext,
  type LaunchDocument,
  type RawJsonState,
  type SecretStore,
} from '../model';
import type { RawApi } from '../types';

export function useRawJson(
  doc: LaunchDocument,
  setDoc: (updater: (d: LaunchDocument) => LaunchDocument) => void,
  ctx: FormContext,
  secrets: SecretStore,
): RawApi {
  const panel = ctx.evaluatorPanel;
  // null: follow the form. Otherwise the editor's own (dirty or errored) state.
  const [stored, setStored] = useState<RawJsonState | null>(null);
  const state = useMemo(
    () => syncRawFromForm(stored ?? initRawJson(doc, panel), doc, panel),
    [stored, doc, panel],
  );
  const edit = useCallback((text: string) => setStored(editRawJson(state, text)), [state]);
  const apply = useCallback(
    (explicit = true) => {
      const result = applyRawJson(state, doc, ctx, secrets, explicit);
      if (result.state !== state)
        setStored(result.state.dirty || result.state.errors.length ? result.state : null);
      if (result.applied) setDoc(() => result.doc);
      return result.applied;
    },
    [state, doc, ctx, secrets, setDoc],
  );
  const revert = useCallback(() => setStored(null), []);
  return { state, status: rawJsonStatus(state), edit, apply, revert };
}
