/**
 * /projects/:slug/datasets — catalog cards (brief 07 §2.1). Search is
 * client-side and mirrored to `?q=`; sort lives in `?sort=`.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDatasetCatalog, type Dataset } from '@/api/datasets';
import { useDelayedPending } from '@/lib/pending';
import { useSearchParamsState } from '@/lib/url-state';
import { useDocumentTitle, useProjectContext, useTopbarStats } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { Badge, Button, DropdownMenu, EmptyState, ErrorState, Icon, Identicon, LinkButton, PageHeader, SearchField, Select, Skeleton, Text } from '@/ui';
import { NewDatasetDialog } from '../components/dialogs';
import { UserPill } from '../components/UserPill';
import { formatDate, pluralize, relativeTime } from '../lib/itemValue';
import { catalogPath, datasetPath } from '../lib/route';
import { CATALOG_SORTS, catalogItemCount, catalogStateLine, catalogVersionCount, filterCatalog, sortCatalog, type CatalogSort } from '../lib/versions';
import { UploadWizard } from '../wizard/UploadWizard';
import styles from './CatalogPage.module.css';

export function CatalogPage() {
  const { slug, project, readOnly } = useProjectContext();
  const { params, replaceUrlQuery } = useSearchParamsState();
  useDocumentTitle(`${project.name} · Datasets`);
  const query = useDatasetCatalog(slug);
  const showSkeleton = useDelayedPending(query.isPending);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const sortRaw = params.get('sort') ?? 'updated_desc';
  const sort = (CATALOG_SORTS.some((s) => s.key === sortRaw) ? sortRaw : 'updated_desc') as CatalogSort;
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);

  // Debounced mirror of the search box into ?q= (replaceState).
  useEffect(() => {
    const t = setTimeout(() => replaceUrlQuery({ q: search.trim() || null }), 180);
    return () => clearTimeout(t);
  }, [search, replaceUrlQuery]);

  const datasets = useMemo(() => query.data?.datasets ?? [], [query.data]);
  const visible = useMemo(() => sortCatalog(filterCatalog(datasets, search), sort), [datasets, search, sort]);
  const runTotal = datasets.reduce((n, d) => n + d.run_count, 0);
  const hasData = Boolean(query.data);
  const stats = useMemo(
    () =>
      hasData
        ? [
            { value: datasets.length, label: 'datasets' },
            { value: runTotal, label: 'runs' },
          ]
        : null,
    [hasData, datasets.length, runTotal],
  );
  useTopbarStats(stats);

  const canCreate = !readOnly;
  const header = (
    <PageHeader
      title="Datasets"
      description={query.data ? `${pluralize(datasets.length, 'dataset')} · ${pluralize(runTotal, 'run')}` : 'Versioned test sets for this project'}
      actions={
        datasets.length ? (
          <>
            <SearchField label="Search datasets" placeholder="Search datasets…" value={search} onChange={setSearch} width={240} />
            <Select
              label="Sort"
              hideLabel
              items={CATALOG_SORTS.map((s) => ({ key: s.key, label: s.label }))}
              value={sort}
              onChange={(k) => replaceUrlQuery({ sort: k === 'updated_desc' ? null : String(k) })}
              searchable={false}
              width={150}
            />
            <LinkButton to={catalogPath(slug, { view: 'deleted' })} variant="ghost">
              Deleted datasets
            </LinkButton>
            {canCreate ? (
              <DropdownMenu
                label="New dataset"
                trigger={
                  <Button variant="primary" icon={<Icon name="plus" size={12} />} iconEnd={<Icon name="chevron-down" size={12} />} data-testid="new-dataset">
                    New dataset
                  </Button>
                }
                items={[
                  { id: 'blank', label: 'Start blank', description: 'Create an empty dataset' },
                  { id: 'import', label: 'Import CSV / TSV / JSON / JSONL', description: 'Upload a file as version v1' },
                ]}
                onAction={(id) => (id === 'blank' ? setCreating(true) : setImporting(true))}
              />
            ) : null}
          </>
        ) : undefined
      }
    />
  );

  return (
    <div className={fullWidth} data-datasets-catalog>
      {header}
      {showSkeleton ? (
        <Skeleton kind="cards" count={6} label="Loading datasets" />
      ) : query.isError ? (
        <ErrorState error={query.error} title="Couldn’t load datasets" onRetry={() => void query.refetch()} />
      ) : query.data && datasets.length === 0 ? (
        <EmptyState
          icon={<Icon name="folder" />}
          title="No datasets yet"
          body={canCreate ? 'Create a dataset to version your test items and track which runs used them.' : 'This project has no datasets.'}
          action={
            canCreate ? (
              <div className={styles.emptyActions}>
                <Button variant="primary" onPress={() => setCreating(true)}>
                  + Create your first dataset
                </Button>
                <Button variant="neutral" onPress={() => setImporting(true)}>
                  Import a file
                </Button>
              </div>
            ) : undefined
          }
        />
      ) : query.data && visible.length === 0 ? (
        <EmptyState compact title="No datasets match" body={`Nothing matches “${search}”.`} action={<Button variant="neutral" onPress={() => setSearch('')}>Clear search</Button>} />
      ) : query.data ? (
        <ul className={styles.grid} aria-label="Datasets">
          {visible.map((d) => (
            <li key={d.id}>
              <DatasetCard dataset={d} slug={slug} />
            </li>
          ))}
        </ul>
      ) : null}
      <NewDatasetDialog open={creating} onOpenChange={setCreating} slug={slug} />
      <UploadWizard open={importing} onOpenChange={setImporting} slug={slug} mode="new" catalog={datasets} canSetProduction onDone={() => undefined} />
    </div>
  );
}

function DatasetCard({ dataset: d, slug }: { dataset: Dataset; slug: string }) {
  return (
    <Link to={datasetPath(slug, d.slug)} className={styles.card} data-dataset-card={d.slug}>
      <div className={styles.cardHead}>
        <Identicon seed={d.slug} chip />
        <div className={styles.cardTitle}>
          <Text variant="lg" as="span" truncate>
            {d.name}
          </Text>
          <span className={styles.state}>{catalogStateLine(d)}</span>
        </div>
        {d.private_test_set ? <Badge tone="warning">Private test set</Badge> : null}
      </div>
      <p className={styles.description} dir="auto">
        {d.description || <span className={styles.noDescription}>No description</span>}
      </p>
      <div className={styles.stats}>
        <span>
          <strong>{catalogItemCount(d).toLocaleString()}</strong> items
        </span>
        <span>
          <strong>{catalogVersionCount(d)}</strong> {catalogVersionCount(d) === 1 ? 'version' : 'versions'}
        </span>
        <span>
          <strong>{d.run_count.toLocaleString()}</strong> runs
        </span>
      </div>
      <div className={styles.cardFoot}>
        <UserPill user={d.created_by} />
        <span className={styles.dates}>
          created {formatDate(d.created_at, 'date')} · updated {relativeTime(d.updated_at)}
        </span>
      </div>
    </Link>
  );
}
