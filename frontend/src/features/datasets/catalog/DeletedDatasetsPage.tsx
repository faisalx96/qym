/** /projects/:slug/datasets?view=deleted — restore soft-deleted datasets (brief 07 §2.12). */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDatasetCatalog, useRestoreDataset, type Dataset } from '@/api/datasets';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import {
  Button,
  DataTable,
  EmptyState,
  LinkButton,
  PageHeader,
  RelativeTime,
  Tag,
  Text,
  Tooltip,
  useToast,
} from '@/ui';
import { UserPill } from '../components/UserPill';
import { catalogPath, datasetPath } from '../lib/route';
import { RESTORE_RULE } from '../lib/versions';

export function DeletedDatasetsPage() {
  const { slug, project, readOnly } = useProjectContext();
  useDocumentTitle(`${project.name} · Deleted datasets`);
  const query = useDatasetCatalog(slug, true);
  const showSkeleton = useDelayedPending(query.isPending);
  const restore = useRestoreDataset(slug);
  const toast = useToast();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);
  const canRestore = Boolean(query.data?.permissions.can_manage) && !readOnly;

  async function onRestore(d: Dataset) {
    setBusyId(d.id);
    try {
      const r = await restore.mutateAsync(d.id);
      toast.show(`"${r.dataset.name}" restored`, { tone: 'success' });
      navigate(datasetPath(slug, r.dataset.slug));
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || e.message : 'Restore failed', { tone: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  const rows = query.data?.datasets ?? [];
  return (
    <div className={fullWidth} data-deleted-datasets>
      <PageHeader
        title="Deleted datasets"
        description="Deleted datasets keep their versions, items and history until a project manager restores them."
        actions={
          <LinkButton to={catalogPath(slug)} variant="ghost">
            ← All datasets
          </LinkButton>
        }
      />
      <DataTable<Dataset>
        aria-label="Deleted datasets"
        storageKey="datasets.deleted.v2"
        density="regular"
        rows={rows}
        rowKey={(d) => d.id}
        loading={showSkeleton}
        error={query.isError ? query.error : undefined}
        onRetry={() => void query.refetch()}
        empty={
          query.data ? (
            <EmptyState
              title="No deleted datasets"
              body="Datasets you delete appear here and can be restored."
            />
          ) : undefined
        }
        columns={[
          {
            id: 'name',
            header: 'Dataset',
            flex: true,
            minWidth: 220,
            pin: 'start',
            hideable: false,
            priority: 1,
            cell: (d) => (
              <span>
                <Text as="span" variant="md" weight={600}>
                  {d.name}
                </Text>{' '}
                <Tag kind="data">{d.original_slug ?? d.slug}</Tag>
              </span>
            ),
          },
          {
            id: 'deleted_at',
            header: 'Deleted',
            type: 'date',
            width: 130,
            priority: 2,
            cell: (d) => <RelativeTime iso={d.deleted_at} />,
          },
          {
            id: 'deleted_by',
            header: 'Deleted by',
            width: 180,
            priority: 2,
            cell: (d) => <UserPill user={d.deleted_by} />,
          },
          {
            id: 'latest',
            header: 'Latest version',
            type: 'id',
            width: 150,
            priority: 3,
            cell: (d) => (d.latest_version ? `${d.latest_version.version} ${d.latest_version.status}` : '—'),
          },
          {
            id: 'restore',
            header: 'Restore',
            type: 'actions',
            hideLabel: true,
            width: 110,
            hideable: false,
            cell: (d) =>
              canRestore ? (
                <Button
                  variant="accent"
                  size="sm"
                  onPress={() => void onRestore(d)}
                  loading={busyId === d.id}
                  data-testid={`restore-${d.slug}`}
                >
                  Restore
                </Button>
              ) : (
                <Tooltip content={readOnly ? 'This project is archived.' : RESTORE_RULE}>
                  <Button
                    variant="neutral"
                    size="sm"
                    aria-disabled="true"
                    data-disabled-reason=""
                    onPress={() =>
                      toast.show(readOnly ? 'This project is archived.' : RESTORE_RULE, { tone: 'info' })
                    }
                  >
                    Restore
                  </Button>
                </Tooltip>
              ),
          },
        ]}
      >
        <DataTable.Footer
          summary={
            query.data ? `${rows.length} deleted ${rows.length === 1 ? 'dataset' : 'datasets'}` : undefined
          }
        />
      </DataTable>
    </div>
  );
}
