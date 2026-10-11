/** The environments table with its row actions (Run default preset, Manage/View, Test). Page and settings share it. */
import { useState } from 'react';
import { useTestEnvironment } from '@/api/evalEnvironments';
import { errorMessage, useEvalEnvironments, type EvalEnvironment } from '@/api/evalCommon';
import { useDelayedPending } from '@/lib/pending';
import { Button, DataTable, EmptyState, ErrorState, Icon, Skeleton, Tag, useToast, type Column } from '@/ui';
import { DefaultPresetTag, HealthCell, SchemaCell, SlotsStatusTag } from './cells';
import styles from './EnvironmentsTable.module.css';
import { canRunDefaultPreset, useRunDefaultPreset } from './runDefaultPreset';

export interface EnvironmentsListProps {
  projectId: string;
  slug: string;
  canManage: boolean;
  readOnly: boolean;
  onOpen: (env: EvalEnvironment) => void;
  onAdd?: () => void;
  storageKey?: string;
}

export function EnvironmentsList({
  projectId,
  slug,
  canManage,
  readOnly,
  onOpen,
  onAdd,
  storageKey,
}: EnvironmentsListProps) {
  const list = useEvalEnvironments(projectId);
  const showSkeleton = useDelayedPending(list.isPending);
  const test = useTestEnvironment(projectId);
  const toast = useToast();
  const [testingId, setTestingId] = useState<string | null>(null);
  const defaults = useRunDefaultPreset({ projectId, slug, canManage });
  const canEdit = canManage && !readOnly;

  async function runTest(env: EvalEnvironment) {
    setTestingId(env.id);
    try {
      const r = await test.mutateAsync(env.id);
      if (r.ok) toast.show(`“${env.name}” is healthy`, { tone: 'success' });
      else toast.show(`“${env.name}” failed: ${r.error || 'unreachable'}`, { tone: 'error', timeout: 8000 });
    } catch (e) {
      toast.show(errorMessage(e) || 'Test failed', { tone: 'error', timeout: 8000 });
    } finally {
      setTestingId(null);
    }
  }

  if (list.isError)
    return (
      <ErrorState
        error={list.error}
        title="Could not load environments"
        onRetry={() => void list.refetch()}
      />
    );
  if (list.isPending)
    return showSkeleton ? <Skeleton kind="table" rows={4} label="Loading environments" /> : null;

  const envs = list.data;
  if (!envs.length) {
    return (
      <EmptyState
        icon={<Icon name="flask" />}
        title="No environments yet"
        body={
          canEdit
            ? 'Add one to launch experiments against an Evaluation Service deployment.'
            : 'A project manager can add one.'
        }
        action={
          canEdit && onAdd ? (
            <Button variant="primary" size="md" onPress={onAdd}>
              + Add environment
            </Button>
          ) : undefined
        }
      />
    );
  }

  const columns: Column<EvalEnvironment>[] = [
    {
      id: 'name',
      label: 'Environment',
      flex: true,
      minWidth: 180,
      cell: (env) => (
        <div className={styles.name}>
          <span className={styles.nameRow}>
            <button type="button" className={styles.nameLink} onClick={() => onOpen(env)}>
              {env.name}
            </button>
            {env.is_active ? null : <Tag tone="warning">Disabled</Tag>}
          </span>
          {env.description ? (
            <span className={styles.meta} title={env.description}>
              {env.description}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      id: 'url',
      label: 'URL',
      width: 230,
      minWidth: 140,
      cell: (env) => (
        <span className={styles.url} title={env.base_url}>
          {env.base_url}
        </span>
      ),
    },
    { id: 'health', label: 'Health', width: 110, cell: (env) => <HealthCell env={env} /> },
    { id: 'schema', label: 'Schema', width: 130, cell: (env) => <SchemaCell env={env} /> },
    { id: 'groups', label: 'LLM groups', width: 130, cell: (env) => <SlotsStatusTag env={env} /> },
    { id: 'default', label: 'Default preset', width: 140, cell: (env) => <DefaultPresetTag env={env} /> },
    {
      id: 'cap',
      label: 'Priority cap',
      width: 125,
      cell: (env) => <Tag kind="data">{env.max_priority || '—'}</Tag>,
    },
    {
      id: 'actions',
      label: 'Actions',
      hideLabel: true,
      width: 330,
      resizable: false,
      cell: (env) => (
        <span className={styles.actions}>
          {canRunDefaultPreset(env) && !readOnly ? (
            <Button
              variant="neutral"
              loading={defaults.busyId === env.id}
              onPress={() => void defaults.run(env)}
              aria-label={`Run default preset v${env.official_preset_version} on ${env.name}`}
            >
              Run default preset
            </Button>
          ) : null}
          <Button
            variant="neutral"
            onPress={() => onOpen(env)}
            aria-label={`${canManage ? 'Manage' : 'View'} ${env.name}`}
          >
            {canManage ? 'Manage' : 'View'}
          </Button>
          {canEdit ? (
            <Button
              variant="neutral"
              loading={testingId === env.id}
              onPress={() => void runTest(env)}
              aria-label={`Test ${env.name}`}
            >
              Test
            </Button>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <DataTable
        aria-label="Environments"
        columns={columns}
        rows={envs}
        rowKey={(env) => env.id}
        minWidth={980}
        storageKey={storageKey}
        stickyHeader={false}
      />
      {defaults.dialog}
    </>
  );
}
