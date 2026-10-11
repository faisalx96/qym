import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Key } from 'react-aria-components';
import { Button, Checkbox, Chip, ConfirmDialog, CopyButton, DataTable, DropdownMenu, Icon, IconButton, Kbd, PageHeader, Pagination, Popover, SearchField, Select, Tag, Text } from '@/ui';
import { dataset, draftVersion, privateDataset, productionVersion, type Item } from '../fixtures';
import { MockFrame, useMockDataset, useMockView } from '../shared/MockFrame';
import { DatasetHero } from '../shared/DatasetHero';
import { itemColumns } from '../shared/itemsColumns';
import { FieldEditor } from '../shared/FieldEditor';
import type { Evaluation } from '../shared/editor';
import { AddItemFooter, ItemsBulkDialogs, ItemsToolbar, PrivateLocked, useItemsState } from '../shared/itemsState';
import {
  BulkBar,
  CardDetail,
  CommentDialog,
  ConflictDialog,
  ContextChips,
  DecisionButtons,
  EditForm,
  FacetFilters,
  IssueColumns,
  Previews,
  PriorityTag,
  QueueLine,
  ReviewedLine,
  ShortcutsDialog,
  StatusBadge,
  StatusTabs,
  activeFilterChips,
  emptyFilters,
  useReviewState,
  useTriageKeys,
  type FilterState,
} from '../shared/reviews';
import { TrashView } from '../shared/TrashView';
import shared from '../shared/shared.module.css';
import styles from './Mock.module.css';

/* ---------------- datasets: table + docked pane ---------------- */

function ItemPane({
  item,
  onPrev,
  onNext,
  onClose,
  onSave,
  initialExpected,
}: {
  item: Item;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
  onSave: (patch: Partial<Item>) => void;
  initialExpected?: { mode: 'json'; text: string };
}) {
  const [evals, setEvals] = useState<Record<string, Evaluation>>({});
  const dirty = Object.values(evals).some((e) => e.changed);
  const valid = Object.values(evals).every((e) => e.valid);
  const [guard, setGuard] = useState<null | (() => void)>(null);
  const go = (fn: () => void) => (dirty ? setGuard(() => fn) : fn());
  const save = () => {
    const patch: Partial<Item> = {};
    if (evals.input?.changed) patch.input = evals.input.next;
    if (evals.expected?.changed) patch.expected_output = evals.expected.next;
    if (evals.metadata?.changed) patch.metadata = evals.metadata.next as Record<string, unknown>;
    onSave(patch);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && dirty && valid) save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <aside className={styles.pane} aria-label={`Edit item ${item.item_id}`}>
      <div className={styles.paneHead}>
        <div className={styles.paneTitle}>
          <span className={shared.heroTitle}>
            <Text variant="lg" mono>
              {item.item_id}
            </Text>
            <CopyButton text={item.item_id} label="Copy item ID" />
          </span>
          <span className={styles.paneMeta}>
            index {item.index} · updated 2m ago · {item.edit_count} edits
          </span>
        </div>
        <span className={styles.paneNav}>
          <IconButton label="Previous item (k)" icon="chevron-up" onPress={() => go(onPrev)} />
          <IconButton label="Next item (j)" icon="chevron-down" onPress={() => go(onNext)} />
          <IconButton label="Close editor (Esc)" icon="close" onPress={() => go(onClose)} />
        </span>
      </div>
      <div className={styles.paneBody} key={item.id}>
        <FieldEditor label="Input" stored={item.input} rows={4} compact autoFocus onEvaluate={(e) => setEvals((p) => ({ ...p, input: e }))} />
        <FieldEditor label="Expected output" stored={item.expected_output} rows={3} compact initial={initialExpected} onEvaluate={(e) => setEvals((p) => ({ ...p, expected: e }))} />
        <FieldEditor label="Metadata" stored={item.metadata} jsonOnly rows={3} compact onEvaluate={(e) => setEvals((p) => ({ ...p, metadata: e }))} />
      </div>
      <div className={styles.paneFoot}>
        <Button variant="ghost" icon={<Icon name="external" size={12} />}>
          Open item page
        </Button>
        <Button variant="danger" size="sm">
          Delete
        </Button>
        <span className={styles.paneFootEnd}>
          <Text variant="sm" tone="muted">
            <Kbd>Ctrl</Kbd>+<Kbd>Enter</Kbd>
          </Text>
          <Button variant="primary" isDisabled={!dirty || !valid} onPress={save}>
            Save changes
          </Button>
        </span>
      </div>
      <ConfirmDialog
        open={Boolean(guard)}
        onOpenChange={(o) => !o && setGuard(null)}
        title="Discard unsaved changes?"
        description={`Edits to ${item.item_id} have not been saved.`}
        confirmLabel="Discard"
        tone="danger"
        onConfirm={() => {
          const fn = guard;
          setGuard(null);
          fn?.();
        }}
      />
    </aside>
  );
}

function DatasetScreen({ editorOpen }: { editorOpen: boolean }) {
  const which = useMockDataset();
  const ds = which === 'private' ? privateDataset : dataset;
  const active = which === 'private' ? productionVersion : draftVersion;
  const s = useItemsState();
  const [tab, setTab] = useState('items');
  const [currentId, setCurrentId] = useState<number | null>(editorOpen ? 1004 : null);
  const current = s.visible.find((r) => r.id === currentId) ?? null;
  const idx = current ? s.visible.indexOf(current) : -1;
  const move = (d: number) => {
    const next = s.visible[Math.max(0, Math.min(s.visible.length - 1, idx + d))];
    if (next) setCurrentId(next.id);
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) {
        if (e.key === 'Escape') t.blur();
        return;
      }
      if (e.key === 'j') move(1);
      else if (e.key === 'k') move(-1);
      else if (e.key === 'Escape') setCurrentId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const columns = useMemo(
    () =>
      itemColumns({
        compact: true,
        indexCell: (r) => (
          <button type="button" className={styles.openBtn} aria-label={`Open item ${r.item_id} in the editor`} aria-current={r.id === currentId ? 'true' : undefined} onClick={() => setCurrentId(r.id)}>
            {r.index}
            {r.id === currentId ? <Icon name="edit" size={12} /> : null}
          </button>
        ),
        actions: (r) => (
          <DropdownMenu
            label={`Actions for ${r.item_id}`}
            trigger={<IconButton label={`Actions for ${r.item_id}`} icon="more" />}
            onAction={() => undefined}
            items={[
              { id: 'open', label: 'Open item page' },
              { id: 'copy', label: 'Copy as JSON' },
              { id: 'delete', label: 'Delete', tone: 'danger', separatorBefore: true },
            ]}
          />
        ),
      }),
    [currentId],
  );
  return (
    <div className={shared.page}>
      <DatasetHero dataset={ds} active={active} tab={tab} onTab={setTab} />
      {!ds.items_visible ? (
        <PrivateLocked />
      ) : (
        <div className={current ? styles.split : undefined}>
          <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-sm)' }}>
            <ItemsToolbar
              s={s}
              hint={
                <Text variant="sm" tone="muted">
                  Click <Kbd>#</Kbd> or press <Kbd>Enter</Kbd> on a row to edit · <Kbd>j</Kbd>/<Kbd>k</Kbd> move
                </Text>
              }
            />
            <DataTable<Item>
              aria-label="Dataset items"
              className={styles.table}
              storageKey="datasets.items.v2"
              rows={s.visible}
              rowKey={(r) => r.id}
              columns={columns}
              hiddenColumns={current ? ['metadata', 'latency', 'runs'] : undefined}
              selection={{ selected: s.selected, onChange: s.setSelected }}
              onRowAction={(k) => setCurrentId(Number(k))}
              sort={{ key: 'index', direction: 'asc' }}
              onSortChange={() => undefined}
            />
            <AddItemFooter />
            <Pagination total={s.total} page={0} pageSize={50} pageSizeOptions={[25, 50, 100, 250]} noun="items" onPageChange={() => undefined} onPageSizeChange={() => undefined} />
          </div>
          {current ? (
            <ItemPane
              key={current.id}
              item={current}
              onPrev={() => move(-1)}
              onNext={() => move(1)}
              onClose={() => setCurrentId(null)}
              onSave={(p) => s.save(current.id, p)}
              initialExpected={editorOpen && current.id === 1004 ? { mode: 'json', text: '42' } : undefined}
            />
          ) : null}
        </div>
      )}
      <ItemsBulkDialogs s={s} />
    </div>
  );
}

/* ---------------- reviews: compact rows + detail pane ---------------- */

function ReviewsScreen() {
  const s = useReviewState();
  const searchRef = useRef<HTMLInputElement | null>(null);
  useTriageKeys(s, searchRef);
  const [filters, setFilters] = useState<FilterState>({ ...emptyFilters, source: 'corrected', confMax: 90 });
  const [sort, setSort] = useState<Key | null>('oldest');
  const chips = activeFilterChips(filters);
  const cur = s.current;
  const rowRefs = useRef(new Map<number, HTMLDivElement>());
  useEffect(() => {
    if (cur) rowRefs.current.get(cur.id)?.scrollIntoView({ block: 'nearest' });
  }, [cur]);
  const allVisibleSelected = s.visible.length > 0 && s.visible.every((r) => s.selected.has(r.id));
  return (
    <div className={shared.page}>
      <PageHeader
        title="Reviews"
        description="Validate corrections before they become examples for future auto-analysis."
        meta={[<QueueLine key="q" s={s} />]}
        actions={
          <IconButton label="Keyboard shortcuts (?)" icon={<Text variant="md" weight={600}>?</Text>} onPress={() => s.setHelp(true)} />
        }
        tabs={<StatusTabs s={s} variant="underline" />}
      />
      <div className={shared.toolbar}>
        <Checkbox
          aria-label="Select all visible"
          isSelected={allVisibleSelected}
          isIndeterminate={!allVisibleSelected && s.selected.size > 0}
          onChange={(v) => s.setSelected(v ? new Set(s.visible.map((r) => r.id)) : new Set())}
        />
        <SearchField ref={searchRef} label="Search corrections" placeholder="Search task, item, root cause… ( / )" width={280} />
        <Select label="Sort" hideLabel value={sort} onChange={setSort} width={150} items={[{ key: 'oldest', label: 'Oldest first' }, { key: 'confidence', label: 'Lowest confidence' }, { key: 'newest', label: 'Most recent' }]} />
        <Popover
          label="Filters"
          placement="bottom start"
          trigger={
            <Button icon={<Icon name="list" size={12} />} iconEnd={chips.length ? <Tag kind="count">{chips.length}</Tag> : undefined}>
              Filters
            </Button>
          }
        >
          <FacetFilters f={filters} onChange={setFilters} />
        </Popover>
        <span className={styles.filterChips}>
          {chips.map((c) => (
            <Chip key={c.key} isSelected onRemove={() => setFilters(c.key === 'source' ? { ...filters, source: 'all' } : c.key === 'conf' ? { ...filters, confMin: 0, confMax: 100 } : filters)}>
              {c.label}
            </Chip>
          ))}
          {chips.length ? (
            <Button variant="ghost" size="sm" onPress={() => setFilters(emptyFilters)}>
              Clear filters
            </Button>
          ) : null}
        </span>
        <BulkBar s={s} />
        <span className={shared.toolbarEnd}>
          <span className={shared.count} aria-live="polite">
            {s.visible.length} corrections
          </span>
        </span>
      </div>
      <div className={styles.reviewsSplit}>
        <div className={styles.rows} role="list" aria-label="Corrections">
          {s.visible.map((row) => {
            const first = row.human_root_cause_issues[0];
            return (
              <div
                key={row.id}
                role="listitem"
                tabIndex={0}
                ref={(el) => {
                  if (el) rowRefs.current.set(row.id, el);
                }}
                className={styles.row}
                aria-current={cur?.id === row.id ? 'true' : undefined}
                onClick={() => s.setCurrentId(row.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    s.setCurrentId(row.id);
                    s.toggleExpanded(row.id);
                  }
                }}
              >
                <Checkbox aria-label={`Select #${row.id}`} isSelected={s.selected.has(row.id)} onChange={() => s.toggleSelected(row.id)} />
                <span className={styles.rowId}>#{row.id}</span>
                <span className={styles.rowMain}>
                  <span className={styles.rowTop}>
                    <span className={styles.rowItem}>{row.item_id}</span>
                    <PriorityTag row={row} />
                    {s.tab === 'all' ? <StatusBadge row={row} /> : null}
                    {row.self_reviewed ? <Tag tone="info">Self-approved</Tag> : null}
                    <span className={styles.rowMeta}>
                      {row.dataset} · {row.model} · {row.task}
                    </span>
                  </span>
                  <span className={styles.rowFinding}>
                    {first ? (
                      <>
                        <strong>{first.category}</strong>
                        {first.subcategory ? ` · ${first.subcategory}` : ''} — {first.finding}
                      </>
                    ) : (
                      '—'
                    )}
                    {row.human_root_cause_issues.length > 1 ? ` (+${row.human_root_cause_issues.length - 1})` : ''}
                  </span>
                </span>
                <span className={styles.rowEnd} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()} role="presentation">
                  <Tag kind="count">{row.ai_confidence == null ? '—' : `${Math.round(row.ai_confidence * 100)}%`}</Tag>
                  <DecisionButtons row={row} s={s} compact />
                </span>
              </div>
            );
          })}
          {!s.visible.length ? (
            <div style={{ padding: 'var(--space-lg)' }}>
              <Text tone="muted">Nothing to review in this tab.</Text>
            </div>
          ) : null}
        </div>
        {cur ? (
          <section className={styles.detail} aria-label={`Correction #${cur.id}`}>
            <div className={styles.detailHead}>
              <Text variant="lg" mono>
                #{cur.id}
              </Text>
              <Text variant="base" mono tone="muted">
                {cur.item_id}
              </Text>
              <StatusBadge row={cur} />
              <PriorityTag row={cur} />
              <span className={styles.detailHeadEnd}>
                <span className={styles.by}>by {cur.corrected_by?.display_name} · 2026-10-11 19:18</span>
                <DecisionButtons row={cur} s={s} />
                <IconButton label={s.expanded.has(cur.id) ? 'Hide details (o)' : 'Show details (o)'} icon={s.expanded.has(cur.id) ? 'collapse' : 'expand'} onPress={() => s.toggleExpanded(cur.id)} />
              </span>
            </div>
            <ContextChips row={cur} />
            {s.editing === cur.id ? <EditForm row={cur} s={s} /> : <IssueColumns row={cur} />}
            <ReviewedLine row={cur} />
            {s.expanded.has(cur.id) ? <CardDetail row={cur} /> : <Previews row={cur} />}
          </section>
        ) : null}
      </div>
      <CommentDialog s={s} viewLabel="To review" />
      <ConflictDialog s={s} />
      <ShortcutsDialog s={s} />
    </div>
  );
}

export default function Mock() {
  const [view] = useMockView();
  const which = useMockDataset();
  const crumbs: ReactNode[] = view === 'trash' ? ['Deleted runs'] : view === 'reviews' ? ['Acme Support', 'Reviews'] : ['Acme Support', 'Datasets', which === 'private' ? 'Hidden eval set' : 'Support QA'];
  return (
    <MockFrame
      variant="pane"
      crumbs={crumbs}
      note={
        <span>
          Variant <strong>pane</strong>: items table + docked editor pane (j/k, Enter, Esc, Ctrl+Enter saves); reviews as 56 px rows + detail pane (j k a r e o x / ? Shift+A). Dataset states:{' '}
          <a href="?view=dataset">draft v3</a> · <a href="?view=dataset&ds=private">private test set (locked)</a> · <a href="?view=item">editor with string → number</a>. The first bulk action simulates a 409.
        </span>
      }
    >
      {view === 'reviews' ? <ReviewsScreen /> : view === 'trash' ? <div className={shared.page}><TrashView /></div> : <DatasetScreen editorOpen={view === 'item'} />}
    </MockFrame>
  );
}
