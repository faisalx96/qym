import { useState } from 'react';
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
      label: 'Name',
      flex: true,
      minWidth: 160,
      cell: (c) => (
        <span className={styles.inlineActions}>
          <span>{c.name}</span>
          {c.is_default ? <Tag kind="accent">default</Tag> : null}
          {!c.available_for_experiments ? <Tag>analysis only</Tag> : null}
        </span>
      ),
    },
    { id: 'model', label: 'Model', width: 160, mono: true, cell: (c) => c.llm_model },
    { id: 'endpoint', label: 'Endpoint', width: 240, mono: true, cell: (c) => c.llm_base_url },
    {
      id: 'key',
      label: 'Key',
      width: 110,
      mono: true,
      cell: (c) => (c.llm_api_key_set ? c.llm_api_key_hint || '••••' : '—'),
    },
    {
      id: 'actions',
      label: 'Actions',
      hideLabel: true,
      width: canEdit ? 300 : 90,
      resizable: false,
      cell: (c) => (
        <span className={styles.inlineActions}>
          <Button variant="neutral" loading={testing === c.id} onPress={() => test(c)}>
            Test
          </Button>
          {canEdit ? (
            <>
              {!c.is_default ? (
                <Button
                  variant="neutral"
                  onPress={() =>
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
                      )
                  }
                >
                  Set default
                </Button>
              ) : null}
              <Button
                variant="neutral"
                onPress={() => {
                  setEditing(c);
                  setShowForm(true);
                }}
              >
                Edit
              </Button>
              <Button variant="danger" onPress={() => setDeleting(c)}>
                Delete
              </Button>
            </>
          ) : null}
        </span>
      ),
    },
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
        <DataTable
          aria-label="LLM connections"
          columns={columns}
          rows={list.data}
          rowKey={(c) => c.id}
          storageKey="settings-llm"
          emptyState="No LLM connections yet. Add one to run auto-analysis and experiments."
        />
      )}
      {canEdit && !showForm ? (
        <div>
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
          <TextField label="Name" value={name} onChange={setName} isRequired placeholder="OpenAI prod" />
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
