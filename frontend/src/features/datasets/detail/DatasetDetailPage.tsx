/**
 * /projects/:slug/datasets/:ref — hero + Items/Runs/Lineage/Settings tabs,
 * or the item page when `?item=` (brief 07 §2.4). Version resolution:
 * `?v=` alias → label → production → newest published → newest; the URL is
 * normalised to always carry `?v=`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { downloadUrl, useDataset, useDatasetVersions, useSetProduction, type Dataset, type DatasetVersion } from '@/api/datasets';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import { platformUrl } from '@/lib/runtime';
import { useDocumentTitle, useProjectContext, useTopbarStats } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { Badge, Button, DropdownMenu, ErrorState, Icon, IconButton, Identicon, PageHeader, Skeleton, TabPanel, Tabs, Tag, Text, Tooltip, useToast } from '@/ui';
import { AddItemDialog, CreateDraftDialog, NameVersionDialog, PublishDialog } from '../components/dialogs';
import { UserPill } from '../components/UserPill';
import { VersionSwitcher } from '../components/VersionSwitcher';
import { pluralize, relativeTime } from '../lib/itemValue';
import { comparePath, datasetPath, parseDatasetRoute, type DetailTab } from '../lib/route';
import { PRODUCTION_RULE, isProduction, resolveActiveVersion } from '../lib/versions';
import { UploadWizard, type WizardMode } from '../wizard/UploadWizard';
import { ItemsWorkspace } from './ItemsWorkspace';
import { LineageTab } from './LineageTab';
import { RunsTab } from './RunsTab';
import { SettingsTab } from './SettingsTab';
import { ItemPage } from '../item/ItemPage';
import { InlineEditDialog } from './InlineEditDialog';
import styles from './DatasetDetailPage.module.css';

export function DatasetDetailPage({ datasetRef }: { datasetRef: string }) {
  const { slug, project, readOnly } = useProjectContext();
  const [search] = useSearchParams();
  const route = parseDatasetRoute(datasetRef, search);
  const navigate = useNavigate();
  const dsQuery = useDataset(slug, datasetRef);
  const versionsQuery = useDatasetVersions(slug, datasetRef, Boolean(dsQuery.data));
  const dataset = dsQuery.data;
  const versions = useMemo(() => versionsQuery.data ?? [], [versionsQuery.data]);
  const active = useMemo(() => resolveActiveVersion(versions, route.version), [versions, route.version]);
  const pending = dsQuery.isPending || (Boolean(dataset) && versionsQuery.isPending);
  const showSkeleton = useDelayedPending(pending);
  useDocumentTitle(dataset ? `${dataset.name}${route.itemId ? ` · ${route.itemId}` : ''}` : `${project.name} · Datasets`);

  // Normalise the URL: canonical slug, `?v=` always present, legacy tab=versions → lineage.
  useEffect(() => {
    if (!dataset || !versionsQuery.data) return;
    const next = new URLSearchParams(search);
    let changed = false;
    if (active && next.get('v') !== active.version) {
      next.set('v', active.version);
      changed = true;
    }
    if (!active && next.has('v')) {
      next.delete('v');
      changed = true;
    }
    if (route.legacyTab) {
      next.set('tab', 'lineage');
      changed = true;
    }
    if (!route.itemId && !next.get('tab')) {
      next.set('tab', 'items');
      changed = true;
    }
    const canonicalRef = dataset.slug !== datasetRef;
    if (changed || canonicalRef) {
      navigate({ pathname: canonicalRef ? datasetPath(slug, dataset.slug) : undefined, search: `?${next.toString()}` }, { replace: true });
    }
  }, [dataset, versionsQuery.data, active, search, route.legacyTab, route.itemId, navigate, slug, datasetRef]);

  const runCount = dataset?.run_count;
  const itemCount = active?.item_count ?? 0;
  const stats = useMemo(
    () =>
      runCount === undefined
        ? null
        : [
            { value: versions.length, label: 'versions' },
            { value: runCount, label: 'runs' },
            { value: itemCount, label: 'items' },
          ],
    [runCount, versions.length, itemCount],
  );
  useTopbarStats(stats);

  if (showSkeleton && !dataset) return <div className={fullWidth}><Skeleton kind="lines" rows={3} label="Loading dataset" /></div>;
  if (dsQuery.isError) {
    return (
      <div className={fullWidth}>
        <ErrorState error={dsQuery.error} title="Couldn’t load this dataset" notFoundMessage="No dataset with this name or slug exists in the project (it may have been deleted)." onRetry={() => void dsQuery.refetch()} />
      </div>
    );
  }
  if (versionsQuery.isError) {
    return (
      <div className={fullWidth}>
        <ErrorState error={versionsQuery.error} title="Couldn’t load versions" onRetry={() => void versionsQuery.refetch()} />
      </div>
    );
  }
  if (!dataset || !versionsQuery.data) return null;

  if (route.itemId && active) {
    return <ItemPage slug={slug} dataset={dataset} versions={versions} version={active} itemId={route.itemId} readOnly={readOnly} />;
  }

  return <DetailBody slug={slug} dataset={dataset} versions={versions} active={active} tab={route.tab} readOnly={readOnly} />;
}

function DetailBody({ slug, dataset, versions, active, tab, readOnly }: { slug: string; dataset: Dataset; versions: DatasetVersion[]; active: DatasetVersion | null; tab: DetailTab; readOnly: boolean }) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const toast = useToast();
  const setProduction = useSetProduction(slug, dataset.slug);
  const [dialog, setDialog] = useState<'draft' | 'publish' | 'name' | 'rename' | 'describe' | null>(null);
  const [wizard, setWizard] = useState<WizardMode | null>(null);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const ref = dataset.slug;
  const isDraft = active?.status === 'draft';
  const canWrite = !readOnly;
  const contentAccess = dataset.items_visible;
  const canSetProd = dataset.permissions.can_set_production;

  const hrefFor = (v: DatasetVersion) => {
    const next = new URLSearchParams(search);
    next.set('v', v.version);
    next.delete('page');
    return `${datasetPath(slug, ref)}?${next.toString()}`;
  };

  async function onSetProduction() {
    if (!active) return;
    try {
      await setProduction.mutateAsync(active.version);
      toast.show(`${active.version} is now production`, { tone: 'success' });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || e.message : 'Could not set production', { tone: 'error' });
    }
  }

  const primaryActions = !canWrite || !contentAccess ? null : !active ? (
    <Button variant="primary" icon={<Icon name="plus" size={12} />} onPress={() => setDialog('draft')} data-testid="create-first-draft">
      Create first draft
    </Button>
  ) : isDraft ? (
    <>
      <Button variant="neutral" icon={<Icon name="plus" size={12} />} onPress={() => setAddItemOpen(true)} data-testid="add-item">
        Add item
      </Button>
      <Button variant="neutral" onPress={() => setWizard('add-to-draft')} data-testid="import-draft">
        Import
      </Button>
      <Button variant="primary" onPress={() => setDialog('publish')} data-testid="publish">
        Publish
      </Button>
    </>
  ) : (
    <>
      {!isProduction(active) ? (
        canSetProd ? (
          <Button variant="accent" onPress={() => void onSetProduction()} loading={setProduction.isPending} data-testid="set-production">
            Set as production
          </Button>
        ) : (
          <Tooltip content={PRODUCTION_RULE}>
            <Button variant="neutral" aria-disabled="true" onPress={() => toast.show(PRODUCTION_RULE, { tone: 'info' })}>
              Set as production
            </Button>
          </Tooltip>
        )
      ) : null}
      <Button variant="primary" icon={<Icon name="plus" size={12} />} onPress={() => setDialog('draft')} data-testid="create-draft">
        Create draft
      </Button>
    </>
  );

  const tabItems = [
    { id: 'items', label: 'Items', count: active?.item_count },
    { id: 'runs', label: 'Runs', count: active?.run_count },
    { id: 'lineage', label: 'Lineage', count: versions.length },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className={fullWidth} data-dataset-detail={ref}>
      <PageHeader
        leading={<Identicon seed={ref} chip />}
        title={
          <span className={styles.titleRow}>
            <span dir="auto">{dataset.name}</span>
            {canWrite ? <IconButton label="Rename dataset" icon="edit" onPress={() => setDialog('rename')} /> : null}
            {dataset.private_test_set ? <Badge tone="warning">Private test set</Badge> : null}
          </span>
        }
        description={
          dataset.description ? (
            <button type="button" className={styles.descButton} onClick={() => canWrite && setDialog('describe')} disabled={!canWrite} dir="auto">
              {dataset.description}
            </button>
          ) : canWrite ? (
            <button type="button" className={styles.descButton} onClick={() => setDialog('describe')}>
              + Add a description
            </button>
          ) : undefined
        }
        meta={[
          pluralize(versions.length, 'version'),
          pluralize(dataset.run_count, 'run'),
          pluralize(active?.item_count ?? 0, 'item'),
          ...(active?.parent_version_id
            ? [
                <span key="fork">
                  forked from{' '}
                  <a href={hrefFor(versions.find((v) => v.id === active.parent_version_id) ?? active)} className={styles.inlineLink}>
                    {versions.find((v) => v.id === active.parent_version_id)?.version ?? '?'}
                  </a>
                </span>,
              ]
            : []),
          ...(active ? [<span key="source">source: {active.source_type}</span>] : []),
          ...(active?.published_by ? [<UserPill key="pub" user={active.published_by} label="Published By:" />] : []),
          ...(active?.created_by ? [<UserPill key="drafted" user={active.created_by} label="Drafted By:" />] : []),
          `updated ${relativeTime(dataset.updated_at)}`,
        ]}
        actions={
          <div className={styles.heroActions}>
            {active ? <VersionSwitcher versions={versions} active={active} hrefFor={hrefFor} /> : <Tag>no versions</Tag>}
            {primaryActions}
            {active ? (
              <DropdownMenu
                label="More actions"
                trigger={<IconButton label="More actions" icon="more" data-testid="hero-more" />}
                items={[
                  ...(canWrite ? [{ id: 'name', label: 'Name version…' }] : []),
                  ...(versions.length > 1 ? [{ id: 'compare', label: 'Compare…' }] : []),
                  ...(dataset.items_visible ? [{ id: 'download', label: '↓ Download JSONL', href: platformUrl(downloadUrl(slug, ref, active.version)) }] : []),
                  ...(canWrite ? [{ id: 'upload', label: '↑ Upload file as new version…', separatorBefore: true }] : []),
                ]}
                onAction={(id) => {
                  if (id === 'name') setDialog('name');
                  else if (id === 'compare') {
                    const other = versions.find((v) => v.id !== active.id);
                    navigate(comparePath(slug, ref, { base: other?.version ?? active.version, head: active.version }));
                  } else if (id === 'upload') setWizard('new-version');
                }}
              />
            ) : null}
          </div>
        }
      />
      <Tabs label="Dataset sections" items={tabItems} selected={tab} onSelect={(id) => navigate({ search: `?${withTab(search, id)}` })}>
        <TabPanel id="items">
          {active ? (
            <ItemsWorkspace slug={slug} dataset={dataset} version={active} readOnly={readOnly} onAddItem={() => setAddItemOpen(true)} onImport={() => setWizard('add-to-draft')} />
          ) : (
            <NoVersions canWrite={canWrite} onCreate={() => setDialog('draft')} onImport={() => setWizard('new-version')} />
          )}
        </TabPanel>
        <TabPanel id="runs">
          <RunsTab slug={slug} datasetRef={ref} version={active} />
        </TabPanel>
        <TabPanel id="lineage">
          <LineageTab slug={slug} datasetRef={ref} />
        </TabPanel>
        <TabPanel id="settings">
          <SettingsTab slug={slug} dataset={dataset} readOnly={readOnly} />
        </TabPanel>
      </Tabs>

      <CreateDraftDialog
        open={dialog === 'draft'}
        onOpenChange={(o) => !o && setDialog(null)}
        slug={slug}
        dataset={dataset}
        versions={versions}
        current={active}
        onCreated={(v) => navigate(datasetPath(slug, ref, { tab: 'items', v: v.version }))}
      />
      {active ? <PublishDialog open={dialog === 'publish'} onOpenChange={(o) => !o && setDialog(null)} slug={slug} dataset={dataset} version={active} canSetProduction={canSetProd} /> : null}
      {active ? <NameVersionDialog open={dialog === 'name'} onOpenChange={(o) => !o && setDialog(null)} slug={slug} dataset={dataset} version={active} /> : null}
      <InlineEditDialog open={dialog === 'rename' || dialog === 'describe'} field={dialog === 'describe' ? 'description' : 'name'} onOpenChange={(o) => !o && setDialog(null)} slug={slug} dataset={dataset} />
      {active && isDraft ? <AddItemDialog open={addItemOpen} onOpenChange={setAddItemOpen} slug={slug} dataset={dataset} version={active} /> : null}
      <UploadWizard
        open={wizard !== null}
        onOpenChange={(o) => !o && setWizard(null)}
        slug={slug}
        mode={wizard ?? 'new-version'}
        target={dataset}
        draft={isDraft ? active : null}
        latestVersion={versions[0]?.version ?? null}
        canSetProduction={canSetProd}
        onDone={(r) => {
          if (r.mode === 'new-version' && r.version) navigate(datasetPath(slug, ref, { tab: 'items', v: r.version.version }));
        }}
      />
    </div>
  );
}

function withTab(search: URLSearchParams, tab: string): string {
  const next = new URLSearchParams(search);
  next.set('tab', tab);
  next.delete('page');
  return next.toString();
}

function NoVersions({ canWrite, onCreate, onImport }: { canWrite: boolean; onCreate: () => void; onImport: () => void }) {
  return (
    <div className={styles.noVersions}>
      <Text variant="xl" as="h2">
        No versions yet
      </Text>
      <Text variant="md" tone="muted">
        Create a draft to add items by hand, or import a file as the first version.
      </Text>
      {canWrite ? (
        <div className={styles.noVersionsActions}>
          <Button variant="primary" onPress={onCreate}>
            + Create first draft
          </Button>
          <Button variant="neutral" onPress={onImport}>
            Import a file
          </Button>
        </div>
      ) : null}
    </div>
  );
}
