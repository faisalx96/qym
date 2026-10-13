import { useEffect, useRef, useState } from 'react';
import {
  useLlmConnectionAction,
  useLlmConnections,
  useSaveLlmConnection,
  type LlmConnectionBody,
} from '@/api/projectSettings';
import type { LlmConnection } from '@/api/types';
import { ApiError } from '@/lib/http';
import { useDelayedPending, useSubmitLock } from '@/lib/pending';
import {
  Button,
  Checkbox,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Skeleton,
  Stack,
  Tag,
  Text,
  TextField,
  useToast,
  type Column,
  type RowAction,
} from '@/ui';
import { useProjectContext } from '../ProjectContext';
import styles from './settings.module.css';

const KEEP = '__KEEP__';

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
          ...(!c.is_default
            ? [
                {
                  id: 'set-default',
                  label: `Set ${c.name} as default`,
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
          { id: 'delete', label: `Delete ${c.name}`, danger: true, onPress: () => setDeleting(c) },
        ]
      : []),
  ];

  return (
    <Stack gap="lg">
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
      {canEdit && !showForm ? (
        <div ref={addRef}>
          <Button
            variant="accent"
            onPress={() => {
              setEditing(null);
              setShowForm(true);
            }}
          >
            Add connection
          </Button>
        </div>
      ) : null}
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

function ConnectionForm({
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
  return (
    <form
      className={styles.card}
      data-llm-form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          name: name.trim(),
          llm_base_url: baseUrl.trim(),
          llm_model: model.trim(),
          llm_api_key: key ? key : initial ? KEEP : '',
          available_for_experiments: forExperiments,
        });
      }}
    >
      <div className={styles.cardHeader}>
        <Text variant="md">{initial ? `Edit “${initial.name}”` : 'New connection'}</Text>
      </div>
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
          <TextField label="Model" value={model} onChange={setModel} isRequired mono placeholder="gpt-4.1" />
          <TextField
            label="API key"
            type="password"
            value={key}
            onChange={setKey}
            mono
            placeholder={initial?.llm_api_key_set ? `Keep current (${initial.llm_api_key_hint})` : 'sk-…'}
            autoComplete="new-password"
          />
        </div>
        <Checkbox isSelected={forExperiments} onChange={setForExperiments}>
          Available for experiments (otherwise analysis only)
        </Checkbox>
      </div>
      <div className={styles.cardFooter}>
        <Button variant="neutral" onPress={onCancel}>
          Cancel
        </Button>
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          isDisabled={!name.trim() || !baseUrl.trim() || !model.trim()}
        >
          {initial ? 'Save changes' : 'Add connection'}
        </Button>
      </div>
    </form>
  );
}
