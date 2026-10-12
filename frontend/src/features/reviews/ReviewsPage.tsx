/**
 * /reviews and /projects/:slug/reviews — compact queue rows + sticky detail pane (UX decision A).
 * Filters live in the URL; keyboard triage j k a r e o x / ? Shift+A; single and bulk decisions
 * with expected_count / expected_status guards and a conflict dialog on 409.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { useParams, useSearchParams } from 'react-router-dom';
import {
  fetchCorrection,
  invalidateCorrections,
  reviewKeys,
  useBulkDecide,
  useCorrections,
  useDecide,
  useDeleteCorrection,
  useEditDiagnosis,
  type BulkAction,
  type CorrectionRow,
  type CorrectionsPage,
  type CorrectionStatus,
  type ReviewFilters,
  type ReviewSort,
} from '@/api/reviews';
import { ApiError } from '@/lib/http';
import { useDelayedPending } from '@/lib/pending';
import { useDocumentTitle } from '@/features/shell';
import { fullWidth } from '@/features/shell/layout';
import { Button, Checkbox, ConfirmDialog, EmptyState, ErrorState, IconButton, PageHeader, SearchField, Select, Skeleton, TabPanel, Tabs, Text, useToast } from '@/ui';
import { ConflictDialog, CommentDialog, ShortcutsDialog } from './dialogs';
import { DetailPane } from './DetailPane';
import { FilterChips, FiltersPanel, FiltersToggle } from './FiltersPopover';
import { applyFilterParams, bulkSelection, BULK_FITS, clearedFilters, describeView, filtersFromParams, fitsStatusTab, hasActiveFilters } from './lib/filters';
import { useQueueKeys } from './lib/useQueueKeys';
import { ReviewRow } from './ReviewRow';
import styles from './ReviewsPage.module.css';

type ListData = InfiniteData<CorrectionsPage, string | null>;
const SORTS: { key: ReviewSort; label: string }[] = [
  { key: 'oldest', label: 'Oldest first' },
  { key: 'confidence', label: 'Lowest confidence' },
  { key: 'newest', label: 'Most recent' },
];

export function ReviewsPage() {
  const { slug } = useParams();
  const projectSlug = slug ?? null;
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const toast = useToast();
  useDocumentTitle('Reviews');
  const filters = useMemo(() => filtersFromParams(params, projectSlug), [params, projectSlug]);
  const idParam = params.get('id');
  const linkedId = idParam && /^\d+$/.test(idParam) ? Number(idParam) : null;

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const setFilters = useCallback(
    (patch: Partial<ReviewFilters>) => {
      setParams((prev) => applyFilterParams(prev, { ...filtersFromParams(prev, projectSlug), ...patch }), { replace: true });
      setSelected(new Set());
    },
    [setParams, projectSlug],
  );

  const [search, setSearch] = useState(filters.search);
  useEffect(() => {
    if (search === filters.search) return;
    const t = setTimeout(() => setFilters({ search: search.trim() }), 300);
    return () => clearTimeout(t);
  }, [search, filters.search, setFilters]);

  const list = useCorrections(filters);
  const showSkeleton = useDelayedPending(list.isPending);
  const first = list.data?.pages[0];
  const listKey = useMemo(() => reviewKeys.list(filters), [filters]);

  // ?id= deep link: fetch separately, switch to its status tab, show it at the top.
  const [linkedRaw, setLinked] = useState<CorrectionRow | null>(null);
  const linked = linkedId === null ? null : linkedRaw;
  useEffect(() => {
    if (linkedId === null) return;
    let cancelled = false;
    fetchCorrection(linkedId)
      .then((row) => {
        if (cancelled) return;
        setLinked(row);
        if (filters.status !== 'all' && filters.status !== row.status) setFilters({ status: row.status });
      })
      .catch(() => toast.show(`Correction #${linkedId} could not be opened`, { tone: 'error' }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedId]);

  const loaded = useMemo(() => list.data?.pages.flatMap((p) => p.corrections) ?? [], [list.data]);
  const rows = useMemo(() => {
    if (linked && fitsStatusTab(linked, filters.status) && !loaded.some((r) => r.id === linked.id)) return [linked, ...loaded];
    return loaded;
  }, [loaded, linked, filters.status]);

  const [pickedId, setCurrentId] = useState<number | null>(null);
  const currentId = rows.some((r) => r.id === pickedId) ? pickedId : linkedId && rows.some((r) => r.id === linkedId) ? linkedId : (rows[0]?.id ?? null);
  const current = rows.find((r) => r.id === currentId) ?? null;

  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const inflight = useRef(new Set<number>());
  const [dialog, setDialog] = useState<null | { kind: 'reject'; row: CorrectionRow } | { kind: 'bulk'; action: 'approve' | 'reject' } | { kind: 'delete'; row: CorrectionRow } | { kind: 'bulk-delete' }>(null);
  const [help, setHelp] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [conflict, setConflict] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const decideMut = useDecide();
  const deleteMut = useDeleteCorrection();
  const editMut = useEditDiagnosis();
  const bulkMut = useBulkDecide();

  // ---- cache patching -------------------------------------------------
  const applyUpdate = useCallback(
    (old: CorrectionRow, updated: CorrectionRow) => {
      const leaves = !fitsStatusTab(updated, filters.status);
      qc.setQueryData<ListData>(listKey, (d) => {
        if (!d) return d;
        return {
          ...d,
          pages: d.pages.map((pg, i) => {
            const stats = { ...pg.stats };
            if (i === 0 && old.status !== updated.status) {
              stats[old.status] = Math.max(0, stats[old.status] - 1);
              stats[updated.status] += 1;
            }
            const has = pg.corrections.some((r) => r.id === old.id);
            return {
              ...pg,
              stats,
              total: has && leaves ? Math.max(0, pg.total - 1) : pg.total,
              corrections: has ? (leaves ? pg.corrections.filter((r) => r.id !== old.id) : pg.corrections.map((r) => (r.id === old.id ? updated : r))) : pg.corrections,
            };
          }),
        };
      });
      void qc.invalidateQueries({ queryKey: reviewKeys.detail(old.id) });
      if (updated.id !== old.id) void qc.invalidateQueries({ queryKey: reviewKeys.detail(updated.id) });
      setLinked((l) => (l && l.id === old.id ? (leaves ? null : updated) : l));
      setSelected((s) => {
        if (!s.has(old.id)) return s;
        const n = new Set(s);
        n.delete(old.id);
        return n;
      });
    },
    [qc, listKey, filters.status],
  );

  const neighborOf = useCallback(
    (id: number): number | null => {
      const i = rows.findIndex((r) => r.id === id);
      return rows[i + 1]?.id ?? rows[i - 1]?.id ?? null;
    },
    [rows],
  );

  const focusRow = useCallback((id: number | null) => {
    if (id === null) return;
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-correction-row="${id}"] [data-review-card]`);
      el?.focus({ preventScroll: false });
      el?.scrollIntoView({ block: 'nearest' });
    });
  }, []);

  const moveTo = useCallback(
    (id: number | null) => {
      if (id === null) return;
      setCurrentId(id);
      setEditing(false);
      focusRow(id);
    },
    [focusRow],
  );

  // ---- single decisions ----------------------------------------------
  const decide = useCallback(
    async (row: CorrectionRow, action: 'approve' | 'reject' | 'reset', comment = '') => {
      if (row.review_block) {
        toast.show(row.review_block, { tone: 'error' });
        return;
      }
      if (inflight.current.has(row.id)) return;
      inflight.current.add(row.id);
      setBusy(new Set(inflight.current));
      const next = neighborOf(row.id);
      // On the All tab a decided row stays listed, so advance to the next pending row instead.
      const nextPending = rows.slice(rows.findIndex((r) => r.id === row.id) + 1).find((r) => r.status === 'pending')?.id ?? null;
      try {
        const updated = await decideMut.mutateAsync({ id: row.id, action, comment });
        applyUpdate(row, updated);
        if (!fitsStatusTab(updated, filters.status) && currentId === row.id) moveTo(next);
        else if (filters.status === 'all' && action !== 'reset' && currentId === row.id) moveTo(nextPending);
        toast.show(`${action === 'approve' ? 'Approved' : action === 'reject' ? 'Rejected' : 'Reset'} #${row.id}`, { tone: 'success' });
      } catch (e) {
        toast.show(e instanceof ApiError ? e.detail || e.message : 'Action failed', { tone: 'error' });
        if (e instanceof ApiError && e.status === 409) invalidateCorrections(qc);
      } finally {
        inflight.current.delete(row.id);
        setBusy(new Set(inflight.current));
      }
    },
    [toast, neighborOf, rows, decideMut, applyUpdate, filters.status, currentId, moveTo, qc],
  );

  async function saveEdit(issues: CorrectionRow['human_root_cause_issues']) {
    if (!current) return;
    try {
      const updated = await editMut.mutateAsync({
        id: current.id,
        body: {
          human_root_cause_issues: issues,
          human_root_causes: issues.map((i) => i.category),
          human_root_cause: issues[0]?.category ?? '',
          human_root_cause_detail: issues[0]?.finding ?? '',
          human_root_cause_note: current.human_root_cause_note ?? '',
        },
      });
      applyUpdate(current, updated); // may carry a new id (new revision)
      setCurrentId(updated.id);
      setEditing(false);
      toast.show('Diagnosis saved', { tone: 'success' });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || e.message : 'Save failed', { tone: 'error' });
    }
  }

  async function deleteRow(row: CorrectionRow) {
    const next = neighborOf(row.id);
    try {
      await deleteMut.mutateAsync(row.id);
      applyUpdate(row, { ...row, status: 'rejected' });
      if (currentId === row.id) moveTo(next);
      toast.show(`Correction #${row.id} deleted (marked rejected)`, { tone: 'success' });
    } catch (e) {
      toast.show(e instanceof ApiError ? e.detail || e.message : 'Delete failed', { tone: 'error' });
      throw e;
    }
  }

  // ---- bulk -------------------------------------------------------------
  function openBulk(action: 'approve' | 'reject') {
    if (!bulkSelection(rows, selected, action).ids.length) {
      toast.show(BULK_FITS[action].rule, { tone: 'error' });
      return;
    }
    setDialog({ kind: 'bulk', action });
  }

  async function runBulk(action: BulkAction, comment = '') {
    const ids = action === 'delete' ? [...selected] : bulkSelection(rows, selected, action).ids;
    if (!ids.length) {
      toast.show(action === 'delete' ? 'Nothing selected.' : BULK_FITS[action].rule, { tone: 'error' });
      return;
    }
    const expectedStatus: CorrectionStatus | undefined = filters.status !== 'all' ? filters.status : undefined;
    try {
      const r = await bulkMut.mutateAsync({ ids, action, comment: comment || undefined, expected_count: ids.length, expected_status: expectedStatus });
      if (r.corrections?.length) {
        const byId = new Map(rows.map((x) => [x.id, x] as const));
        for (const updated of r.corrections) {
          const old = byId.get(updated.id);
          if (old) applyUpdate(old, updated);
        }
      } else invalidateCorrections(qc);
      setSelected(new Set());
      toast.show(`${r.affected ?? ids.length} correction${(r.affected ?? ids.length) === 1 ? '' : 's'} ${action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : action === 'reset' ? 'reset' : 'deleted'}`, { tone: 'success' });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict(e.detail || 'The selected corrections changed.');
        return;
      }
      toast.show(e instanceof ApiError ? e.detail || e.message : 'Bulk action failed', { tone: 'error' });
      throw e;
    }
  }

  function reloadAfterConflict() {
    setConflict(null);
    setSelected(new Set());
    invalidateCorrections(qc);
  }

  // ---- keyboard ----------------------------------------------------------
  const indexOfCurrent = rows.findIndex((r) => r.id === currentId);
  const handlers = {
    next: () => moveTo(rows[Math.min(rows.length - 1, indexOfCurrent + 1)]?.id ?? null),
    prev: () => moveTo(rows[Math.max(0, indexOfCurrent - 1)]?.id ?? null),
    approve: () => {
      if (current && current.status === 'pending') void decide(current, 'approve');
    },
    reject: () => {
      if (!current || current.status !== 'pending') return;
      if (current.review_block) toast.show(current.review_block, { tone: 'error' });
      else setDialog({ kind: 'reject', row: current });
    },
    edit: () => {
      if (current) setEditing(true);
    },
    toggle: () => setExpanded((v) => !v),
    select: () => {
      if (!current) return;
      setSelected((s) => {
        const n = new Set(s);
        if (n.has(current.id)) n.delete(current.id);
        else n.add(current.id);
        return n;
      });
    },
    bulkApprove: () => {
      if (!selected.size) toast.show('Select corrections with x first.', { tone: 'info' });
      else openBulk('approve');
    },
    focusSearch: () => searchRef.current?.focus(),
    help: () => setHelp(true),
    escape: () => {
      if (editing) setEditing(false);
      else if (selected.size) setSelected(new Set());
    },
  };
  useQueueKeys(handlers);

  // ---- infinite scroll + top-up -------------------------------------------
  const sentinel = useRef<HTMLLIElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = list;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && !isFetchingNextPage && void fetchNextPage(), { rootMargin: '600px' });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, rows.length]);
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && loaded.length > 0 && loaded.length < 5) void fetchNextPage();
  }, [loaded.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  // ---- render --------------------------------------------------------------
  const stats = first?.stats ?? { total: 0, pending: 0, approved: 0, rejected: 0 };
  const reviewed = stats.approved + stats.rejected;
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const approveFit = bulkSelection(rows, selected, 'approve');
  const resetFit = bulkSelection(rows, selected, 'reset');
  const statusItems = [
    { id: 'pending', label: 'To review', count: stats.pending },
    { id: 'approved', label: 'Approved', count: stats.approved },
    { id: 'rejected', label: 'Rejected', count: stats.rejected },
    { id: 'all', label: 'All', count: stats.total },
  ];
  const filtered = hasActiveFilters(filters);

  return (
    <div className={fullWidth} data-reviews-page>
      <PageHeader
        title="Reviews"
        description="Validate corrections before they become examples for future auto-analysis."
        meta={[
          <span key="q">
            Queue: <strong>{stats.pending}</strong> to review
          </span>,
          <span key="p" className={styles.progress}>
            {reviewed} of {stats.total} reviewed
            <span className={styles.bar} role="progressbar" aria-label="Reviewed" aria-valuemin={0} aria-valuemax={stats.total} aria-valuenow={reviewed}>
              <span className={styles.fill} style={{ width: `${stats.total ? Math.round((reviewed / stats.total) * 100) : 0}%` }} />
            </span>
          </span>,
        ]}
      />
      <Tabs label="Review status" items={statusItems} selected={filters.status} onSelect={(id) => setFilters({ status: id as ReviewFilters['status'] })}>
        <TabPanel id={filters.status}>
          <div className={styles.toolbar}>
            <Checkbox isSelected={allSelected} isIndeterminate={!allSelected && selected.size > 0} onChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} aria-label="Select all visible corrections" hideLabel />
            <SearchField ref={searchRef} label="Search corrections" placeholder="Search task, item, root cause…" value={search} onChange={setSearch} width={260} />
            <Select label="Sort" hideLabel items={SORTS} value={filters.sort} onChange={(k) => k && setFilters({ sort: String(k) as ReviewSort })} searchable={false} width={170} />
            <FiltersToggle filters={filters} open={filtersOpen} onToggle={() => setFiltersOpen((v) => !v)} />
            <FilterChips filters={filters} onChange={setFilters} />
            {filtered || filters.status !== 'pending' ? (
              <Button variant="ghost" size="sm" onPress={() => { setSearch(''); setFilters(clearedFilters(filters)); }} data-testid="clear-filters">
                Clear filters
              </Button>
            ) : null}
            <span className={styles.grow} />
            <Text as="span" variant="sm" tone="muted" aria-live="polite" data-testid="result-count">
              {first ? `${first.total} correction${first.total === 1 ? '' : 's'}` : ''}
            </Text>
            <IconButton label="Keyboard shortcuts" icon="info" onPress={() => setHelp(true)} />
          </div>
          {filtersOpen ? <FiltersPanel filters={filters} facets={first} onChange={setFilters} /> : null}
          <div className={styles.bulk} role="region" aria-label="Bulk actions" data-active={selected.size ? '' : undefined}>
            {selected.size ? (
              <>
                <Text as="span" variant="md" weight={600}>
                  {selected.size} selected
                </Text>
                <Button variant="accent" size="sm" onPress={() => openBulk('approve')} isDisabled={!approveFit.ids.length} data-testid="bulk-approve">
                  Approve{approveFit.skipped ? ` (${approveFit.ids.length} of ${approveFit.selected})` : ''}
                </Button>
                <Button variant="danger" size="sm" onPress={() => openBulk('reject')} isDisabled={!approveFit.ids.length} data-testid="bulk-reject">
                  Reject{approveFit.skipped ? ` (${approveFit.ids.length} of ${approveFit.selected})` : ''}
                </Button>
                <Button variant="neutral" size="sm" onPress={() => void runBulk('reset')} isDisabled={!resetFit.ids.length} data-testid="bulk-reset">
                  Reset{resetFit.skipped ? ` (${resetFit.ids.length} of ${resetFit.selected})` : ''}
                </Button>
                <Button variant="ghost" size="sm" onPress={() => setDialog({ kind: 'bulk-delete' })} data-testid="bulk-delete">
                  Delete
                </Button>
                <Button variant="ghost" size="sm" onPress={() => setSelected(new Set())}>
                  Clear
                </Button>
              </>
            ) : (
              <Text as="span" variant="sm" tone="muted">
                Select rows with the checkboxes or <kbd>x</kbd> to act on several at once.
              </Text>
            )}
          </div>

          {showSkeleton ? (
            <Skeleton kind="table" rows={7} label="Loading corrections" />
          ) : list.isError ? (
            <ErrorState error={list.error} title="Couldn’t load the review queue" onRetry={() => void list.refetch()} />
          ) : first && rows.length === 0 ? (
            <EmptyState
              title={filtered || filters.search ? 'No corrections match these filters' : filters.status === 'pending' ? 'Queue is empty' : 'Nothing here yet'}
              body={filtered ? undefined : 'Corrections appear when reviewers change an AI diagnosis.'}
              action={filtered ? <Button variant="neutral" onPress={() => { setSearch(''); setFilters(clearedFilters(filters)); }}>Clear filters</Button> : undefined}
            />
          ) : first ? (
            <div className={styles.layout} data-has-pane={current ? '' : undefined}>
              <ul className={styles.rows} aria-label="Corrections" aria-busy={list.isFetching || undefined}>
                {rows.map((r) => (
                  <ReviewRow
                    key={r.id}
                    row={r}
                    current={r.id === currentId}
                    selected={selected.has(r.id)}
                    linked={linked?.id === r.id}
                    busy={busy.has(r.id)}
                    showProject={!projectSlug}
                    onSelectRow={() => moveTo(r.id)}
                    onToggleSelected={(v) => setSelected((s) => { const n = new Set(s); if (v) n.add(r.id); else n.delete(r.id); return n; })}
                    onApprove={() => void decide(r, 'approve')}
                    onReject={() => (r.review_block ? toast.show(r.review_block, { tone: 'error' }) : setDialog({ kind: 'reject', row: r }))}
                    onReset={() => void decide(r, 'reset')}
                  />
                ))}
                {hasNextPage ? (
                  <li ref={sentinel} className={styles.more}>
                    <Button variant="neutral" size="sm" onPress={() => void fetchNextPage()} loading={isFetchingNextPage} data-testid="load-more">
                      Load more
                    </Button>
                  </li>
                ) : null}
              </ul>
              {current ? (
                <DetailPane
                  row={current}
                  position={{ index: Math.max(0, indexOfCurrent), total: first.total }}
                  showProject={!projectSlug}
                  expanded={expanded}
                  editing={editing}
                  busy={busy.has(current.id)}
                  saving={editMut.isPending}
                  onApprove={() => void decide(current, 'approve')}
                  onReject={() => (current.review_block ? toast.show(current.review_block, { tone: 'error' }) : setDialog({ kind: 'reject', row: current }))}
                  onReset={() => void decide(current, 'reset')}
                  onDelete={() => setDialog({ kind: 'delete', row: current })}
                  onEdit={() => setEditing(true)}
                  onToggle={() => setExpanded((v) => !v)}
                  onSaveEdit={(issues) => void saveEdit(issues)}
                  onCancelEdit={() => setEditing(false)}
                />
              ) : null}
            </div>
          ) : null}
        </TabPanel>
      </Tabs>

      <CommentDialog
        open={dialog?.kind === 'reject'}
        onOpenChange={(o) => {
          if (!o) {
            const id = dialog && dialog.kind === 'reject' ? dialog.row.id : null;
            setDialog(null);
            focusRow(id);
          }
        }}
        title="Reject correction"
        description={dialog?.kind === 'reject' ? `Reject #${dialog.row.id} (${dialog.row.item_id}). A comment helps the author.` : ''}
        confirmLabel="Reject"
        tone="danger"
        onConfirm={async (comment) => {
          if (dialog?.kind === 'reject') await decide(dialog.row, 'reject', comment);
        }}
      />
      <CommentDialog
        open={dialog?.kind === 'bulk'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === 'bulk' ? `${dialog.action === 'approve' ? 'Approve' : 'Reject'} ${bulkSelection(rows, selected, dialog.action).ids.length} corrections` : ''}
        description={`Applies to the selected corrections in ${describeView(filters)}.`}
        confirmLabel={dialog?.kind === 'bulk' && dialog.action === 'reject' ? 'Reject' : 'Approve'}
        tone={dialog?.kind === 'bulk' && dialog.action === 'reject' ? 'danger' : 'primary'}
        onConfirm={async (comment) => {
          if (dialog?.kind === 'bulk') await runBulk(dialog.action, comment);
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog?.kind === 'delete' ? `Delete correction #${dialog.row.id}?` : ''}
        description="It is marked rejected and its history is kept."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={async () => {
          if (dialog?.kind === 'delete') await deleteRow(dialog.row);
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === 'bulk-delete'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={`Delete ${selected.size} correction${selected.size === 1 ? '' : 's'}?`}
        description="They are marked rejected and their history is kept."
        confirmLabel="Delete"
        tone="danger"
        onConfirm={() => runBulk('delete')}
      />
      <ShortcutsDialog open={help} onOpenChange={setHelp} />
      <ConflictDialog detail={conflict} onReload={reloadAfterConflict} />
    </div>
  );
}
