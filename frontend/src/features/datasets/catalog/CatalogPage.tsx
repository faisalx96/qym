/**
 * /projects/:slug/datasets — catalog cards (brief 07 §2.1). Search is
 * client-side and mirrored to `?q=`; sort lives in `?sort=`.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDatasetCatalog, type Dataset } from '@/api/datasets';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import {
  ActionTile,
  Button,
  DropdownMenu,
  EmptyState,
  ErrorState,
  Icon,
  Identicon,
  LinkButton,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  Text,
  Card,
  Flag,
} from '@/ui';
import { NewDatasetDialog } from '../components/dialogs';
import { VersionBadge } from '../components/VersionSwitcher';
import { UnregisteredNames } from './UnregisteredNames';
import { UserPill } from '../components/UserPill';
import { formatDate, pluralize, relativeTime } from '../lib/itemValue';
import { catalogPath, datasetPath } from '../lib/route';
import {
  CATALOG_SORTS,
  catalogItemCount,
  catalogStateLine,
  catalogStateVersions,
  catalogVersionCount,
  filterCatalog,
  sortCatalog,
  type CatalogSort,
} from '../lib/versions';
import { UploadWizard } from '../wizard/UploadWizard';
import styles from './CatalogPage.module.css';
import { APP_LOCALE } from '@/lib/dates';

export function CatalogPage() {
  const { slug, project, readOnly } = useProjectContext();
  const { params, replaceUrlQuery } = useSearchParamsState();
  useDocumentTitle(`${project.name} · Datasets`);
  const query = useDatasetCatalog(slug);
  const showSkeleton = useDelayedPending(query.isPending);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const sortRaw = params.get('sort') ?? 'updated_desc';
  const sort = (CATALOG_SORTS.some((s) => s.key === sortRaw) ? sortRaw : 'updated_desc') as CatalogSort;
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [registering, setRegistering] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  // Debounced mirror of the search box into ?q= (replaceState).
  useEffect(() => {
    const t = setTimeout(() => replaceUrlQuery({ q: search.trim() || null }), 180);
    return () => clearTimeout(t);
  }, [search, replaceUrlQuery]);

  const datasets = useMemo(() => query.data?.datasets ?? [], [query.data]);
  const visible = useMemo(() => sortCatalog(filterCatalog(datasets, search), sort), [datasets, search, sort]);
  const runTotal = datasets.reduce((n, d) => n + d.run_count, 0);

  const canCreate = !readOnly;
  const header = (
    <PageHeader
      title="Datasets"
      description={
        query.data
          ? `${pluralize(datasets.length, 'dataset')} · ${pluralize(runTotal, 'run')}`
          : 'Versioned test sets for this project'
      }
      actions={
        <>
          <LinkButton to={catalogPath(slug, { view: 'deleted' })} variant="neutral">
            Deleted datasets
          </LinkButton>
          {canCreate ? (
            <DropdownMenu
              label="New dataset"
              trigger={
                <Button variant="primary" icon={<Icon name="plus" size={12} />} data-testid="new-dataset">
                  New dataset
                </Button>
              }
              items={[
                {
                  id: 'blank',
                  label: 'Start blank',
                  description: 'Create an empty dataset',
                  icon: <ActionTile icon="plus" />,
                },
                {
                  id: 'import',
                  label: 'Import CSV / TSV / JSON / JSONL',
                  description: 'Upload a file as version v1',
                  icon: <ActionTile icon="upload" />,
                },
              ]}
              onAction={(id) => (id === 'blank' ? setCreating(true) : setImporting(true))}
            />
          ) : null}
        </>
      }
    />
  );

  return (
    <div className={fullWidth} data-datasets-catalog>
      {header}
      {datasets.length ? (
        <div className={styles.toolbar}>
          <SearchField
            label="Search datasets"
            placeholder="Search datasets"
            value={search}
            onChange={setSearch}
            width="var(--search-width)"
            shortcut="/"
          />
          <Select
            label="Sort"
            hideLabel
            items={CATALOG_SORTS.map((s) => ({ key: s.key, label: s.label }))}
            value={sort}
            onChange={(k) => replaceUrlQuery({ sort: k === 'updated_desc' ? null : String(k) })}
            searchable={false}
            width={150}
          />
        </div>
      ) : null}
      {showSkeleton ? (
        <Skeleton kind="cards" count={6} label="Loading datasets" />
      ) : query.isError ? (
        <ErrorState error={query.error} title="Couldn’t load datasets" onRetry={() => void query.refetch()} />
      ) : query.data && datasets.length === 0 ? (
        <EmptyState
          icon={<Icon name="folder" />}
          title="No datasets yet"
          guide="/docs/get-started/datasets"
          body={
            canCreate
              ? 'Create a dataset to version your test items and track which runs used them.'
              : 'This project has no datasets.'
          }
          action={
            canCreate ? (
              <div className={styles.emptyActions}>
                <Button
                  icon={<Icon name="plus" size={12} />}
                  variant="primary"
                  onPress={() => setCreating(true)}
                >
                  Create your first dataset
                </Button>
                <Button variant="neutral" onPress={() => setImporting(true)}>
                  Import a file
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : query.data && visible.length === 0 ? (
        <EmptyState
          compact
          title={`No datasets match “${search}”`}
          action={
            <Button variant="neutral" onPress={() => setSearch('')}>
              Clear search
            </Button>
          }
        />
      ) : query.data ? (
        <ul className={styles.grid} aria-label="Datasets">
          {visible.map((d) => (
            <li key={d.id}>
              <DatasetCard dataset={d} slug={slug} />
            </li>
          ))}
        </ul>
      ) : null}
      {query.data ? (
        <UnregisteredNames slug={slug} canRegister={canCreate} onRegister={(name) => setRegistering(name)} />
      ) : null}
      <NewDatasetDialog open={creating} onOpenChange={setCreating} slug={slug} />
      <NewDatasetDialog
        open={registering !== null}
        onOpenChange={(o) => {
          if (!o) setRegistering(null);
        }}
        slug={slug}
        initialName={registering ?? undefined}
      />
      <UploadWizard
        open={importing}
        onOpenChange={setImporting}
        slug={slug}
        mode="new"
        catalog={datasets}
        canSetProduction
        onDone={(r) => {
          if (r.dataset) navigate(datasetPath(slug, r.dataset.slug, { tab: 'items', v: r.version?.version }));
        }}
      />
    </div>
  );
}

function DatasetCard({ dataset: d, slug }: { dataset: Dataset; slug: string }) {
  return (
    <Card to={datasetPath(slug, d.slug)} className={styles.fill} data-dataset-card={d.slug}>
      <div className={styles.stack}>
        <div className={styles.cardWrap}>
          <div className={styles.cardHead} data-testid="da-card-head">
            <span className={styles.cardIcon}>
              <Identicon seed={d.slug} chip />
            </span>
            <div className={styles.cardTitle}>
              <Text variant="lg" as="span" className={styles.cardName} data-testid="da-card-name">
                {d.name}
              </Text>
              {/* each version with its own status mark, Production in full (C168) */}
              <span className={styles.state} aria-label={catalogStateLine(d)}>
                {catalogStateVersions(d).map((v, i) => (
                  <span key={v.id} className={styles.stateVersion}>
                    {i ? <span aria-hidden="true">·</span> : null}
                    <span className={styles.stateLabel}>{v.version}</span>
                    <VersionBadge version={v} />
                  </span>
                ))}
                {!catalogStateVersions(d).length ? <span>empty</span> : null}
                {!d.production_version && d.latest_version?.status === 'draft' ? (
                  <span>· never published</span>
                ) : null}
              </span>
            </div>
            {d.private_test_set || d.access_mode === 'restricted' ? (
              <div className={styles.badges} data-testid="da-card-badges">
                {d.private_test_set ? (
                  <Flag tone="warning" icon="eye-off">
                    Private test set
                  </Flag>
                ) : null}
                {d.access_mode === 'restricted' ? (
                  <Flag icon="lock" data-testid="restricted-badge">
                    Restricted
                  </Flag>
                ) : null}
                {d.access_mode === 'restricted' && d.permissions.access_level === 'view' ? (
                  <Flag icon="eye">View only</Flag>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <p className={styles.description} dir="auto">
          {d.description || <span className={styles.noDescription}>No description</span>}
        </p>
        <div className={styles.stats}>
          <span>{catalogItemCount(d).toLocaleString(APP_LOCALE)} items</span>
          <span>
            {catalogVersionCount(d)} {catalogVersionCount(d) === 1 ? 'version' : 'versions'}
          </span>
          <span>
            {d.run_count.toLocaleString(APP_LOCALE)} {d.run_count === 1 ? 'run' : 'runs'}
          </span>
        </div>
        <div className={styles.cardFoot}>
          <UserPill user={d.created_by} />
          <span className={styles.dates}>
            created {formatDate(d.created_at, 'date')} · updated {relativeTime(d.updated_at)}
          </span>
        </div>
      </div>
    </Card>
  );
}
