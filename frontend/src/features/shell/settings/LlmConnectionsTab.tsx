import { useEffect, useRef, useState } from 'react';
import {
  useLlmConnectionAction,
  useLlmConnections,
  useSaveLlmConnection,
  type LlmConnectionBody,
} from '@/api/projectSettings';
import type { LlmConnection } from '@/api/types';
import { ApiError } from '@/lib/http';
import { KEY_FOR_NEW_HOST_PLACEHOLDER, keyHostChanged } from '@/lib/keyHost';
import { useDelayedPending, useSubmitLock } from '@/lib/pending';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
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
      toast.show(e instanceof ApiError ? e.detail || 'Connection failed' : 'Connection failed', {
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
                            ? e.detail || 'Could not set the default'
                            : 'Could not set the default',
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
            empty="No LLM connections yet. Add one to run auto-analysis and experiments."
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
            void lock(async () => {
              try {
                await save.mutateAsync({ id: editing?.id, body });
                toast.show(editing ? 'Connection updated' : 'Connection added', { tone: 'success' });
                setShowForm(false);
              } catch (e) {
                toast.show(e instanceof ApiError ? e.detail || 'Could not save' : 'Could not save', {
                  tone: 'error',
                });
              }
            })
          }
        />
      ) : null}
      {deleting ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Delete “${deleting.name}”?`}
          tone="danger"
          description="Analyses and experiments configured with this connection will need another one."
          confirmLabel="Delete connection"
          onConfirm={async () => {
            try {
              await action.mutateAsync({ id: deleting.id, action: 'delete' });
              toast.show('Connection deleted', { tone: 'info' });
            } catch (e) {
              throw new Error(e instanceof ApiError ? e.detail || 'Could not delete' : String(e));
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
}: {
  initial: LlmConnection | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: LlmConnectionBody) => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [baseUrl, setBaseUrl] = useState(initial?.llm_base_url ?? '');
  const [model, setModel] = useState(initial?.llm_model ?? '');
  const [key, setKey] = useState('');
  const [forExperiments, setForExperiments] = useState(initial?.available_for_experiments ?? true);
  // The stored key stays with its host: another host needs the key again (C004).
  const needsKey =
    Boolean(initial?.llm_api_key_set) && keyHostChanged(initial?.llm_base_url || DEFAULT_BASE_URL, baseUrl);
  return (
    <form
      data-llm-form
      onSubmit={(e) => {
        e.preventDefault();
        if (needsKey && !key) return;
        onSubmit({
          name: name.trim(),
          llm_base_url: baseUrl.trim(),
          llm_model: model.trim(),
          llm_api_key: key ? key : initial ? KEEP : '',
          available_for_experiments: forExperiments,
        });
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
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              isDisabled={!name.trim() || !baseUrl.trim() || !model.trim() || (needsKey && !key)}
            >
              {initial ? 'Save changes' : 'Add connection'}
            </Button>
          </div>
        }
      >
        <div className={styles.cardBody}>
          <div className={styles.formRow}>
            <TextField
              label="Name"
              value={name}
              onChange={setName}
              isRequired
              placeholder="OpenAI prod"
              autoFocus
            />
            <TextField
              label="Base URL"
              value={baseUrl}
              onChange={setBaseUrl}
              isRequired
              mono
              placeholder="https://api.openai.com/v1"
              help="An https:// URL is required to offer the connection for experiments."
            />
            <TextField
              label="Model"
              value={model}
              onChange={setModel}
              isRequired
              mono
              placeholder="gpt-4.1"
            />
            <TextField
              label="API key"
              type="password"
              value={key}
              onChange={setKey}
              mono
              isRequired={needsKey}
              placeholder={
                needsKey
                  ? KEY_FOR_NEW_HOST_PLACEHOLDER
                  : initial?.llm_api_key_set
                    ? `Keep current (${initial.llm_api_key_hint})`
                    : 'API key'
              }
              autoComplete="new-password"
            />
          </div>
          <Checkbox isSelected={forExperiments} onChange={setForExperiments}>
            Available for experiments (otherwise analysis only)
          </Checkbox>
        </div>
      </Card>
    </form>
  );
}
