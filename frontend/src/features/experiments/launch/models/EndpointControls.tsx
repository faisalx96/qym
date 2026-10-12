import { useState } from 'react';
import { Button, TextField } from '@/ui';
import { useLaunch } from '../LaunchContext';
import { endpointsCollection, pointerToFieldName, slotPointer, validateEndpointName } from '../model';
import { useGroupsDialog } from './useGroupsDialog';
import styles from './models.module.css';

/** "+ Add LLM endpoint" (this experiment only) and, for managers, "Edit LLM groups". */
export function EndpointControls() {
  const { ctx, selectedEnvs, canManage, loadProposal, focusField, mode } = useLaunch();
  const dialog = useGroupsDialog();
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const collection = endpointsCollection(ctx.union);

  async function add() {
    const trimmed = name.trim();
    const problem = validateEndpointName(trimmed, collection, ctx.slots);
    if (problem) {
      setError(problem);
      return;
    }
    setError('');
    setBusy(true);
    try {
      const added = await loadProposal([trimmed]);
      if (!added.length) {
        setError('None of the selected environments can add this endpoint.');
        return;
      }
      setName('');
      focusField(pointerToFieldName(slotPointer('endpoint:' + trimmed)), 'models');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.stack} data-endpoint-controls>
      <div className={styles.endpointRow}>
        {mode === 'launch' ? (
          <>
            <TextField
              className={styles.grow}
              label="New LLM endpoint name"
              mono
              maxLength={100}
              placeholder="endpoint name, e.g. fast"
              value={name}
              onChange={(v) => {
                setName(v);
                setError('');
              }}
              isDisabled={!collection}
              errorMessage={error || undefined}
              isInvalid={Boolean(error)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void add();
                }
              }}
            />
            <Button
              variant="neutral"
              isDisabled={!collection || busy}
              onPress={() => void add()}
              loading={busy}
            >
              + Add LLM endpoint
            </Button>
          </>
        ) : null}
        {canManage && mode === 'launch'
          ? selectedEnvs.map((env) => (
              <Button key={env.id} variant="ghost" onPress={() => dialog.open(env.id)}>
                {selectedEnvs.length > 1 ? `Edit LLM groups · ${env.name}` : 'Edit LLM groups'}
              </Button>
            ))
          : null}
      </div>
      {mode === 'launch' ? (
        <p className={styles.hint}>
          {collection
            ? 'Adds an LLM endpoint to this experiment only: bind a model to it, then point roles at it under Role overrides.'
            : 'The selected environments have no LLM endpoints to add to.'}
        </p>
      ) : null}
      {dialog.node}
    </div>
  );
}
