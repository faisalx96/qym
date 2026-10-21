/**
 * Item page (brief 07 §2.7): `?item=<id>&tab=details|runs|history`. Details
 * edits on drafts with the Text/JSON contract and sends only touched fields;
 * Prev/Next follow the list order (search/sort/label) via /neighbors.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBlocker } from 'react-router-dom';
import {
  useDatasetItem,
  useDeleteItem,
  useItemNeighbors,
  type Dataset,
  type DatasetItem,
  type DatasetVersion,
} from '@/api/datasets';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import { fullWidth } from '@/features/shell/layout';
import {
  Button,
  ConfirmDialog,
  CopyButton,
  ErrorState,
  Icon,
  LinkButton,
  PageHeader,
  Skeleton,
  TabPanel,
  Tabs,
  Tag,
  useToast,
} from '@/ui';
import { CreateDraftDialog, DisableItemDialog } from '../components/dialogs';
import { DisabledBanner, EnableButton, useItemStateActions } from '../components/ItemStateUi';
import { FieldEditor } from '../components/FieldEditor';
import { useItemEditor } from './useItemEditor';
import { formatDate, relativeTime } from '../lib/itemValue';
import { metaFiltersToParams, metaModesToParams, parseMetaFilters } from '../lib/metaFilter';
import { ITEM_TABS, datasetPath, parseDatasetRoute, type ItemTab } from '../lib/route';
import { ItemHistoryTab } from './ItemHistoryTab';
import { ItemRunsTab } from './ItemRunsTab';
import styles from './ItemPage.module.css';

export interface ItemPageProps {
  slug: string;
  dataset: Dataset;
  versions: DatasetVersion[];
  version: DatasetVersion;
  itemId: string;
  readOnly: boolean;
}

export function ItemPage({ slug, dataset, versions, version, itemId, readOnly }: ItemPageProps) {
  const [params] = useSearchParams();
  const route = parseDatasetRoute(dataset.slug, params);
  const navigate = useNavigate();
  const toast = useToast();
  const visible = dataset.items_visible;
  const itemQuery = useDatasetItem(slug, dataset.slug, version.version, itemId, visible);
  const metaFilters = useMemo(
    () => parseMetaFilters(route.meta, route.metaMode),
    [route.meta, route.metaMode],
  );
  const metaParams = useMemo(() => metaFiltersToParams(metaFilters), [metaFilters]);
  const metaModes = useMemo(() => metaModesToParams(metaFilters), [metaFilters]);
  const neighbors = useItemNeighbors(
    slug,
    dataset.slug,
    version.version,
    itemId,
    {
      search: route.search || undefined,
      sort: route.sort || undefined,
      label: route.label || undefined,
      // a disabled item opened under the Active list still finds its neighbours in the full list
      state: route.state === 'all' || itemQuery.data?.state === 'disabled' ? undefined : route.state,
      meta: metaParams.length ? metaParams : undefined,
      meta_mode: metaModes.length ? metaModes : undefined,
    },
    visible && Boolean(itemQuery.data),
  );
  const del = useDeleteItem(slug, dataset.slug, version.version);
  const showSkeleton = useDelayedPending(itemQuery.isPending && visible);
  const [draftOpen, setDraftOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [disableOpen, setDisableOpen] = useState(false);
  const stateActions = useItemStateActions(slug, dataset.slug, version);
  const editable = version.status === 'draft' && !readOnly;
  const item = itemQuery.data;

  const tab: ItemTab = ITEM_TABS.includes(route.itemTab) ? route.itemTab : 'details';
  const linkTo = useCallback(
    (updates: Record<string, string | null>) => {
      const next = new URLSearchParams(params);
      for (const [k, v] of Object.entries(updates)) {
        if (v === null) next.delete(k);
        else next.set(k, v);
      }
      return `${datasetPath(slug, dataset.slug)}?${next.toString()}`;
    },
    [params, slug, dataset.slug],
  );

  const editor = useItemEditor(slug, dataset.slug, version.version, item);
  const { state, dirty, valid } = editor;
  const setEdit = (v: null) => {
    if (v === null) editor.reset();
  };

  // Unsaved-changes guard: in-app navigation and tab close.
  // `leaving` lets a confirmed delete navigate away without a second "discard" prompt.
  const leaving = useRef(false);
  const blocker = useBlocker(() => editable && dirty && !leaving.current);
  useEffect(() => {
    if (!editable || !dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [editable, dirty]);

  async function save() {
    try {
      const saved = await editor.save();
      if (saved) toast.show(`Item ${saved.item_id} saved`, { tone: 'success' });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || e.message : 'Save failed', { tone: 'error' });
    }
  }

  // Ctrl/⌘+S saves.
  useEffect(() => {
    if (!editable) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty && valid) void save();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editable, dirty, valid, state]);

  if (!visible) {
    return (
      <div className={fullWidth}>
        <ErrorState
          error={{ status: 403 }}
          title="Private test set"
          message="Item contents are hidden from non-admins."
        />
      </div>
    );
  }
  if (showSkeleton && !item)
    return (
      <div className={fullWidth}>
        <Skeleton kind="lines" rows={6} label="Loading item" />
      </div>
    );
  if (itemQuery.isError) {
    return (
      <div className={fullWidth}>
        <ErrorState
          error={itemQuery.error}
          title="Couldn’t load this item"
          notFoundMessage={`No item “${itemId}” in ${version.version}.`}
          onRetry={() => void itemQuery.refetch()}
        />
        <LinkButton to={linkTo({ item: null, tab: 'items' })} variant="ghost">
          ← Back to items
        </LinkButton>
      </div>
    );
  }
  if (!item || !state) return null;

  const title = /^item-\d+$/.test(item.item_id) ? `Item #${item.index}` : item.item_id;
  const prev = neighbors.data?.previous ?? null;
  const next = neighbors.data?.next ?? null;

  return (
    <div className={fullWidth} data-item-page={item.item_id}>
      <PageHeader
        title={
          <span className={styles.titleRow}>
            <span dir="ltr">{title}</span>
            <CopyButton text={item.item_id} label="Copy item ID" />
          </span>
        }
        meta={[
          `index ${item.index}`,
          `updated ${relativeTime(item.updated_at)}`,
          `created ${formatDate(item.created_at, 'date')}`,
          <span key="id" className={styles.mono}>
            id {item.item_id}
          </span>,
          <Tag key="v" kind="version">
            {version.version} {version.status}
          </Tag>,
          ...(neighbors.data
            ? [`${neighbors.data.index + 1} of ${neighbors.data.total.toLocaleString()} in this view`]
            : []),
        ]}
        actions={
          <div className={styles.actions}>
            {version.status !== 'draft' && !readOnly ? (
              <>
                <Button
                  variant="accent"
                  size="md"
                  onPress={() => setDraftOpen(true)}
                  data-testid="create-draft-to-edit"
                >
                  Create draft to edit
                </Button>
                <Button
                  variant="neutral"
                  size="md"
                  onPress={() => setDraftOpen(true)}
                  data-testid="item-state-action"
                >
                  {item.state === 'disabled' ? 'Create a draft to enable' : 'Create a draft to disable'}
                </Button>
              </>
            ) : null}
            {editable && item.state !== 'disabled' ? (
              <Button
                variant="neutral"
                size="md"
                onPress={() => setDisableOpen(true)}
                data-testid="item-state-action"
              >
                Disable item…
              </Button>
            ) : null}
            {editable ? (
              <Button
                variant="danger"
                size="md"
                onPress={() => setConfirmDelete(true)}
                data-testid="delete-item"
              >
                Delete
              </Button>
            ) : null}
            <LinkButton
              to={prev ? linkTo({ item: prev.item_id }) : ''}
              variant="neutral"
              size="md"
              aria-disabled={!prev || undefined}
              data-testid="item-prev"
              icon={<Icon name="prev" size={12} />}
              onClick={(e) => !prev && e.preventDefault()}
            >
              Previous
            </LinkButton>
            <LinkButton
              to={next ? linkTo({ item: next.item_id }) : ''}
              variant="neutral"
              size="md"
              aria-disabled={!next || undefined}
              data-testid="item-next"
              onClick={(e) => !next && e.preventDefault()}
            >
              Next <Icon name="next" size={12} />
            </LinkButton>
            {editable ? (
              <Button
                variant="primary"
                size="md"
                onPress={() => void save()}
                isDisabled={!dirty || !valid}
                loading={editor.saving}
                data-testid="save-item"
              >
                Save changes
              </Button>
            ) : null}
          </div>
        }
      />
      {item.state === 'disabled' ? (
        <div className={styles.banner}>
          <DisabledBanner item={item} published={version.status !== 'draft'} />
          {editable ? (
            <div>
              <EnableButton
                size="md"
                loading={stateActions.enabling}
                onPress={() => void stateActions.enableItem(item.item_id)}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <Tabs
        label="Item sections"
        items={[
          { id: 'details', label: 'Details' },
          { id: 'runs', label: 'Runs', count: item.run_count },
          { id: 'history', label: 'History' },
        ]}
        selected={tab}
        onSelect={(id) => navigate(linkTo({ tab: id === 'details' ? null : id }))}
      >
        <TabPanel id="details">
          <div className={styles.panels}>
            <div className={styles.mainCol}>
              <FieldEditor
                label="Input"
                value={item.input}
                editable={editable}
                state={state.input}
                onChange={(s) => editor.set('input', s)}
              />
              <FieldEditor
                label="Expected output"
                value={item.expected_output}
                editable={editable}
                state={state.expected}
                onChange={(s) => editor.set('expected', s)}
              />
            </div>
            <div className={styles.sideCol}>
              <FieldEditor
                label="Metadata"
                value={item.metadata}
                editable={editable}
                jsonOnly
                state={state.metadata}
                onChange={(s) => editor.set('metadata', s)}
              />
              {item.labels?.length ? (
                <div className={styles.labels}>
                  {item.labels.map((l) => (
                    <Tag key={l} kind="data">
                      {l}
                    </Tag>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </TabPanel>
        <TabPanel id="runs">
          <ItemRunsTab slug={slug} dataset={dataset} version={version} itemId={item.item_id} />
        </TabPanel>
        <TabPanel id="history">
          <ItemHistoryTab slug={slug} dataset={dataset} version={version} item={item} editable={editable} />
        </TabPanel>
      </Tabs>

      <CreateDraftDialog
        open={draftOpen}
        onOpenChange={setDraftOpen}
        slug={slug}
        dataset={dataset}
        versions={versions}
        current={version}
        onCreated={(v) => navigate(linkTo({ v: v.version }))}
      />
      <DisableItemDialog
        open={disableOpen}
        onOpenChange={setDisableOpen}
        itemId={item.item_id}
        onConfirm={(reason) => stateActions.disableItem(item.item_id, reason)}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete item ${item.item_id}?`}
        description="The item is removed from this draft. Published versions keep their copy."
        confirmLabel="Delete item"
        tone="danger"
        onConfirm={async () => {
          try {
            await del.mutateAsync(item.item_id);
            toast.show(`Item ${item.item_id} deleted`, { tone: 'success' });
            leaving.current = true;
            setEdit(null);
            navigate(
              next
                ? linkTo({ item: next.item_id })
                : prev
                  ? linkTo({ item: prev.item_id })
                  : linkTo({ item: null, tab: 'items' }),
            );
          } catch (e) {
            toast.show(e instanceof ApiError ? e.detail || e.message : 'Delete failed', { tone: 'error' });
            throw e;
          }
        }}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.state === 'blocked' && blocker.reset()}
        title="Discard unsaved changes?"
        description="This item has edits that are not saved."
        cancelLabel="Keep editing"
        confirmLabel="Discard changes"
        tone="danger"
        onConfirm={() => {
          setEdit(null);
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />
    </div>
  );
}

export type { DatasetItem };
