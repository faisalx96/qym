/**
 * "Group LLM settings" (brief 06 §2.9): one card per LLM the service can call, with the key sets
 * (model / base URL / API key fields), transport chips, merge, remove/restore, "Add a group" and
 * the PUT of the slots. `SlotCard` is also the read-only card of the environment page and the
 * launch form (no `editor` => read-only).
 */
import { useCallback, useMemo, useReducer, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchEndpointProposal,
  useSaveModelSlots,
  type EvalSlot,
  type FormDescriptor,
  type ModelSlotsResponse,
  type SlotRole,
} from '@/api/evalEnvironments';
import { errorCode, errorList, errorMessage, type EvalEnvironment } from '@/api/evalCommon';
import { ApiError, api } from '@/lib/http';
import { Button, Dialog, ErrorState, Select, Skeleton, Tag, TextField, useToast } from '@/ui';
import styles from './SlotEditor.module.css';
import {
  candidatesFor,
  distributeSlotErrors,
  flatSlotFromField,
  freeFlatModels,
  hasEndpointCollection,
  initSlotState,
  keySets,
  normalizeSlot,
  ROLE_LABELS,
  ROLES,
  slotReducer,
  slotsMissingModel,
  toPayload,
  type EditSlot,
  type SlotAction,
  type SlotEditorState,
} from './slotLogic';

const NONE = '__none__';

const STATUS_TAGS: Record<string, { label: string; tone?: 'success' | 'info' | 'warning'; kind?: 'accent'; title?: string }> = {
  confirmed: { label: 'Confirmed', tone: 'success' },
  proposed: { label: 'Proposed', tone: 'info' },
  stale: { label: 'Stale', tone: 'warning', title: 'Its fields changed in the new schema' },
  new: { label: 'New', kind: 'accent' },
};

// ------------------------------------------------------------------ controller

export interface SlotEditorSource {
  slots: EvalSlot[];
  schemaId: string;
  descriptor: FormDescriptor;
}

export interface SlotEditorController {
  state: SlotEditorState;
  dispatch: (action: SlotAction) => void;
  descriptor: FormDescriptor;
  busy: boolean;
  /** PUT the slots. Resolves to the saved payload, or null when validation or the server refused. */
  save: () => Promise<ModelSlotsResponse | null>;
  reload: () => Promise<void>;
  /** Replace the editor content (the add dialog loads it after the environment exists). */
  load: (source: SlotEditorSource) => void;
  addEndpoint: (name: string) => Promise<void>;
  addFlat: (pointer: string) => void;
  adding: boolean;
}

export const EMPTY_SLOT_SOURCE: SlotEditorSource = {
  slots: [],
  schemaId: '',
  descriptor: { root: [], fields: {}, groups: [], warnings: [] },
};

export function useSlotEditor(projectId: string, envId: string, source: SlotEditorSource = EMPTY_SLOT_SOURCE): SlotEditorController {
  const [state, dispatch] = useReducer(slotReducer, source.slots, initSlotState);
  const [schemaId, setSchemaId] = useState(source.schemaId);
  const [descriptor, setDescriptor] = useState(source.descriptor);
  const [adding, setAdding] = useState(false);
  const saveMutation = useSaveModelSlots(projectId, envId);
  const save = useCallback(async () => {
    const current = state;
    const missing = slotsMissingModel(current.slots);
    if (missing.length) {
      const errors: Record<string, string[]> = {};
      missing.forEach((s) => {
        errors[s.slot_key] = ['Every set of keys needs a model field; pick one or remove the set.'];
      });
      dispatch({ type: 'setErrors', errors, general: 'Every set of keys needs a model field.' });
      return null;
    }
    dispatch({ type: 'setErrors', errors: {}, general: '' });
    try {
      const result = await saveMutation.mutateAsync({ slots: toPayload(current.slots), schema_id: schemaId });
      dispatch({ type: 'reset', slots: result.slots });
      return result;
    } catch (error) {
      const list = errorList(error);
      if (error instanceof ApiError && error.status === 422 && list.length) {
        const spread = distributeSlotErrors(current.slots, list);
        dispatch({ type: 'setErrors', ...spread });
      } else {
        dispatch({
          type: 'setErrors',
          errors: {},
          general: errorMessage(error) || 'Could not confirm the slots.',
          reload: error instanceof ApiError && (error.status === 409 || errorCode(error) === 'schema_changed'),
        });
      }
      return null;
    }
  }, [saveMutation, schemaId, state]);

  const reload = useCallback(async () => {
    try {
      const base = `/v1/projects/${encodeURIComponent(projectId)}/eval-environments/${encodeURIComponent(envId)}`;
      const [slots, form] = await Promise.all([
        api.get<ModelSlotsResponse>(`${base}/model-slots`),
        api.get<{ descriptor: FormDescriptor }>(`${base}/form`),
      ]);
      setSchemaId(slots.schema_id);
      setDescriptor(form.descriptor);
      dispatch({ type: 'reset', slots: slots.slots, notice: 'Reloaded the slots of the current schema.' });
    } catch (error) {
      dispatch({ type: 'general', message: errorMessage(error) || 'Could not reload the slots.' });
    }
  }, [projectId, envId]);

  const load = useCallback((next: SlotEditorSource) => {
    setSchemaId(next.schemaId);
    setDescriptor(next.descriptor);
    dispatch({ type: 'reset', slots: next.slots });
  }, []);

  const addEndpoint = useCallback(
    async (name: string) => {
      const key = name.trim();
      const current = state;
      if (!key) return dispatch({ type: 'general', message: 'Enter an endpoint name.' });
      if (current.slots.some((s) => s.slot_key === `endpoint:${key}`)) {
        return dispatch({ type: 'general', message: `A slot endpoint:${key} already exists.` });
      }
      setAdding(true);
      try {
        const res = await fetchEndpointProposal(projectId, envId, key);
        if (!res.proposal) {
          dispatch({ type: 'general', message: 'This schema has no endpoint map to add endpoints to.' });
        } else {
          dispatch({ type: 'addSlot', slot: normalizeSlot({ ...res.proposal, status: 'new' }) });
        }
      } catch (error) {
        dispatch({ type: 'general', message: errorMessage(error) || 'Could not propose the endpoint slot.' });
      } finally {
        setAdding(false);
      }
    },
    [projectId, envId, state],
  );

  const addFlat = useCallback(
    (pointer: string) => {
      const slot = flatSlotFromField(state.slots, descriptor, pointer);
      if ('error' in slot) dispatch({ type: 'general', message: slot.error });
      else dispatch({ type: 'addSlot', slot });
    },
    [descriptor, state.slots],
  );

  return { state, dispatch, descriptor, busy: saveMutation.isPending, save, reload, load, addEndpoint, addFlat, adding };
}

/** Fresh slots and descriptor for an editor (never seeded from a stale cache). */
export function useSlotEditorSource(projectId: string | undefined, envId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['eval-slot-editor-source', projectId ?? '', envId ?? ''],
    enabled: Boolean(projectId && envId && enabled),
    gcTime: 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<SlotEditorSource> => {
      const base = `/v1/projects/${encodeURIComponent(projectId!)}/eval-environments/${encodeURIComponent(envId!)}`;
      const [slots, form] = await Promise.all([
        api.get<ModelSlotsResponse>(`${base}/model-slots`),
        api.get<{ schema_id: string; descriptor: FormDescriptor }>(`${base}/form`),
      ]);
      return { slots: slots.slots, schemaId: slots.schema_id || form.schema_id, descriptor: form.descriptor };
    },
  });
}

// ------------------------------------------------------------------ cards

export interface SlotCardProps {
  slot: EvalSlot | EditSlot;
  /** Present => editable. */
  editor?: Pick<SlotEditorController, 'state' | 'dispatch' | 'descriptor'>;
  errors?: string[];
}

function RoleCell({
  slot,
  setIdx,
  role,
  editor,
}: {
  slot: EditSlot;
  setIdx: number;
  role: SlotRole;
  editor?: SlotCardProps['editor'];
}) {
  const value = keySets(slot)[setIdx]?.[role] ?? null;
  const name = ROLE_LABELS[role];
  const label = `${name}${setIdx ? ` (key set ${setIdx + 1})` : ''} field for ${slot.label || slot.slot_key}`;
  if (!editor) {
    return (
      <div className={styles.role}>
        <span className={styles.roleName}>{name}</span>
        {value ? <span className={styles.pointer}>{value}</span> : <span className={styles.unmapped}>Not mapped</span>}
      </div>
    );
  }
  const candidates = candidatesFor(editor.state.slots, editor.descriptor, slot, role, setIdx);
  if (value && !candidates.includes(value)) candidates.unshift(value);
  const items = [
    ...(role === 'model' && value ? [] : [{ key: NONE, label: role === 'model' ? 'Pick a model field…' : 'Not mapped' }]),
    ...candidates.map((p) => ({ key: p, label: p })),
  ];
  return (
    <div className={styles.role}>
      <span className={styles.roleName}>{name}</span>
      <Select
        label={label}
        hideLabel
        items={items}
        value={value ?? (role === 'model' ? null : NONE)}
        placeholder={role === 'model' ? 'Pick a model field…' : 'Not mapped'}
        onChange={(key) =>
          editor.dispatch({
            type: 'setRole',
            slotKey: slot.slot_key,
            setIdx,
            role,
            pointer: key === NONE || key === null ? null : String(key),
          })
        }
      />
    </div>
  );
}

export function SlotCard({ slot: input, editor, errors = [] }: SlotCardProps) {
  const slot = useMemo(() => normalizeSlot(input), [input]);
  const sets = keySets(slot);
  const status = STATUS_TAGS[slot.status];
  const mergeTargets = editor && !slot.required ? editor.state.slots.filter((s) => s.slot_key !== slot.slot_key) : [];
  return (
    <article className={styles.card} data-slot-key={slot.slot_key} data-error={errors.length ? '' : undefined}>
      <header className={styles.header}>
        {editor ? (
          <TextField
            className={styles.labelField}
            label={`Name of group ${slot.slot_key}`}
            hideLabel
            placeholder="Group name"
            value={slot.label}
            maxLength={200}
            onChange={(label) => editor.dispatch({ type: 'rename', slotKey: slot.slot_key, label })}
          />
        ) : (
          <span className={styles.title}>{slot.label || slot.slot_key}</span>
        )}
        <Tag kind="data" title="Slot key">
          {slot.slot_key}
        </Tag>
        {status ? (
          <Tag kind={status.kind} tone={status.tone} title={status.title}>
            {status.label}
          </Tag>
        ) : null}
        {slot.required ? <Tag title="Required by the service">Required</Tag> : null}
      </header>
      <div className={styles.keysets}>
        {sets.map((_, setIdx) => (
          <div key={setIdx} className={styles.keyset}>
            {sets.length > 1 || editor ? (
              <div className={styles.keysetHead}>
                <span className={styles.keysetTitle}>Keys {setIdx + 1}</span>
                {editor && setIdx > 0 ? (
                  <Button
                    variant="ghost"
                    aria-label={`Remove key set ${setIdx + 1} of ${slot.label || slot.slot_key}`}
                    onPress={() => editor.dispatch({ type: 'removeSet', slotKey: slot.slot_key, setIdx })}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>
            ) : null}
            <div className={styles.roles}>
              {ROLES.map((role) => (
                <RoleCell key={role} slot={slot} setIdx={setIdx} role={role} editor={editor} />
              ))}
            </div>
          </div>
        ))}
        {editor ? (
          <div>
            <Button variant="neutral" onPress={() => editor.dispatch({ type: 'addSet', slotKey: slot.slot_key })}>
              + Add another set of keys
            </Button>
          </div>
        ) : null}
      </div>
      {Object.keys(slot.transport_fields).length ? (
        <div className={styles.transport}>
          <span className={styles.roleName}>Transport</span>
          {Object.entries(slot.transport_fields).map(([name, pointer]) => (
            <Tag key={name} kind="data" title={pointer}>
              <span className={styles.chip}>
                {name}
                {editor ? (
                  <Button
                    variant="ghost"
                    aria-label={`Unmap ${name}; it stays a plain input`}
                    onPress={() => editor.dispatch({ type: 'detach', slotKey: slot.slot_key, name })}
                  >
                    ×
                  </Button>
                ) : null}
              </span>
            </Tag>
          ))}
        </div>
      ) : null}
      {editor && (mergeTargets.length || !slot.required) ? (
        <div className={styles.footer}>
          {mergeTargets.length ? (
            <Select
              label={`Merge ${slot.label || slot.slot_key} into another group`}
              hideLabel
              placeholder="Move keys into group…"
              value={null}
              items={mergeTargets.map((s) => ({ key: s.slot_key, label: s.label || s.slot_key }))}
              onChange={(key) => key && editor.dispatch({ type: 'merge', srcKey: slot.slot_key, dstKey: String(key) })}
            />
          ) : null}
          {!slot.required ? (
            <Button variant="danger" onPress={() => editor.dispatch({ type: 'remove', slotKey: slot.slot_key })}>
              Remove group
            </Button>
          ) : null}
        </div>
      ) : null}
      {errors.length ? (
        <div className={styles.errors} role="alert">
          {errors.map((m, i) => (
            <div key={i}>{m}</div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

// ------------------------------------------------------------------ editor body

function AddGroup({ editor }: { editor: SlotEditorController }) {
  const [endpoint, setEndpoint] = useState('');
  const [flat, setFlat] = useState<string | null>(null);
  const flatModels = freeFlatModels(editor.state.slots, editor.descriptor);
  const hasCollection = hasEndpointCollection(editor.descriptor);
  return (
    <section className={styles.add} aria-label="Add a group">
      <strong className={styles.title}>Add a group</strong>
      {hasCollection ? (
        <form
          className={styles.addRow}
          onSubmit={(e) => {
            e.preventDefault();
            void editor.addEndpoint(endpoint).then(() => setEndpoint(''));
          }}
        >
          <TextField
            label="New endpoint name"
            hideLabel
            placeholder="Endpoint name, e.g. fast"
            value={endpoint}
            maxLength={100}
            onChange={setEndpoint}
          />
          <Button type="submit" variant="neutral" loading={editor.adding}>
            Add endpoint group
          </Button>
        </form>
      ) : null}
      <div className={styles.addRow}>
        <Select
          label="Model field for a new group"
          hideLabel
          items={flatModels.map((p) => ({ key: p, label: p }))}
          value={flat}
          isDisabled={flatModels.length === 0}
          placeholder={flatModels.length ? 'Pick a model field…' : 'No unassigned model fields'}
          onChange={(k) => setFlat(k === null ? null : String(k))}
        />
        <Button
          variant="neutral"
          isDisabled={!flat}
          onPress={() => {
            if (flat) editor.addFlat(flat);
            setFlat(null);
          }}
        >
          Add group from field
        </Button>
      </div>
      <span className={styles.hint}>Unmapped LLM fields stay plain inputs on the launch form.</span>
    </section>
  );
}

export interface SlotEditorProps {
  controller: SlotEditorController;
  /** Read-only list (viewers). */
  readOnly?: boolean;
}

export function SlotEditor({ controller, readOnly }: SlotEditorProps) {
  const { state, dispatch } = controller;
  const editor = readOnly ? undefined : controller;
  return (
    <div className={styles.editor}>
      {state.general ? (
        <div className={styles.callout} data-tone="error" role="alert">
          {state.general}{' '}
          {state.generalReload ? (
            <Button variant="neutral" onPress={() => void controller.reload()}>
              Reload slots
            </Button>
          ) : null}
        </div>
      ) : null}
      {state.notice ? (
        <div className={styles.callout} role="status">
          {state.notice}
        </div>
      ) : null}
      <div className={styles.cards}>
        {state.slots.length ? (
          state.slots.map((slot) => (
            <SlotCard key={slot.slot_key} slot={slot} editor={editor} errors={state.errors[slot.slot_key]} />
          ))
        ) : (
          <div className={styles.empty}>No LLM settings detected in this schema.</div>
        )}
      </div>
      {state.removed.length && editor ? (
        <div className={styles.removed}>
          Removed:
          {state.removed.map((slot) => (
            <span key={slot.slot_key}>
              <Tag kind="data">{slot.slot_key}</Tag>{' '}
              <Button variant="neutral" onPress={() => dispatch({ type: 'restore', slotKey: slot.slot_key })}>
                Restore
              </Button>
            </span>
          ))}
        </div>
      ) : null}
      {editor ? <AddGroup editor={controller} /> : null}
    </div>
  );
}

// ------------------------------------------------------------------ dialog

export interface SlotEditorDialogProps {
  projectId: string;
  env: Pick<EvalEnvironment, 'id' | 'name'>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: (result: ModelSlotsResponse) => void;
}

function LoadedDialog({
  projectId,
  env,
  source,
  open,
  onOpenChange,
  onSaved,
}: SlotEditorDialogProps & { source: SlotEditorSource }) {
  const controller = useSlotEditor(projectId, env.id, source);
  const toast = useToast();
  async function save() {
    const result = await controller.save();
    if (!result) return;
    toast.show(`LLM model groups saved for “${env.name}”`, { tone: 'success' });
    onOpenChange(false);
    onSaved?.(result);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`LLM model groups · ${env.name}`}
      size="data"
      footer={
        <>
          <Button variant="neutral" size="md" onPress={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" size="md" loading={controller.busy} onPress={() => void save()}>
            Save groups
          </Button>
        </>
      }
    >
      <p className={styles.hint}>
        Each group is one LLM you pick a model for when launching. A group can fill several sets of keys: the model picked
        for it is written into every set. Fields in no group stay plain inputs.
      </p>
      <SlotEditor controller={controller} />
    </Dialog>
  );
}

/** "Group LLM settings" / "Edit groups" popup of the environment page. */
export function SlotEditorDialog(props: SlotEditorDialogProps) {
  const { projectId, env, open, onOpenChange } = props;
  const source = useSlotEditorSource(projectId, env.id, open);
  if (source.data && !source.isFetching) return <LoadedDialog {...props} source={source.data} />;
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`LLM model groups · ${env.name}`} size="data">
      {source.isError ? (
        <ErrorState error={source.error} title="Could not load the LLM settings" onRetry={() => void source.refetch()} compact />
      ) : (
        <Skeleton kind="cards" count={2} label="Loading LLM settings" />
      )}
    </Dialog>
  );
}
