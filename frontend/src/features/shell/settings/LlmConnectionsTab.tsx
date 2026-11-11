import { useEffect, useRef, useState } from 'react';
import {
  useLlmConnectionAction,
  useLlmConnections,
  useSaveLlmConnection,
  useTestLlmDraft,
  type LlmConnectionBody,
} from '@/api/projectSettings';
import type { LlmConnection } from '@/api/types';
import { ApiError, actionErrorMessage } from '@/lib/http';
import { keyHostChanged } from '@/lib/keyHost';
import { useDelayedPending, useSubmitLock } from '@/lib/pending';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Icon,
  Skeleton,
  Stack,
  Tag,
  Text,
  TextField,
  useToast,
  type Column,
  type RowAction,
  Card,
} from '@/ui';
import { useProjectContext } from '../ProjectContext';
import {
  ConnectionFields,
  httpsError,
  placeConnectionError,
  type ConnectionErrors,
} from './ConnectionFields';
import styles from './settings.module.css';
import { SettingsCard } from './SettingsCard';

const KEEP = '__KEEP__';
/** What the server uses when a connection has no base URL. */
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

export function LlmConnectionsTab() {
  const { project, readOnly, canManage } = useProjectContext();
  const list = useLlmConnections(project.id);
  const showSkeleton = useDelayedPending(list.isPending);
  const save = useSaveLlmConnection(project.id);
  const lock = useSubmitLock();
  const action = useLlmConnectionAction(project.id);
  const testDraft = useTestLlmDraft(project.id);
  const toast = useToast();
  const [editing, setEditing] = useState<LlmConnection | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<LlmConnection | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const canEdit = canManage && !readOnly;
  // The form replaces the Add button; keep keyboard focus on a live control when it closes.
  const addRef = useRef<HTMLDivElement>(null);
  const formWasOpen = useRef(false);
  useEffect(() => {
    if (formWasOpen.current && !showForm) addRef.current?.querySelector('button')?.focus();
    formWasOpen.current = showForm;
  }, [showForm]);

  async function test(c: LlmConnection) {
    setTesting(c.id);
    try {
      const r = (await action.mutateAsync({ id: c.id, action: 'test' })) as { model?: string };
      toast.show(`“${c.name}” connected · ${r.model ?? c.llm_model}`, { tone: 'success' });
    } catch (e) {
      toast.show(actionErrorMessage('test the connection', e), {
        tone: 'error',
        timeout: 8000,
      });
    } finally {
      setTesting(null);
    }
  }

  const columns: Column<LlmConnection>[] = [
    {
      id: 'name',
      header: 'Name',
      flex: true,
      minWidth: 160,
      pin: 'start',
      hideable: false,
      priority: 1,
      cell: (c) => (
        <span className={styles.inlineActions}>
          <span>{c.name}</span>
          {c.is_default ? <Tag kind="accent">default</Tag> : null}
          {!c.available_for_experiments ? <Tag>analysis only</Tag> : null}
        </span>
      ),
    },
    { id: 'model', header: 'Model', type: 'id', width: 160, priority: 1, cell: (c) => c.llm_model },
    { id: 'endpoint', header: 'Endpoint', type: 'id', width: 240, priority: 2, cell: (c) => c.llm_base_url },
    {
      id: 'key',
      header: 'Key',
      type: 'id',
      width: 110,
      priority: 3,
      cell: (c) => (c.llm_api_key_set ? c.llm_api_key_hint || '••••' : '—'),
    },
  ];

  const rowActions = (c: LlmConnection): RowAction<LlmConnection>[] => [
    {
      id: 'test',
      label: testing === c.id ? `Testing ${c.name}` : `Test ${c.name}`,
      icon: 'play',
      primary: true,
      disabled: testing === c.id,
      onPress: test,
    },
    ...(canEdit
      ? [
          {
            id: 'edit',
            label: `Edit ${c.name}`,
            icon: 'edit',
            primary: true,
            onPress: () => {
              setEditing(c);
              setShowForm(true);
            },
          },
          // every action is a direct icon: a ⋯ menu that held only Delete hid the one action it had (round 10)
          ...(!c.is_default
            ? [
                {
                  id: 'set-default',
                  label: `Set ${c.name} as default`,
                  icon: 'star',
                  primary: true,
                  onPress: () =>
                    action
                      .mutateAsync({ id: c.id, action: 'set-default' })
                      .then(() => toast.show('Default connection updated', { tone: 'success' }))
                      .catch((e) =>
                        toast.show(
                          e instanceof ApiError
                            ? e.detail || 'Couldn’t set the default'
                            : 'Couldn’t set the default',
                          { tone: 'error' },
                        ),
                      ),
                },
              ]
            : []),
          {
            id: 'delete',
            label: `Delete ${c.name}`,
            icon: 'trash',
            primary: true,
            danger: true,
            onPress: () => setDeleting(c),
          },
        ]
      : []),
  ];

  return (
    <Stack gap="lg">
      <SettingsCard
        title="LLM connections"
        description="Model providers that auto-analysis and experiments call."
        action={
          canEdit && !showForm ? (
            <div ref={addRef}>
              <Button
                variant="primary"
                icon={<Icon name="plus" size={12} />}
                onPress={() => {
                  setEditing(null);
                  setShowForm(true);
                }}
              >
                Add connection
              </Button>
            </div>
          ) : undefined
        }
        data-llm-connections
      >
        {list.isError ? (
          <ErrorState
            error={list.error}
            title="Couldn’t load connections"
            onRetry={() => list.refetch()}
            compact
          />
        ) : list.isPending ? (
          showSkeleton ? (
            <Skeleton kind="table" rows={2} />
          ) : null
        ) : (
          <DataTable<LlmConnection>
            density="regular"
            rowActions={rowActions}
            aria-label="LLM connections"
            columns={columns}
            rows={list.data}
            rowKey={(c) => c.id}
            storageKey="settings-llm"
            empty={
              <EmptyState
                compact
                title="No LLM connections yet"
                body="Add one to run auto-analysis and experiments."
              />
            }
          />
        )}
      </SettingsCard>
      {canEdit && showForm ? (
        <ConnectionForm
          key={editing?.id ?? 'new'}
          initial={editing}
          busy={save.isPending}
          onCancel={() => setShowForm(false)}
          onSubmit={(body) =>
            lock(async () => {
              // A failed save throws to the form, which shows the error under its field (C157).
              await save.mutateAsync({ id: editing?.id, body });
              toast.show(editing ? 'Connection updated' : 'Connection added', { tone: 'success' });
              setShowForm(false);
            })
          }
          onTest={async (body) => {
            const r = await testDraft.mutateAsync({
              llm_base_url: body.llm_base_url,
              llm_model: body.llm_model,
              llm_api_key: body.llm_api_key === KEEP ? '' : body.llm_api_key,
              connection_id: body.connection_id,
              available_for_experiments: body.available_for_experiments,
            });
            return r.model;
          }}
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Delete “${deleting.name}”?`}
          requireText={deleting.name}
          inputLabel={`Type ${deleting.name} to confirm`}
          tone="danger"
          description="Analyses and experiments configured with this connection will need another one."
          confirmLabel="Delete connection"
          onConfirm={async () => {
            try {
              await action.mutateAsync({ id: deleting.id, action: 'delete' });
              toast.show('Connection deleted', { tone: 'info' });
            } catch (e) {
              throw new Error(actionErrorMessage('delete the connection', e));
            }
          }}
        />
      ) : null}
    </Stack>
  );
}

export function ConnectionForm({
  initial,
  busy,
  onCancel,
  onSubmit,
  onTest,
}: {
  initial: LlmConnection | null;
  busy: boolean;
  onCancel: () => void;
  /** Rejects with the server's error, which the form places under its field (C157). */
  onSubmit: (body: LlmConnectionBody) => Promise<void> | void;
  /** Tests the form's values before a save (C157); resolves with the model that answered. */
  onTest?: (body: LlmConnectionBody & { connection_id?: string }) => Promise<string>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.llm_base_url ?? '');
  const [model, setModel] = useState(initial?.llm_model ?? '');
  const [key, setKey] = useState('');
  const [forExperiments, setForExperiments] = useState(initial?.available_for_experiments ?? true);
  const [errors, setErrors] = useState<ConnectionErrors>({});
  const [formError, setFormError] = useState('');
  const [tested, setTested] = useState('');
  const [testing, setTesting] = useState(false);
  // The stored key stays with its host: another host needs the key again (C004).
  const needsKey =
    Boolean(initial?.llm_api_key_set) && keyHostChanged(initial?.llm_base_url || DEFAULT_BASE_URL, baseUrl);
  const body = (): LlmConnectionBody => ({
    name: name.trim(),
    llm_base_url: baseUrl.trim(),
    llm_model: model.trim(),
    llm_api_key: key ? key : initial ? KEEP : '',
    available_for_experiments: forExperiments,
  });
  const edit = (set: (v: string) => void, field?: keyof ConnectionErrors) => (v: string) => {
    set(v);
    setTested('');
    if (field && errors[field]) setErrors((e) => ({ ...e, [field]: undefined }));
  };
  /** The https rule before any request: experiments need an https:// URL. */
  function checked(): boolean {
    const https = httpsError(baseUrl, forExperiments);
    setErrors(https ? { baseUrl: `${https} Turn off "Available for experiments" to use http://.` } : {});
    setFormError('');
    return !https;
  }
  /** A message about one field goes under that field (C157); anything else is one plain sentence (C181). */
  function place(e: unknown, action: string) {
    const message = e instanceof ApiError ? e.detail : e instanceof Error ? e.message : '';
    const placed = placeConnectionError(message);
    setErrors(placed.errors);
    setFormError(Object.keys(placed.errors).length ? '' : actionErrorMessage(action, e));
  }
  const complete = Boolean(name.trim() && baseUrl.trim() && model.trim() && !(needsKey && !key));
  return (
    <form
      data-llm-form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!complete || !checked()) return;
        void Promise.resolve(onSubmit(body())).catch((err: unknown) => place(err, 'save the connection'));
      }}
    >
      <Card
        header={
          <div className={styles.cardHeader}>
            <Text variant="md">{initial ? `Edit “${initial.name}”` : 'New connection'}</Text>
          </div>
        }
        footer={
          <div className={styles.cardFooter}>
            <Button variant="neutral" onPress={onCancel}>
              Cancel
            </Button>
            {onTest ? (
              // the button rule (round 11): Test runs something without saving (accent), Save commits (primary)
              <Button
                variant="accent"
                icon={<Icon name="play" size={12} />}
                isDisabled={!baseUrl.trim() || !model.trim() || (needsKey && !key) || (!key && !initial)}
                disabledReason="Fill in base URL, model and key"
                loading={testing}
                onPress={async () => {
                  if (!checked()) return;
                  setTested('');
                  setTesting(true);
                  try {
                    const answered = await onTest({ ...body(), connection_id: initial?.id });
                    setTested(`Connected: ${answered} answered. Nothing is saved yet.`);
                  } catch (err) {
                    place(err, 'test the connection');
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                Test connection
              </Button>
            ) : null}
            <Button type="submit" variant="primary" loading={busy} isDisabled={!complete}>
              {initial ? 'Save' : 'Add connection'}
            </Button>
          </div>
        }
      >
        <div className={styles.cardBody}>
          <div className={styles.formRow}>
            <TextField
              label="Name"
              value={name}
              onChange={edit(setName)}
              isRequired
              placeholder="OpenAI prod"
              autoFocus
            />
            <ConnectionFields
              baseUrl={baseUrl}
              onBaseUrl={edit(setBaseUrl, 'baseUrl')}
              model={model}
              onModel={edit(setModel, 'model')}
              apiKey={key}
              onApiKey={edit(setKey, 'key')}
              needsKey={needsKey}
              storedKeyHint={initial?.llm_api_key_set ? initial.llm_api_key_hint : null}
              baseUrlHelp="An https:// URL is required to offer the connection for experiments."
              errors={errors}
            />
          </div>
          <Checkbox isSelected={forExperiments} onChange={setForExperiments}>
            Available for experiments (otherwise analysis only)
          </Checkbox>
          {tested ? (
            <Text variant="sm" tone="success" role="status" data-llm-tested>
              {tested}
            </Text>
          ) : null}
          {formError ? (
            <Text variant="sm" tone="danger" role="alert" data-llm-form-error>
              {formError}
            </Text>
          ) : null}
        </div>
      </Card>
    </form>
  );
}
