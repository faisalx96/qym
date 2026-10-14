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
import { useDelayedPending, useSubmitLock } from '@/lib/pending';
import {
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  ErrorState,
  RelativeTime,
  Skeleton,
  Stack,
  Text,
  TextField,
  useToast,
  type Column,
  Card,
} from '@/ui';
import { useAuth } from '../AuthContext';
import { useProjectContext } from '../ProjectContext';
import { SecretRevealDialog } from '../dialogs';
import styles from './settings.module.css';

export function ApiKeysTab() {
  const { project, readOnly, isAdmin, canManage } = useProjectContext();
  return (
    <Stack gap="xl">
      <KeysCard projectId={project.id} readOnly={readOnly} canManage={canManage} />
      {isAdmin ? <ReadTokensCard projectId={project.id} readOnly={readOnly} /> : null}
    </Stack>
  );
}

function KeysCard({
  projectId,
  readOnly,
  canManage,
}: {
  projectId: string;
  readOnly: boolean;
  canManage: boolean;
}) {
  const { me } = useAuth();
  const keys = useApiKeys(projectId);
  const showSkeleton = useDelayedPending(keys.isPending);
  const create = useCreateApiKey(projectId);
  const lock = useSubmitLock();
  const revoke = useRevokeApiKey(projectId);
  const toast = useToast();
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const columns: Column<ApiKey>[] = [
    {
      id: 'name',
      header: 'Name',
      flex: true,
      minWidth: 140,
      pin: 'start',
      hideable: false,
      priority: 1,
      cell: (k) => k.name || 'Unnamed key',
    },
    { id: 'prefix', header: 'Prefix', type: 'id', width: 140, priority: 3, cell: (k) => `${k.prefix}…` },
    {
      id: 'creator',
      header: 'Created by',
      width: 180,
      priority: 2,
      cell: (k) => k.creator?.display_name || k.creator?.email || '—',
    },
    {
      id: 'created',
      header: 'Created',
      type: 'date',
      width: 130,
      priority: 2,
      cell: (k) => <RelativeTime iso={k.created_at} />,
    },
    {
      id: 'status',
      header: 'Status',
      type: 'status',
      width: 100,
      priority: 1,
      cell: (k) =>
        k.revoked_at ? <Badge tone="neutral">revoked</Badge> : <Badge tone="success">active</Badge>,
    },
  ];
  return (
    <Card
      as="section"
      aria-labelledby="keys-title"
      data-api-keys
      header={
        <div className={styles.cardHeader}>
          <div>
            <Text variant="md" id="keys-title">
              API keys
            </Text>
            <Text variant="sm">Used by the SDK (QYM_API_KEY) to push runs into this project.</Text>
          </div>
        </div>
      }
    >
      <div className={styles.cardBody}>
        {!readOnly ? (
          <form
            className={styles.addBar}
            onSubmit={(e) => {
              e.preventDefault();
              void lock(async () => {
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
              });
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
          <DataTable<ApiKey>
            density="regular"
            rowActions={(k) =>
              !k.revoked_at && (canManage || k.creator?.id === me.id)
                ? [
                    {
                      id: 'revoke',
                      label: `Revoke ${k.name || 'key'}`,
                      icon: 'close',
                      primary: true,
                      danger: true,
                      onPress: setRevoking,
                    },
                  ]
                : []
            }
            aria-label="API keys"
            columns={columns}
            rows={keys.data}
            rowKey={(k) => k.id}
            storageKey="settings-api-keys"
            empty="No API keys yet."
          />
        )}
      </div>
      <SecretRevealDialog
        open={secret !== null}
        onClose={() => setSecret(null)}
        title="API key created"
        noun="API key"
        description="Copy it now; it is shown once. Store it in a secret manager or your .env as QYM_API_KEY."
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
    </Card>
  );
}

function ReadTokensCard({ projectId, readOnly }: { projectId: string; readOnly: boolean }) {
  const tokens = useDatasetReadTokens(projectId, true);
  const create = useCreateReadToken(projectId);
  const lock = useSubmitLock();
  const revoke = useRevokeReadToken(projectId);
  const toast = useToast();
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<DatasetReadToken | null>(null);
  const columns: Column<DatasetReadToken>[] = [
    {
      id: 'name',
      header: 'Name',
      flex: true,
      minWidth: 140,
      pin: 'start',
      hideable: false,
      priority: 1,
      cell: (t) => t.name || 'Unnamed token',
    },
    {
      id: 'prefix',
      header: 'Prefix',
      type: 'id',
      width: 140,
      priority: 3,
      cell: (t) => (t.prefix ? `${t.prefix}…` : '—'),
    },
    {
      id: 'creator',
      header: 'Created by',
      width: 180,
      priority: 2,
      cell: (t) => t.creator?.display_name || t.creator?.email || '—',
    },
    {
      id: 'created',
      header: 'Created',
      type: 'date',
      width: 130,
      priority: 2,
      cell: (t) => <RelativeTime iso={t.created_at} />,
    },
    {
      id: 'status',
      header: 'Status',
      type: 'status',
      width: 100,
      priority: 1,
      cell: (t) =>
        t.revoked_at ? <Badge tone="neutral">revoked</Badge> : <Badge tone="success">active</Badge>,
    },
  ];
  return (
    <Card
      as="section"
      aria-labelledby="tokens-title"
      data-read-tokens
      header={
        <div className={styles.cardHeader}>
          <div>
            <Text variant="md" id="tokens-title">
              Dataset read tokens
            </Text>
            <Text variant="sm">
              Admin-issued; lets a service read private test sets (QYM_DATASET_READ_TOKEN). Sent only on
              dataset reads.
            </Text>
          </div>
        </div>
      }
    >
      <div className={styles.cardBody}>
        {!readOnly ? (
          <form
            className={styles.addBar}
            onSubmit={(e) => {
              e.preventDefault();
              void lock(async () => {
                try {
                  const created = await create.mutateAsync({ name: name.trim() || undefined });
                  setSecret(created.token);
                  setName('');
                } catch (err) {
                  toast.show(
                    err instanceof ApiError
                      ? err.detail || 'Could not create token'
                      : 'Could not create token',
                    { tone: 'error' },
                  );
                }
              });
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
          <DataTable<DatasetReadToken>
            density="regular"
            rowActions={(t) =>
              !t.revoked_at
                ? [
                    {
                      id: 'revoke',
                      label: `Revoke ${t.name || 'token'}`,
                      icon: 'close',
                      primary: true,
                      danger: true,
                      onPress: setRevoking,
                    },
                  ]
                : []
            }
            aria-label="Dataset read tokens"
            columns={columns}
            rows={tokens.data}
            rowKey={(t) => t.id}
            empty="No read tokens."
          />
        )}
      </div>
      <SecretRevealDialog
        open={secret !== null}
        onClose={() => setSecret(null)}
        title="Read token created"
        noun="Dataset read token"
        description="Copy it now; it is shown once. Set it on the Evaluation Service as QYM_DATASET_READ_TOKEN. It can read every dataset in this project, private test sets included."
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
    </Card>
  );
}
