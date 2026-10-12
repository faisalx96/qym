/**
 * Copied from ui/run-detail 771663e (frontend/src/features/run-detail/components/traces/TraceDrawer.tsx).
 * Only change: the run id and the Langfuse host/project come in as props instead of useRunPage(),
 * and the sibling imports point at the run-detail files (copied verbatim next to this branch).
 */
/** Trace drawer: virtualized span tree with waterfall, retries merged, keyboard model, detail tabs, Langfuse link (brief 04 J6, §3k). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useItemTraceQuery } from '@/api/runs';
import { Chip, CopyButton, Drawer, ErrorState, Icon, LinkButton, Skeleton, Tag, Text } from '@/ui';
import {
  aggregateStats,
  buildLangfuseTraceUrl,
  computeBounds,
  failingSpan,
  flattenTree,
  formatCost,
  formatDuration,
  normalizeTrace,
  searchVisible,
  spanKind,
  spanModel,
  spanTokens,
  statusClass,
  type SpanNode,
  type SpanTree,
  type TraceBounds,
} from '@/features/run-detail/lib/traceTree';
import { KIND_GLYPH, KIND_LABEL, KIND_TONE } from '@/features/run-detail/components/traces/spanKinds';
import { SpanDetail } from '@/features/run-detail/components/traces/SpanDetail';
import styles from '@/features/run-detail/components/traces/TraceDrawer.module.css';

const ROW = 34;
interface TraceSummaryLite {
  span_count?: number;
  duration_ms?: number | null;
  error_count?: number;
}
const EXPAND_ALL_LIMIT = 400;

interface VisibleRow {
  node: SpanNode;
  hasChildren: boolean;
  open: boolean;
}

function visibleRows(tree: SpanTree, expanded: Set<string>, matches: Set<string> | null): VisibleRow[] {
  const out: VisibleRow[] = [];
  const walk = (node: SpanNode) => {
    if (matches && !matches.has(node.span_id)) return;
    const kids = node._children;
    const hasChildren = kids.length > 0;
    const open = hasChildren && (matches ? true : expanded.has(node.span_id));
    out.push({ node, hasChildren, open });
    if (open) kids.forEach(walk);
  };
  tree.roots.forEach(walk);
  return out;
}

function initialExpanded(tree: SpanTree): Set<string> {
  const nodes = flattenTree(tree.roots);
  if (nodes.length <= EXPAND_ALL_LIMIT)
    return new Set(nodes.filter((n) => n._children.length).map((n) => n.span_id));
  return new Set(nodes.filter((n) => n._children.length && n._depth < 2).map((n) => n.span_id));
}

function Row({
  row,
  bounds,
  selected,
  onSelect,
  onToggle,
}: {
  row: VisibleRow;
  bounds: TraceBounds;
  selected: boolean;
  onSelect: () => void;
  onToggle: () => void;
}) {
  const { node } = row;
  const kind = spanKind(node);
  const err = statusClass(node.status) === 'error';
  const start =
    node.start_time_ns == null || bounds.start == null
      ? 0
      : ((Number(node.start_time_ns) - bounds.start) / bounds.total) * 100;
  const width =
    node.duration_ms == null ? 0.5 : Math.max(0.5, ((node.duration_ms * 1e6) / bounds.total) * 100);
  const tokens = spanTokens(node);
  const model = spanModel(node);
  return (
    <div
      role="treeitem"
      id={`span-${node.span_id}`}
      aria-selected={selected}
      aria-level={node._depth + 1}
      aria-expanded={row.hasChildren ? row.open : undefined}
      tabIndex={-1}
      className={styles.row}
      data-selected={selected || undefined}
      data-error={err || undefined}
      data-failed={node._failed || undefined}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <span
        className={styles.rowMain}
        style={{ paddingInlineStart: `calc(${node._depth} * var(--space-md))` }}
      >
        {row.hasChildren ? (
          <button
            type="button"
            tabIndex={-1}
            className={styles.toggle}
            aria-label={row.open ? `Collapse ${node.name}` : `Expand ${node.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
          >
            <Icon name={row.open ? 'chevron-down' : 'chevron-right'} size={12} />
          </button>
        ) : (
          <span className={styles.toggle} aria-hidden="true" />
        )}
        <span
          className={styles.glyph}
          style={{ background: KIND_TONE[kind] }}
          title={KIND_LABEL[kind]}
          aria-hidden="true"
        >
          {KIND_GLYPH[kind]}
        </span>
        <span className={styles.name} title={node.name}>
          {node.name}
        </span>
        {node._try ? (
          <Tag kind="count">try {node._try}</Tag>
        ) : node._attemptNumber && node._failed ? (
          <Tag kind="count">try {node._attemptNumber}</Tag>
        ) : null}
        {model ? <span className={styles.sub}>{model}</span> : null}
        {tokens ? <span className={styles.sub}>{tokens.toLocaleString('en-US')} tok</span> : null}
        {err ? <Tag tone="danger">error</Tag> : null}
      </span>
      <span className={styles.dur}>{formatDuration(node.duration_ms)}</span>
      <span className={styles.bar} aria-hidden="true">
        <span
          className={styles.barFill}
          style={{
            insetInlineStart: `${Math.min(100, start)}%`,
            width: `${Math.min(100 - Math.min(100, start), width)}%`,
            background: err ? 'var(--error)' : KIND_TONE[kind],
          }}
        />
      </span>
    </div>
  );
}

export function TraceDrawer({
  runId,
  itemId,
  pass,
  langfuseHost,
  langfuseProjectId,
  onClose,
}: {
  /** The run (base id) whose item trace is read. */
  runId: string;
  itemId: string;
  pass: number | null;
  langfuseHost?: string | null;
  langfuseProjectId?: string | null;
  onClose: () => void;
}) {
  const query = useItemTraceQuery(runId, itemId, pass);
  const norm = useMemo(() => (query.data ? normalizeTrace(query.data) : null), [query.data]);
  const [attempt, setAttempt] = useState<'combined' | number>('combined');
  const [search, setSearch] = useState('');
  const [expandedBy, setExpandedBy] = useState<Record<string, Set<string>>>({});
  const [selectedBy, setSelectedBy] = useState<Record<string, string>>({});
  const searchRef = useRef<HTMLInputElement>(null);
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

  const active = useMemo(() => {
    if (!norm) return null;
    if (attempt === 'combined' && norm.combined)
      return {
        key: 'combined',
        tree: norm.combined as SpanTree,
        bounds: norm.combined.bounds,
        summary: norm.combined.summary as TraceSummaryLite,
      };
    const a = typeof attempt === 'number' ? norm.attempts.find((x) => x.attempt_number === attempt) : null;
    const pick = a ?? norm.lastAttempt;
    return {
      key: `a${pick.attempt_number}`,
      tree: pick.tree,
      bounds: computeBounds(pick.summary, pick.spans),
      summary: (pick.summary ?? {}) as TraceSummaryLite,
    };
  }, [norm, attempt]);

  const key = active?.key ?? '';
  const expanded = useMemo(
    () => (active ? (expandedBy[key] ?? initialExpanded(active.tree)) : new Set<string>()),
    [active, expandedBy, key],
  );
  const matches = useMemo(() => (active ? searchVisible(active.tree, search) : null), [active, search]);
  const rows = useMemo(
    () => (active ? visibleRows(active.tree, expanded, matches) : []),
    [active, expanded, matches],
  );
  const defaultSelected = useMemo(() => {
    if (!active) return null;
    const failing = failingSpan(active.tree);
    return failing?.span_id ?? active.tree.roots[0]?.span_id ?? null;
  }, [active]);
  const selectedId = selectedBy[key] ?? defaultSelected;
  const selectedNode = selectedId && active ? (active.tree.byId.get(selectedId) ?? null) : null;
  const selectedIndex = rows.findIndex((r) => r.node.span_id === selectedId);

  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller,
    estimateSize: () => ROW,
    overscan: 10,
    getItemKey: (i) => rows[i]?.node.span_id ?? i,
  });

  const select = (id: string) => setSelectedBy((s) => ({ ...s, [key]: id }));
  const setOpen = (id: string, on: boolean) =>
    setExpandedBy((s) => {
      const next = new Set(expanded);
      if (on) next.add(id);
      else next.delete(id);
      return { ...s, [key]: next };
    });
  const move = (delta: number) => {
    const target =
      rows[Math.max(0, Math.min(rows.length - 1, (selectedIndex < 0 ? 0 : selectedIndex) + delta))];
    if (!target) return;
    select(target.node.span_id);
    virtualizer.scrollToIndex(rows.indexOf(target), { align: 'auto' });
  };
  const onTreeKey = (e: React.KeyboardEvent) => {
    const current = rows[selectedIndex];
    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter' || e.key === 'ArrowRight') {
      if (current?.hasChildren) {
        e.preventDefault();
        if (!current.open) setOpen(current.node.span_id, true);
        else if (e.key === 'ArrowRight') move(1);
      }
    } else if (e.key === 'ArrowLeft') {
      if (current?.open) {
        e.preventDefault();
        setOpen(current.node.span_id, false);
      } else if (current?.node.parent_span_id) {
        const parent = rows.find(
          (r) => r.node.span_id === (current.node._groupParent?.span_id ?? current.node.parent_span_id),
        );
        if (parent) {
          e.preventDefault();
          select(parent.node.span_id);
          virtualizer.scrollToIndex(rows.indexOf(parent), { align: 'auto' });
        }
      }
    } else if (e.key === '/') {
      e.preventDefault();
      searchRef.current?.focus();
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const stats = active ? aggregateStats(active.tree.nodes) : null;
  const langfuse =
    norm?.item.trace_url || buildLangfuseTraceUrl(langfuseHost, langfuseProjectId, norm?.item.trace_id);
  const errors = active?.summary.error_count ?? 0;
  const header =
    norm && active ? (
      <div className={styles.chips} aria-label="Trace summary">
        <Tag kind="data">{active.summary.span_count ?? active.tree.nodes.length} spans</Tag>
        <Tag kind="data">{formatDuration(active.summary.duration_ms)}</Tag>
        {stats?.totalTokens ? (
          <Tag kind="data">{stats.totalTokens.toLocaleString('en-US')} tokens</Tag>
        ) : null}
        {stats && formatCost(stats.totalCost) ? <Tag kind="data">{formatCost(stats.totalCost)}</Tag> : null}
        {norm.attempts.length > 1 ? (
          <Tag kind="data" tone="warning">
            {norm.attempts.length} attempts ·{' '}
            {
              norm.attempts.filter((a) =>
                ['failed', 'error', 'timeout'].includes(String(a.status).toLowerCase()),
              ).length
            }{' '}
            failed
          </Tag>
        ) : null}
        {errors ? <Tag tone="danger">{errors} errors</Tag> : null}
        {query.data?.summary?.has_orphans ? (
          <Tag tone="warning">{query.data.summary.orphan_count ?? ''} orphan spans</Tag>
        ) : null}
      </div>
    ) : null;

  return (
    <Drawer
      open
      onOpenChange={(o) => !o && onClose()}
      title="Trace"
      subtitle={norm?.item.trace_id ? `${itemId} · ${norm.item.trace_id}` : itemId}
      width={Math.min(1040, typeof window === 'undefined' ? 1040 : window.innerWidth)}
      actions={
        <span className={styles.actions}>
          {langfuse ? (
            <LinkButton
              size="sm"
              variant="neutral"
              href={langfuse}
              target="_blank"
              rel="noopener noreferrer"
              icon={<Icon name="external" size={12} />}
            >
              Open in Langfuse
            </LinkButton>
          ) : null}
          {norm?.item.trace_id ? <CopyButton text={norm.item.trace_id} label="Copy trace id" /> : null}
        </span>
      }
    >
      <div className={styles.body} data-testid="trace-drawer">
        {query.isPending ? <Skeleton kind="lines" rows={6} label="Loading trace" /> : null}
        {query.isError ? (
          <ErrorState
            error={query.error}
            title="Failed to load the trace"
            notFoundMessage="No trace was recorded for this item."
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {norm && active ? (
          <>
            {header}
            {norm.attempts.length > 1 ? (
              <div className={styles.attempts} role="group" aria-label="Attempts">
                <Chip isSelected={attempt === 'combined'} onChange={() => setAttempt('combined')}>
                  All attempts
                </Chip>
                {norm.attempts.map((a) => (
                  <Chip
                    key={a.attempt_number}
                    isSelected={attempt === a.attempt_number}
                    onChange={() => setAttempt(a.attempt_number)}
                  >
                    Attempt {a.attempt_number}
                    {['failed', 'error', 'timeout'].includes(String(a.status).toLowerCase())
                      ? ' · failed'
                      : ''}
                  </Chip>
                ))}
              </div>
            ) : null}
            <div className={styles.split}>
              <section className={styles.treePane} aria-label="Spans">
                <div className={styles.treeTools}>
                  <label className={styles.search}>
                    <span className={styles.srOnly}>Filter spans</span>
                    <input
                      ref={searchRef}
                      type="search"
                      className={styles.searchInput}
                      placeholder="Filter spans… (/)"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape' && search) {
                          e.stopPropagation();
                          setSearch('');
                        } else if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          scroller?.focus();
                        }
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.tool}
                    onClick={() =>
                      setExpandedBy((s) => ({
                        ...s,
                        [key]: new Set(
                          flattenTree(active.tree.roots)
                            .filter((n) => n._children.length)
                            .map((n) => n.span_id),
                        ),
                      }))
                    }
                  >
                    Expand all
                  </button>
                  <button
                    type="button"
                    className={styles.tool}
                    onClick={() => setExpandedBy((s) => ({ ...s, [key]: new Set() }))}
                  >
                    Collapse all
                  </button>
                </div>
                <div
                  ref={setScroller}
                  className={styles.tree}
                  role="tree"
                  aria-label="Span tree"
                  tabIndex={0}
                  aria-activedescendant={selectedId ? `span-${selectedId}` : undefined}
                  onKeyDown={onTreeKey}
                >
                  <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                    {virtualizer.getVirtualItems().map((v) => {
                      const row = rows[v.index]!;
                      return (
                        <div
                          key={v.key}
                          className={styles.vrow}
                          style={{ height: ROW, transform: `translateY(${v.start}px)` }}
                        >
                          <Row
                            row={row}
                            bounds={active.bounds}
                            selected={row.node.span_id === selectedId}
                            onSelect={() => select(row.node.span_id)}
                            onToggle={() => setOpen(row.node.span_id, !row.open)}
                          />
                        </div>
                      );
                    })}
                  </div>
                  {rows.length === 0 ? (
                    <Text variant="sm" tone="muted">
                      No spans match.
                    </Text>
                  ) : null}
                </div>
              </section>
              <section className={styles.detailPane} aria-label="Span details">
                {selectedNode ? (
                  <SpanDetail key={selectedNode.span_id} node={selectedNode} />
                ) : (
                  <Text variant="sm" tone="muted">
                    Select a span.
                  </Text>
                )}
              </section>
            </div>
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
