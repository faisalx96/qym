import { useState } from 'react';
import {
  useApiKeys,
  useCreateApiKey,
  useCreateReadToken,
  useDatasetReadTokens,
  useRevokeApiKey,
  useRevokeReadToken,
} from '@/api/projectSettings';
import type { ApiKey, DatasetReadToken } from '@/api/types';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  ErrorState,
  Skeleton,
  Stack,
  Text,
  TextField,
  useToast,
  type Column,
} from '@/ui';
import { useProjectContext } from '../ProjectContext';
import { SecretRevealDialog } from '../dialogs';
import styles from './settings.module.css';

function fmt(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : '—';
}

export function ApiKeysTab() {
  const { project, readOnly, isAdmin } = useProjectContext();
  return (
    <Stack gap="xl">
      <KeysCard projectId={project.id} readOnly={readOnly} />
      {isAdmin ? <ReadTokensCard projectId={project.id} readOnly={readOnly} /> : null}
    </Stack>
  );
}

function KeysCard({ projectId, readOnly }: { projectId: string; readOnly: boolean }) {
  const keys = useApiKeys(projectId);
  const showSkeleton = useDelayedPending(keys.isPending);
  const create = useCreateApiKey(projectId);
  const revoke = useRevokeApiKey(projectId);
  const toast = useToast();
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const columns: Column<ApiKey>[] = [
    { id: 'name', label: 'Name', flex: true, minWidth: 140, cell: (k) => k.name || 'Unnamed key' },
    { id: 'prefix', label: 'Prefix', width: 140, mono: true, cell: (k) => `${k.prefix}…` },
    {
      id: 'creator',
      label: 'Created by',
      width: 180,
      cell: (k) => k.creator?.display_name || k.creator?.email || '—',
    },
    { id: 'created', label: 'Created', width: 170, mono: true, cell: (k) => fmt(k.created_at) },
    {
      id: 'status',
      label: 'Status',
      width: 100,
      cell: (k) =>
        k.revoked_at ? <Badge tone="neutral">revoked</Badge> : <Badge tone="success">active</Badge>,
    },
    {
      id: 'actions',
      label: 'Actions',
      hideLabel: true,
      width: 100,
      resizable: false,
      cell: (k) =>
        !k.revoked_at ? (
          <Button variant="danger" onPress={() => setRevoking(k)}>
            Revoke
          </Button>
        ) : null,
    },
  ];
  return (
    <section className={styles.card} aria-labelledby="keys-title" data-api-keys>
      <div className={styles.cardHeader}>
        <div>
          <Text variant="md" id="keys-title">
            API keys
          </Text>
          <Text variant="sm">Used by the SDK (QYM_API_KEY) to push runs into this project.</Text>
        </div>
      </div>
      <div className={styles.cardBody}>
        {!readOnly ? (
          <form
            className={styles.addBar}
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const created = await create.mutateAsync({ name: name.trim() || undefined });
                setSecret(created.token);
                setName('');
              } catch (err) {
                toast.show(
                  err instanceof ApiError ? err.detail || 'Could not create key' : 'Could not create key',
                  { tone: 'error' },
                );
              }
            }}
          >
            <TextField
              label="Key name"
              placeholder="CI pipeline"
              value={name}
              onChange={setName}
              width={260}
            />
            <Button type="submit" variant="primary" loading={create.isPending}>
              Create key
            </Button>
          </form>
        ) : null}
        {keys.isError ? (
          <ErrorState
            error={keys.error}
            title="Couldn’t load API keys"
            onRetry={() => keys.refetch()}
            compact
          />
        ) : keys.isPending ? (
          showSkeleton ? (
            <Skeleton kind="table" rows={2} />
          ) : null
        ) : (
          <DataTable
            aria-label="API keys"
            columns={columns}
            rows={keys.data}
            rowKey={(k) => k.id}
            storageKey="settings-api-keys"
            emptyState="No API keys yet."
          />
        )}
      </div>
      <SecretRevealDialog
        open={secret !== null}
        onClose={() => setSecret(null)}
        title="API key created"
        noun="API key"
        secret={secret}
      />
      {revoking ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRevoking(null)}
          title={`Revoke “${revoking.name || revoking.prefix}”?`}
          tone="danger"
          description="Clients using this key stop working immediately."
          confirmLabel="Revoke key"
          onConfirm={async () => {
            try {
              await revoke.mutateAsync(revoking.id);
              toast.show('Key revoked', { tone: 'info' });
            } catch (e) {
              throw new Error(e instanceof ApiError ? e.detail || 'Could not revoke' : String(e));
            }
          }}
        />
      ) : null}
    </section>
  );
}

function ReadTokensCard({ projectId, readOnly }: { projectId: string; readOnly: boolean }) {
  const tokens = useDatasetReadTokens(projectId, true);
  const create = useCreateReadToken(projectId);
  const revoke = useRevokeReadToken(projectId);
  const toast = useToast();
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<DatasetReadToken | null>(null);
  const columns: Column<DatasetReadToken>[] = [
    { id: 'name', label: 'Name', flex: true, minWidth: 140, cell: (t) => t.name || 'Unnamed token' },
    { id: 'created', label: 'Created', width: 170, mono: true, cell: (t) => fmt(t.created_at) },
    {
      id: 'status',
      label: 'Status',
      width: 100,
      cell: (t) =>
        t.revoked_at ? <Badge tone="neutral">revoked</Badge> : <Badge tone="success">active</Badge>,
    },
    {
      id: 'actions',
      label: 'Actions',
      hideLabel: true,
      width: 100,
      resizable: false,
      cell: (t) =>
        !t.revoked_at ? (
          <Button variant="danger" onPress={() => setRevoking(t)}>
            Revoke
          </Button>
        ) : null,
    },
  ];
  return (
    <section className={styles.card} aria-labelledby="tokens-title" data-read-tokens>
      <div className={styles.cardHeader}>
        <div>
          <Text variant="md" id="tokens-title">
            Dataset read tokens
          </Text>
          <Text variant="sm">
            Admin-issued; lets a service read private test sets (QYM_DATASET_READ_TOKEN). Sent only on dataset
            reads.
          </Text>
        </div>
      </div>
      <div className={styles.cardBody}>
        {!readOnly ? (
          <form
            className={styles.addBar}
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const created = await create.mutateAsync({ name: name.trim() || undefined });
                setSecret(created.token);
                setName('');
              } catch (err) {
                toast.show(
                  err instanceof ApiError ? err.detail || 'Could not create token' : 'Could not create token',
                  { tone: 'error' },
                );
              }
            }}
          >
            <TextField
              label="Token name"
              placeholder="Eval service"
              value={name}
              onChange={setName}
              width={260}
            />
            <Button type="submit" variant="primary" loading={create.isPending}>
              Create token
            </Button>
          </form>
        ) : null}
        {tokens.isError ? (
          <ErrorState
            error={tokens.error}
            title="Couldn’t load tokens"
            onRetry={() => tokens.refetch()}
            compact
          />
        ) : tokens.isPending ? null : (
          <DataTable
            aria-label="Dataset read tokens"
            columns={columns}
            rows={tokens.data}
            rowKey={(t) => t.id}
            emptyState="No read tokens."
          />
        )}
      </div>
      <SecretRevealDialog
        open={secret !== null}
        onClose={() => setSecret(null)}
        title="Read token created"
        noun="Dataset read token"
        secret={secret}
      />
      {revoking ? (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setRevoking(null)}
          title={`Revoke “${revoking.name || 'this token'}”?`}
          tone="danger"
          description="Services using this token lose access to private datasets."
          confirmLabel="Revoke token"
          onConfirm={async () => {
            try {
              await revoke.mutateAsync(revoking.id);
              toast.show('Token revoked', { tone: 'info' });
            } catch (e) {
              throw new Error(e instanceof ApiError ? e.detail || 'Could not revoke' : String(e));
            }
          }}
        />
      ) : null}
    </section>
  );
}
