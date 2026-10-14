/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/mouse-events-have-key-events, jsx-a11y/click-events-have-key-events --
   This is the grid widget: rows are roving-focus stops with the key handler delegated on <tbody>,
   the scroller is a keyboard-scrollable region, and the overflow title is a progressive hint. */
import {
  Children,
  Fragment,
  isValidElement,
  useCallback,
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { Button as AriaButton } from 'react-aria-components';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useInRouterContext, useNavigate } from 'react-router-dom';
import { Checkbox } from '../Checkbox';
import { DropdownMenu, type MenuItemSpec } from '../DropdownMenu';
import { EmptyState } from '../EmptyState';
import { ErrorState } from '../ErrorState';
import { Icon, type IconName } from '../Icon';
import { Tooltip } from '../Tooltip';
import { IconButton } from '../IconButton';
import { Button } from '../Button';
import { EnterContext, ENTER_MS } from '../motion';
import { DataTableContext } from './context';
import {
  alignOf,
  buildDisplayRows,
  effectivePin,
  groupBands,
  headerMinWidth,
  headerOf,
  headerText,
  isMono,
  middleTruncate,
  nextSort,
  pinOffsets,
  rangeKeys,
  sortKeyOf,
  sortRows,
  suspendedPins,
  FLEX_MIN_WIDTH,
} from './model';
import { Footer, SelectionBar, Toolbar } from './parts';
import { ScoreBar } from './cells';
import { RelativeTime, DurationCell, NumberCell } from './cells';
import { useDataTableModel, type DataTableModel } from './useDataTableModel';
import { useStickyShift } from './useStickyShift';
import type {
  CellCtx,
  Column,
  Density,
  DisplayRow,
  GroupByConfig,
  Key,
  RowAction,
  RowStateKind,
  SelectionConfig,
  SortState,
} from './types';
import styles from './DataTable.module.css';

export type { Column, Density, SortState, RowAction, CellType, CellCtx, Key } from './types';

export interface DataTableProps<R> {
  'aria-label': string;
  columns: Column<R>[];
  rows: R[];
  rowKey: (row: R) => Key;
  storageKey?: string;
  /** Per-user layout: saved under `<storageKey>:<storageScope>` (the user id). */
  storageScope?: string;
  /** Columns menu lists drag handles and freeze toggles; header menu gains Freeze / Move. */
  reorderable?: boolean;
  /** Largest share of the scroller the frozen (pinned-start) block may take; the rest scroll. Default 0.5. */
  maxPinShare?: number;
  /** Called with the hidden column ids whenever they change (and once on mount). */
  onHiddenChange?: (hidden: Set<string>) => void;
  className?: string;

  density?: Density;
  /** The page fixes the density; hides the density menu. */
  densityLocked?: boolean;
  zebra?: boolean | 'auto';
  variant?: 'card' | 'embedded';
  stickyHeader?: boolean;
  /**
   * The page scroller the header should stick to (a table that is not height-capped). The header cells
   * are translated to stay below `stickyTop` (px, or a function measuring the bars above the table).
   */
  stickyParent?: HTMLElement | null;
  stickyTop?: number | (() => number);
  scrollCues?: boolean;
  minWidth?: number;
  /** Header kebab menu (sort, pin, hide, autosize). Default on, off for embedded. */
  columnMenu?: boolean;

  /** true = skeleton rows; 'quiet' = empty body while a delayed skeleton has not appeared yet. */
  loading?: boolean | 'quiet';
  refreshing?: boolean;
  error?: unknown;
  onRetry?: () => void;
  errorTitle?: string;
  empty?: ReactNode;
  filteredEmpty?: ReactNode;
  isFiltered?: boolean;

  sort?: SortState | null;
  onSortChange?(sort: SortState | null): void;
  /** Click cycle ends in "unsorted". Default: true when the table sorts itself. */
  allowUnsorted?: boolean;

  rowHref?: (row: R) => string | undefined;
  onRowOpen?: (row: R) => void;
  rowState?: (row: R) => RowStateKind | undefined;
  rowActions?: (row: R) => RowAction<R>[];
  /** Extra attributes for a row (test ids, data attributes). */
  rowProps?: (row: R) => Record<string, string | undefined>;
  /** Extra class on a row (feature highlights); keep it to outlines and rails. */
  rowClassName?: (row: R) => string | undefined;

  selection?: SelectionConfig<R>;
  bulkActions?: ReactNode;
  /** `bulkActions` already show their own count and Clear (the runs list counts executions). */
  bulkOwnSummary?: boolean;
  /** Show the bulk cluster even with nothing selected (select mode, cohort picking). */
  bulkAlways?: boolean;
  /** Accessible name of a row's checkbox (default "Select row"). */
  rowLabel?: (row: R) => string;
  /** Accessible name of the header checkbox (default "Select all rows"). */
  selectAllLabel?: string;
  /** A row click toggles selection (select mode on the runs list). */
  selectOnRowClick?: boolean;

  renderExpanded?: (row: R) => ReactNode;
  expanded?: Set<Key>;
  onExpandedChange?: (keys: Set<Key>) => void;
  expandOnRowClick?: boolean;
  /** Accessible name of a row's expand button (default "Expand row" / "Collapse row"). */
  expandLabel?: (row: R, open: boolean) => string;
  /** Render the leading chevron column (default true); false when a cell hosts its own toggle. */
  expandColumn?: boolean;
  /** Rows that cannot expand (no chevron). */
  canExpand?: (row: R) => boolean;

  groupBy?: GroupByConfig<R>;

  responsive?: 'scroll' | 'cards';

  /**
   * Window the rows (spacer rows above and below). `true` or an object turns it on; by default it is on
   * above 200 display rows. `scrollParent` = an ancestor that scrolls the page (e.g. the shell content)
   * instead of the table's own scroller.
   */
  virtualize?:
    | boolean
    | {
        estimateRowHeight?: number;
        overscan?: number;
        scrollParent?: HTMLElement | null;
        /** Height that sticks above the table (bars) so scrolled-to rows land below it. */
        scrollPaddingStart?: number;
      };
  /** Bring this row into view (deep links); `onScrolledToKey` fires once it has landed. */
  scrollToKey?: Key | null;
  onScrolledToKey?: () => void;

  /** Group collapse driven from outside (Expand all / Collapse all). */
  groupCollapsed?: Set<string>;
  onGroupCollapsedChange?: (keys: Set<string>) => void;

  /** Roving focus, controlled (runs list keeps its own cursor). */
  focusedKey?: Key | null;
  onFocusedKeyChange?: (key: Key | null) => void;

  children?: ReactNode;
}

type PseudoColumn = Column<never> & { pseudo: 'select' | 'expand' | 'actions' };

const OpenHref = createContext<(href: string) => void>((href) => window.location.assign(href));

function RouterOpen({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const open = useCallback((href: string) => navigate(href), [navigate]);
  return <OpenHref.Provider value={open}>{children}</OpenHref.Provider>;
}

function useMedia(query: string): boolean {
  const get = () =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false;
  const [m, setM] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const on = () => setM(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return m;
}

const VIRTUAL_AFTER = 200;
const VIRTUAL_FALLBACK = 30;

const INTERACTIVE =
  'a, button, input, label, select, textarea, [role="button"], [role="checkbox"], [role="menuitem"]';

function defaultCell<R>(col: Column<R>, row: R): ReactNode {
  const raw = col.accessor ? col.accessor(row) : (row as Record<string, unknown>)[col.id];
  if (raw === null || raw === undefined || raw === '') return col.type === 'text' || !col.type ? '' : '—';
  switch (col.type) {
    case 'number':
      return typeof raw === 'number' ? <NumberCell value={raw} /> : String(raw);
    case 'duration':
      return typeof raw === 'number' ? <DurationCell ms={raw} /> : String(raw);
    case 'score':
      return typeof raw === 'number' ? <ScoreBar value={raw} /> : String(raw);
    case 'date':
      return <RelativeTime iso={String(raw)} />;
    case 'id':
      return col.truncate === 'middle' ? middleTruncate(String(raw)) : String(raw);
    default:
      return typeof raw === 'object' ? JSON.stringify(raw) : String(raw);
  }
}

/**
 * DataTable v2: own `<table>` markup (see docs/internal/ui-migration/redesign/tables.md §Decisions).
 * Typed columns, density, zebra, column bands, pinned columns, header menu,
 * selection + bulk bar, expansion, grouping, row actions, states, scroll cues
 * and a card layout on narrow screens. Plain by default: a three-column list
 * is just a header and rows.
 */
export function DataTable<R>(props: DataTableProps<R>) {
  const inRouter = useInRouterContext();
  const body = <DataTableInner {...props} />;
  return inRouter ? <RouterOpen>{body}</RouterOpen> : body;
}
DataTable.Toolbar = Toolbar;
DataTable.Footer = Footer;

function DataTableInner<R>({
  columns,
  rows,
  rowKey,
  storageKey,
  storageScope,
  reorderable,
  maxPinShare = 0.5,
  onHiddenChange,
  className,
  density: densityProp,
  densityLocked,
  zebra = 'auto',
  variant = 'card',
  stickyHeader = true,
  stickyParent,
  stickyTop,
  scrollCues = true,
  minWidth,
  columnMenu,
  loading,
  refreshing,
  error,
  onRetry,
  errorTitle,
  empty,
  filteredEmpty,
  isFiltered,
  sort: sortProp,
  onSortChange,
  allowUnsorted,
  rowHref,
  onRowOpen,
  rowState,
  rowActions,
  rowProps,
  rowClassName,
  selection,
  bulkActions,
  bulkOwnSummary,
  bulkAlways,
  rowLabel,
  selectAllLabel = 'Select all rows',
  selectOnRowClick,
  renderExpanded,
  expanded: expandedProp,
  onExpandedChange,
  expandOnRowClick,
  expandLabel,
  expandColumn = true,
  canExpand,
  groupBy,
  responsive = 'cards',
  virtualize,
  scrollToKey,
  onScrolledToKey,
  groupCollapsed,
  onGroupCollapsedChange,
  focusedKey: focusedProp,
  onFocusedKeyChange,
  children,
  ...rest
}: DataTableProps<R>) {
  const embedded = variant === 'embedded';
  const model = useDataTableModel({
    columns,
    storageKey,
    storageScope,
    density: densityProp ?? (embedded ? 'compact' : 'regular'),
    densityLocked: densityLocked || embedded,
  });
  const openHref = useContext(OpenHref);
  const tableRef = useRef<HTMLTableElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const uid = useId();

  /* sort: controlled when onSortChange is given, otherwise the table sorts itself */
  const [ownSort, setOwnSort] = useState<SortState | null>(null);
  const controlledSort = Boolean(onSortChange);
  const sort = controlledSort ? (sortProp ?? null) : (sortProp ?? ownSort);
  const sortable = (c: Column<R>) =>
    Boolean(sortKeyOf(c)) && (controlledSort || !!c.accessor || typeof c.sort === 'object' || !c.cell);
  const unsortedOk = allowUnsorted ?? !controlledSort;
  const setSort = (next: SortState | null) => {
    if (controlledSort) onSortChange?.(next);
    else setOwnSort(next);
  };
  const sortedRows = useMemo(
    () => (controlledSort ? rows : sortRows(rows, columns, sort)),
    [controlledSort, rows, columns, sort],
  );

  /* expansion */
  const [ownExpanded, setOwnExpanded] = useState<Set<Key>>(new Set());
  const expanded = expandedProp ?? ownExpanded;
  const setExpanded = (next: Set<Key>) => {
    if (onExpandedChange) onExpandedChange(next);
    if (!expandedProp) setOwnExpanded(next);
  };
  const rowCanExpand = (r: R) => Boolean(renderExpanded) && (canExpand ? canExpand(r) : true);
  const toggleExpanded = (r: R) => {
    if (!rowCanExpand(r)) return;
    const key = rowKey(r);
    const next = new Set(expanded);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpanded(next);
  };

  /* display rows */
  const collapsedGroups = useMemo(() => {
    if (groupCollapsed) return groupCollapsed;
    if (!groupBy?.defaultCollapsed) return model.collapsed;
    const all = new Set(sortedRows.map((r) => groupBy.key(r)));
    for (const k of model.collapsed) {
      if (all.has(k)) all.delete(k);
      else all.add(k);
    }
    return all;
  }, [groupBy, groupCollapsed, model.collapsed, sortedRows]);
  const toggleGroupKey = (key: string) => {
    if (groupCollapsed && onGroupCollapsedChange) {
      const next = new Set(groupCollapsed);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      onGroupCollapsedChange(next);
    } else model.toggleGroup(key);
  };
  const display = useMemo(
    () =>
      buildDisplayRows(sortedRows, rowKey, {
        groupBy,
        collapsed: collapsedGroups,
        expanded,
        canExpand: Boolean(renderExpanded),
      }),
    [sortedRows, rowKey, groupBy, collapsedGroups, expanded, renderExpanded],
  );
  const vcfg = typeof virtualize === 'object' ? virtualize : null;
  const virtual =
    virtualize === true || vcfg !== null || (virtualize === undefined && display.length > VIRTUAL_AFTER);
  const scrollParent = vcfg?.scrollParent ?? null;
  const [scrollMargin, setScrollMargin] = useState(0);
  const dataRows = display.filter((d): d is Extract<DisplayRow<R>, { kind: 'row' }> => d.kind === 'row');
  // Data marks (ScoreBar fills) grow in once, during the table's first paint of data; rows that scroll in
  // later (virtualised remounts), sort or page never replay the entrance.
  const [entering, setEntering] = useState(true);
  const hasDisplayRows = display.length > 0;
  useEffect(() => {
    if (!hasDisplayRows) return undefined;
    const id = window.setTimeout(() => setEntering(false), ENTER_MS);
    return () => window.clearTimeout(id);
  }, [hasDisplayRows]);
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    enabled: virtual,
    count: virtual ? display.length : 0,
    getScrollElement: () => scrollParent ?? scrollerRef.current,
    estimateSize: () => vcfg?.estimateRowHeight ?? 40,
    overscan: vcfg?.overscan ?? 8,
    scrollMargin,
    scrollPaddingStart: vcfg?.scrollPaddingStart ?? 0,
    getItemKey: (i) => display[i]?.id ?? i,
  });

  /* columns incl. pseudo columns */
  const multi = Boolean(selection) && (selection?.mode ?? 'multiple') === 'multiple';
  const actionsOf = rowActions;
  const leading: PseudoColumn[] = [];
  if (multi)
    leading.push({
      id: '__select',
      pseudo: 'select',
      width: 40,
      pin: 'start',
      resizable: false,
    } as PseudoColumn);
  if (renderExpanded && expandColumn)
    leading.push({
      id: '__expand',
      pseudo: 'expand',
      width: 32,
      pin: 'start',
      resizable: false,
    } as PseudoColumn);
  // Width follows the busiest row (icon buttons + one overflow button); no actions anywhere = no column.
  const actionSlots = actionsOf
    ? Math.max(
        0,
        ...rows.map((r) => {
          const a = actionsOf(r);
          const primary = a.filter((x) => x.primary).slice(0, 2).length;
          return primary + (a.length - primary > 0 ? 1 : 0);
        }),
      )
    : 0;
  const trailing: PseudoColumn[] =
    actionsOf && actionSlots > 0
      ? [
          {
            id: '__actions',
            pseudo: 'actions',
            width: 16 + 26 * actionSlots,
            pin: 'end',
            resizable: false,
            header: 'Actions',
            hideLabel: true,
          } as PseudoColumn,
        ]
      : [];
  const visible = model.visible;
  const hasExpander = Boolean(renderExpanded) && expandColumn;
  const hasActions = actionSlots;
  const renderCols = useMemo(
    () => [...(leading as unknown as Column<R>[]), ...visible, ...(trailing as unknown as Column<R>[])],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visible, multi, hasExpander, hasActions],
  );
  const pseudoOf = (c: Column<R>) => (c as unknown as PseudoColumn).pseudo;
  const hasBands = visible.some((c) => c.group);
  const tall = visible.some((c) => c.secondary || c.wrap);

  /* pin offsets from measured header widths */
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const [suspended, setSuspended] = useState<string[]>([]);
  const [scrollerWidth, setScrollerWidth] = useState(0);
  useLayoutEffect(() => {
    const table = tableRef.current;
    if (!table) return undefined;
    const measure = () => {
      const next: Record<string, number> = {};
      table.querySelectorAll<HTMLElement>('thead th[data-col]').forEach((th) => {
        next[th.dataset.col!] = th.getBoundingClientRect().width;
      });
      // Freeze cap: trailing frozen columns that would take more than `maxPinShare` of the scroller scroll instead.
      const sw = scrollerRef.current?.clientWidth ?? 0;
      setScrollerWidth((p) => (p === sw ? p : sw));
      const starts = renderCols.filter((c) => effectivePin(c, model.pins) === 'start');
      const lead = starts.filter((c) => (c as unknown as PseudoColumn).pseudo);
      const sus = suspendedPins(
        starts.filter((c) => !(c as unknown as PseudoColumn).pseudo).map((c) => c.id),
        (id) => next[id] ?? 0,
        sw,
        maxPinShare,
        lead.reduce((n, c) => n + (next[c.id] ?? 0), 0),
      );
      setSuspended((p) => (p.length === sus.length && p.every((id, i) => id === sus[i]) ? p : sus));
      setMeasured((prev) => {
        const keys = Object.keys(next);
        if (
          keys.length === Object.keys(prev).length &&
          keys.every((k) => Math.abs((prev[k] ?? -1) - next[k]!) < 0.5)
        )
          return prev;
        return next;
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(table);
    return () => ro.disconnect();
  }, [renderCols, model.widths, model.pins, model.density, maxPinShare]);
  const pins = useMemo(
    () =>
      suspended.length
        ? { ...model.pins, ...Object.fromEntries(suspended.map((id) => [id, null])) }
        : model.pins,
    [model.pins, suspended],
  );
  const offsets = useMemo(
    () =>
      pinOffsets(
        renderCols,
        (id) => measured[id] ?? model.widths[id] ?? renderCols.find((c) => c.id === id)?.width ?? 120,
        pins,
      ),
    [renderCols, measured, model.widths, pins],
  );
  const pinSum = (side: 'start' | 'end') =>
    renderCols.filter((c) => effectivePin(c, pins) === side).reduce((n, c) => n + (measured[c.id] ?? 0), 0);
  const lastStart = [...renderCols].reverse().find((c) => effectivePin(c, pins) === 'start')?.id;
  const firstEnd = renderCols.find((c) => effectivePin(c, pins) === 'end')?.id;

  /* scroll state */
  const [scrollX, setScrollX] = useState({ start: false, end: false, overflow: false });
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    const update = () => {
      const overflow = el.scrollWidth > el.clientWidth + 1;
      const abs = Math.abs(el.scrollLeft);
      setScrollX((p) => {
        const n = {
          overflow,
          start: overflow && abs > 1,
          end: overflow && abs + el.clientWidth < el.scrollWidth - 1,
        };
        return p.overflow === n.overflow && p.start === n.start && p.end === n.end ? p : n;
      });
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    if (typeof ResizeObserver === 'undefined') return () => el.removeEventListener('scroll', update);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (tableRef.current) ro.observe(tableRef.current);
    return () => {
      el.removeEventListener('scroll', update);
      ro.disconnect();
    };
  }, [renderCols, rows.length]);

  /* mirrored horizontal scrollbar rail */
  const railRef = useRef<HTMLDivElement>(null);
  const railInnerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const sc = scrollerRef.current;
    const rail = railRef.current;
    const inner = railInnerRef.current;
    if (!sc || !rail || !inner) return undefined;
    inner.style.width = `${sc.scrollWidth}px`;
    let lock = false;
    const fromScroller = () => {
      if (lock) return;
      lock = true;
      rail.scrollLeft = sc.scrollLeft;
      lock = false;
    };
    const fromRail = () => {
      if (lock) return;
      lock = true;
      sc.scrollLeft = rail.scrollLeft;
      lock = false;
    };
    sc.addEventListener('scroll', fromScroller, { passive: true });
    rail.addEventListener('scroll', fromRail, { passive: true });
    return () => {
      sc.removeEventListener('scroll', fromScroller);
      rail.removeEventListener('scroll', fromRail);
    };
  }, [scrollX.overflow, measured]);

  /* focus */
  const [ownFocus, setOwnFocus] = useState<Key | null>(null);
  const focusedKey = focusedProp !== undefined ? focusedProp : ownFocus;
  const setFocusedKey = (k: Key | null) => {
    onFocusedKeyChange?.(k);
    if (focusedProp === undefined) setOwnFocus(k);
  };

  // A controlled focus cursor moves DOM focus to its row (the page drives j/k across pages).
  useEffect(() => {
    if (focusedProp === undefined || focusedProp === null) return;
    const el = bodyRef.current?.querySelector<HTMLElement>(
      `tr[data-row-id="${CSS.escape(`${uid}:${String(focusedProp)}`)}"]`,
    );
    if (el && !el.contains(document.activeElement)) el.focus();
  }, [focusedProp, uid]);

  // Page-scroller sticky header: translate the header cells so they stay under the bars above the table.
  const headParent = stickyParent ?? vcfg?.scrollParent ?? null;
  useStickyShift({
    container: tableRef,
    head: (t) => (t as HTMLTableElement).tHead,
    parent: headParent,
    top: stickyTop ?? vcfg?.scrollPaddingStart ?? 0,
    enabled: stickyHeader && !embedded,
  });

  // Where the first body row starts inside the scrolling ancestor (react-virtual scrollMargin).
  useEffect(() => {
    if (!virtual) return undefined;
    const body = bodyRef.current;
    const parent = scrollParent ?? scrollerRef.current;
    if (!body || !parent) return undefined;
    const measure = () => {
      const top = body.getBoundingClientRect().top - parent.getBoundingClientRect().top + parent.scrollTop;
      setScrollMargin((prev) => (Math.abs(prev - top) > 1 ? top : prev));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(parent);
    for (let n: HTMLElement | null = body; n && n !== parent; n = n.parentElement) ro.observe(n);
    return () => ro.disconnect();
  }, [virtual, scrollParent]);

  // A requested row (deep link) is brought into view once; measured heights settle, so align twice.
  useEffect(() => {
    if (scrollToKey === null || scrollToKey === undefined) return undefined;
    const idx = display.findIndex((d) => d.kind === 'row' && d.key === scrollToKey);
    if (idx < 0) return undefined;
    const go = () => {
      if (virtual && bodyRef.current) virtualizer.scrollToIndex(idx, { align: 'start' });
      else
        cardRef.current
          ?.querySelector<HTMLElement>(`[data-row-key="${CSS.escape(String(scrollToKey))}"]`)
          ?.scrollIntoView({ block: 'start' });
    };
    go();
    const t = setTimeout(() => {
      go();
      onScrolledToKey?.();
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the requested key (or the row set) changes
  }, [scrollToKey, display.length]);

  /* selection */
  const selected = selection?.selected ?? new Set<Key>();
  const selectable = (r: R) => !selection?.isDisabled?.(r);
  const orderKeys = dataRows.filter((d) => selectable(d.row)).map((d) => d.key);
  const anchor = useRef<Key | null>(null);
  const shiftRef = useRef(false);
  const toggleSelect = (r: R, on?: boolean) => {
    if (!selection || !selectable(r)) return;
    const key = rowKey(r);
    const next = new Set(selected);
    if (selection.mode === 'single') {
      selection.onChange(new Set([key]));
      return;
    }
    const target = on ?? !next.has(key);
    if (shiftRef.current && anchor.current !== null && anchor.current !== key) {
      for (const k of rangeKeys(orderKeys, anchor.current, key))
        if (target) next.add(k);
        else next.delete(k);
    } else if (target) next.add(key);
    else next.delete(key);
    anchor.current = key;
    shiftRef.current = false;
    selection.onChange(next);
  };
  const allSelected = orderKeys.length > 0 && orderKeys.every((k) => selected.has(k));
  const someSelected = !allSelected && orderKeys.some((k) => selected.has(k));
  const toggleAll = (on: boolean) => {
    if (!selection) return;
    const next = new Set(selected);
    for (const k of orderKeys)
      if (on) next.add(k);
      else next.delete(k);
    selection.onChange(next);
  };

  const open = (r: R, e?: { metaKey?: boolean; ctrlKey?: boolean }) => {
    const href = rowHref?.(r);
    if (href) {
      if (e?.metaKey || e?.ctrlKey) window.open(href, '_blank', 'noopener');
      else openHref(href);
      return true;
    }
    if (onRowOpen) {
      onRowOpen(r);
      return true;
    }
    return false;
  };
  const openable = Boolean(rowHref || onRowOpen);

  /* keyboard */
  const pendingNav = useRef<number | null>(null);
  const rowEls = () => Array.from(bodyRef.current?.querySelectorAll<HTMLElement>('tr[data-row-id]') ?? []);
  const onBodyKeyDown = (e: ReactKeyboardEvent<HTMLTableSectionElement>) => {
    const tr = (e.target as HTMLElement).closest<HTMLElement>('tr[data-row-id]');
    if (!tr) return;
    const inside = e.target !== tr;
    if (inside) {
      if (e.key === 'Escape') {
        e.preventDefault();
        tr.focus();
      }
      return;
    }
    const els = rowEls();
    const rowDisplayIdx = display.flatMap((d, ix) => (d.kind === 'row' ? [ix] : []));
    const i = virtual ? rowDisplayIdx.indexOf(Number(tr.dataset.index)) : els.indexOf(tr);
    const total = virtual ? rowDisplayIdx.length : els.length;
    const goto = (n: number, edge = false) => {
      // Stepping past either end is left to the page (paged tables move to the next page).
      if (!edge && (n < 0 || n >= total)) return;
      const target = Math.max(0, Math.min(total - 1, n));
      if (virtual) {
        const di = rowDisplayIdx[target];
        if (di === undefined) return;
        e.preventDefault();
        const mounted = bodyRef.current?.querySelector<HTMLElement>(`tr[data-index="${di}"]`);
        if (mounted) {
          // already in the window: focus it at once (the browser scrolls it into view)
          mounted.focus();
          pendingNav.current = null;
          return;
        }
        pendingNav.current = target;
        virtualizer.scrollToIndex(di, { align: 'auto' });
        let tries = 0;
        const focusIt = () => {
          const el = bodyRef.current?.querySelector<HTMLElement>(`tr[data-index="${di}"]`);
          if (el) {
            el.focus({ preventScroll: true });
            if (pendingNav.current === target) pendingNav.current = null;
          } else if (++tries < 20) requestAnimationFrame(focusIt);
          else pendingNav.current = null;
        };
        requestAnimationFrame(focusIt);
        return;
      }
      const el = els[target];
      if (el) {
        el.focus();
        e.preventDefault();
      }
    };
    const k = e.key;
    const vim = Boolean(rowHref) && !e.metaKey && !e.ctrlKey && !e.altKey;
    const entry = dataRows.find((d) => `${uid}:${String(d.key)}` === tr.dataset.rowId);
    if (k === 'ArrowDown' || (vim && k === 'j')) goto(i + 1);
    else if (k === 'ArrowUp' || (vim && k === 'k')) goto(i - 1);
    else if (k === 'Home') goto(0, true);
    else if (k === 'End') goto(total - 1, true);
    else if (k === 'PageDown') goto(i + 10, true);
    else if (k === 'PageUp') goto(i - 10, true);
    else if (entry && k === 'Enter') {
      if (open(entry.row, e)) e.preventDefault();
      else if (rowCanExpand(entry.row)) {
        e.preventDefault();
        toggleExpanded(entry.row);
      }
    } else if (entry && (k === ' ' || k === 'x') && selection) {
      e.preventDefault();
      shiftRef.current = e.shiftKey;
      toggleSelect(entry.row);
    } else if (
      entry &&
      renderExpanded &&
      rowCanExpand(entry.row) &&
      (k === 'ArrowRight' || k === 'ArrowLeft')
    ) {
      const isOpen = expanded.has(entry.key);
      const rtl = getComputedStyle(tr).direction === 'rtl';
      const wantOpen = (k === 'ArrowRight') !== rtl;
      if (wantOpen !== isOpen) {
        e.preventDefault();
        toggleExpanded(entry.row);
      }
    } else if (k === '/') {
      const search = cardRef.current?.querySelector<HTMLInputElement>('[data-dt-toolbar] input');
      if (search) {
        e.preventDefault();
        search.focus();
      }
    }
  };

  // A click that ends a text selection or a drag must not open the row; a plain single click
  // waits one double-click interval so double-clicking a word still selects it.
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(openTimer.current), []);
  const onRowClick = (e: ReactMouseEvent, r: R, key: Key) => {
    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
    const moved = downAt.current
      ? Math.hypot(e.clientX - downAt.current.x, e.clientY - downAt.current.y) > 4
      : false;
    const sel = window.getSelection();
    const selectedText = sel && !sel.isCollapsed && sel.toString().trim() !== '';
    clearTimeout(openTimer.current);
    if (moved || selectedText || e.detail > 1) return;
    setFocusedKey(key);
    if (selection && (selectOnRowClick || selection.mode === 'single')) {
      shiftRef.current = e.shiftKey;
      toggleSelect(r);
      return;
    }
    if (openable) {
      if (e.metaKey || e.ctrlKey || e.shiftKey) {
        open(r, e);
        return;
      }
      openTimer.current = setTimeout(() => {
        const cur = window.getSelection();
        if (cur && !cur.isCollapsed && cur.toString().trim() !== '') return;
        open(r);
      }, 220);
      return;
    }
    if (expandOnRowClick) toggleExpanded(r);
  };

  /* overflow tooltip: set a title the first time a clipped cell is hovered */
  const onBodyMouseOver = (e: ReactMouseEvent<HTMLTableSectionElement>) => {
    const cell = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]');
    if (!cell || cell.title || cell.dataset.noTip !== undefined) return;
    if (cell.scrollWidth > cell.clientWidth + 1 || cell.scrollHeight > cell.clientHeight + 1) {
      const text = cell.textContent?.trim();
      if (text) cell.title = text;
    }
  };

  /* resize */
  const startResize = (col: Column<R>, e: React.PointerEvent<HTMLElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.currentTarget as HTMLElement).closest('th')!;
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width;
    const rtl = getComputedStyle(th).direction === 'rtl' ? -1 : 1;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    let last = startW;
    const move = (ev: PointerEvent) => {
      last = startW + (ev.clientX - startX) * rtl;
      model.setWidth(col.id, last, false);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      model.setWidth(col.id, last, true);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
  const onResizerKey = (col: Column<R>, e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const th = (e.currentTarget as HTMLElement).closest('th')!;
    const w = th.getBoundingClientRect().width;
    const rtl = getComputedStyle(th).direction === 'rtl' ? -1 : 1;
    model.setWidth(col.id, w + (e.key === 'ArrowRight' ? 16 : -16) * rtl, true);
  };
  const autosize = (col: Column<R>) => {
    const table = tableRef.current;
    if (!table) return;
    let max = 0;
    const probe = (el: HTMLElement) => {
      const prev = el.style.width;
      const prevMax = el.style.maxWidth;
      el.style.width = 'max-content';
      el.style.maxWidth = 'none';
      max = Math.max(max, el.scrollWidth);
      el.style.width = prev;
      el.style.maxWidth = prevMax;
    };
    table
      .querySelectorAll<HTMLElement>(`tbody td[data-col="${CSS.escape(col.id)}"] [data-cell]`)
      .forEach(probe);
    table
      .querySelectorAll<HTMLElement>(`thead th[data-col="${CSS.escape(col.id)}"] [data-th-label]`)
      .forEach(probe);
    model.setWidth(col.id, max + 28, true);
  };

  /* column order: the neighbour a column swaps with (same frozen block, never a locked column) */
  const [announcement, setAnnouncement] = useState('');
  const orderIds = model.ordered.map((c) => c.id);
  const neighbourOf = (id: string, dir: -1 | 1): Column<R> | null => {
    const vis = model.visible;
    const i = vis.findIndex((c) => c.id === id);
    const me = vis[i];
    const other = vis[i + dir];
    if (!me || !other || me.lockOrder || other.lockOrder) return null;
    return effectivePin(me, model.pins) === effectivePin(other, model.pins) ? other : null;
  };
  const moveBy = (col: Column<R>, dir: number) => {
    if (col.lockOrder) return;
    const vis = model.visible;
    const i = vis.findIndex((c) => c.id === col.id);
    let target: Column<R> | null;
    if (dir === -Infinity) {
      const pin = effectivePin(col, model.pins);
      target = vis.find((c) => !c.lockOrder && effectivePin(c, model.pins) === pin) ?? null;
    } else target = neighbourOf(col.id, dir as -1 | 1);
    if (!target || target.id === col.id || i < 0) return;
    model.moveColumn(col.id, orderIds.indexOf(target.id));
    const now = vis.filter((c) => c.id !== col.id);
    const pos = now.findIndex((c) => c.id === target!.id) + (dir > 0 ? 1 : 0) + 1;
    setAnnouncement(`${headerText(col)} moved to position ${Math.max(1, pos)} of ${vis.length}`);
    requestAnimationFrame(() => focusHead(col.id));
  };

  /* header roving focus: one tab stop for the header row (spec 5.7) */
  const [headFocus, setHeadFocus] = useState<string | null>(null);
  const headIds = renderCols.filter((c) => !pseudoOf(c)).map((c) => c.id);
  const headStop = headFocus && headIds.includes(headFocus) ? headFocus : (headIds[0] ?? null);
  const focusHead = (id: string | undefined) => {
    if (!id) return;
    setHeadFocus(id);
    requestAnimationFrame(() =>
      tableRef.current?.querySelector<HTMLElement>(`thead th[data-col="${CSS.escape(id)}"]`)?.focus(),
    );
  };
  const onHeadKeyDown = (col: Column<R>, e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.target !== e.currentTarget) return;
    const i = headIds.indexOf(col.id);
    const rtl = getComputedStyle(e.currentTarget).direction === 'rtl';
    const key = e.key;
    if (reorderable && e.altKey && e.shiftKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      e.preventDefault();
      moveBy(col, (key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1));
    } else if (e.altKey && (key === 'ArrowLeft' || key === 'ArrowRight')) {
      e.preventDefault();
      const w = e.currentTarget.getBoundingClientRect().width;
      const dir = (key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
      model.setWidth(col.id, w + 16 * dir, true);
    } else if (key === 'ArrowRight' || key === 'ArrowLeft') {
      e.preventDefault();
      focusHead(headIds[i + ((key === 'ArrowRight') !== rtl ? 1 : -1)]);
    } else if (key === 'Home') {
      e.preventDefault();
      focusHead(headIds[0]);
    } else if (key === 'End') {
      e.preventDefault();
      focusHead(headIds[headIds.length - 1]);
    } else if (key === 'Enter' || key === ' ') {
      if (sortKeyOf(col) && sortable(col)) {
        e.preventDefault();
        setSort(nextSort(sort, col, unsortedOk));
      }
    } else if (key === 'ContextMenu' || (key === 'F10' && e.shiftKey)) {
      if (menuEnabled) {
        e.preventDefault();
        setMenuCol(col.id);
      }
    }
  };

  /* column menu */
  const [menuCol, setMenuCol] = useState<string | null>(null);
  const menuEnabled = columnMenu ?? !embedded;
  const headerMenuItems = (col: Column<R>): MenuItemSpec[] => {
    const items: MenuItemSpec[] = [];
    const key = sortKeyOf(col);
    if (key && sortable(col)) {
      items.push({ id: 'sort-asc', label: 'Sort ascending' }, { id: 'sort-desc', label: 'Sort descending' });
      if (sort?.key === key)
        items.push({ id: 'sort-clear', label: 'Clear sort', disabled: !unsortedOk && !controlledSort });
    }
    const pin = effectivePin(col, model.pins);
    if (reorderable) {
      const locked = Boolean(col.lockOrder);
      const nb = (dir: -1 | 1) => neighbourOf(col.id, dir);
      items.push(
        {
          id: 'pin-start',
          label: pin === 'start' ? 'Unfreeze' : 'Freeze column',
          separatorBefore: items.length > 0,
        },
        ...(locked
          ? []
          : [
              { id: 'move-left', label: 'Move left', disabled: !nb(-1) },
              { id: 'move-right', label: 'Move right', disabled: !nb(1) },
              { id: 'move-start', label: 'Move to start', disabled: !nb(-1) },
            ]),
      );
    } else
      items.push(
        { id: 'pin-start', label: pin === 'start' ? 'Unpin' : 'Pin left', separatorBefore: items.length > 0 },
        ...(pin === 'start' ? [] : [{ id: 'pin-end', label: pin === 'end' ? 'Unpin' : 'Pin right' }]),
      );
    if (col.hideable !== false) items.push({ id: 'hide', label: 'Hide column', separatorBefore: true });
    items.push(
      { id: 'autosize', label: 'Autosize column', separatorBefore: col.hideable === false },
      { id: 'reset', label: 'Reset all columns' },
    );
    return items;
  };
  const onHeaderMenu = (col: Column<R>, id: string) => {
    const key = sortKeyOf(col);
    if (id === 'sort-asc' && key) setSort({ key, direction: 'asc' });
    else if (id === 'sort-desc' && key) setSort({ key, direction: 'desc' });
    else if (id === 'sort-clear') setSort(null);
    else if (id === 'pin-start')
      model.setPin(col.id, effectivePin(col, model.pins) === 'start' ? null : 'start');
    else if (id === 'move-left') moveBy(col, -1);
    else if (id === 'move-right') moveBy(col, 1);
    else if (id === 'move-start') moveBy(col, -Infinity as number);
    else if (id === 'pin-end') model.setPin(col.id, effectivePin(col, model.pins) === 'end' ? null : 'end');
    else if (id === 'hide') model.setHidden(col.id, true);
    else if (id === 'autosize') autosize(col);
    else if (id === 'reset') model.resetColumns();
  };

  /* layout */
  const headMin = (c: Column<R>) => (pseudoOf(c) ? 0 : headerMinWidth(c, sortable(c)));
  const widthStyle = (c: Column<R>) => {
    const w = model.widths[c.id] ?? c.width;
    if (c.flex && model.widths[c.id] === undefined) return undefined;
    return Math.max(w ?? 120, headMin(c));
  };
  const minTotal = renderCols.reduce(
    (n, c) => n + (widthStyle(c) ?? Math.max(c.minWidth ?? 0, headMin(c), FLEX_MIN_WIDTH)),
    0,
  );
  const zebraOn =
    zebra === 'auto' ? !embedded && model.density !== 'comfortable' && dataRows.length > 8 : zebra;

  const cardMode =
    useMedia('(max-width: 639px)') && responsive !== 'scroll' && visible.some((c) => c.priority);
  const isEmpty = !loading && !error && rows.length === 0;
  const showFilteredEmpty = isEmpty && isFiltered && filteredEmpty !== undefined;
  const emptyNode = showFilteredEmpty ? filteredEmpty : empty;

  /* compound slots */
  const kids = Children.toArray(children);
  const toolbarNode = kids.find((k) => isValidElement(k) && k.type === Toolbar);
  const footerNode = kids.find((k) => isValidElement(k) && k.type === Footer);
  const otherKids = kids.filter((k) => k !== toolbarNode && k !== footerNode);

  const hiddenKey = [...model.hidden].sort().join('\u0000');
  useEffect(() => {
    onHiddenChange?.(new Set(model.hidden));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires when the hidden set's content changes
  }, [hiddenKey]);

  const ctxValue = {
    model: model as unknown as DataTableModel,
    columns: columns as unknown as Column<never>[],
    selectedCount: selected.size,
    clearSelection: () => selection?.onChange(new Set()),
    bulkActions: bulkActions ?? null,
    bulkOwnSummary: Boolean(bulkOwnSummary),
    bulkAlways: Boolean(bulkAlways),
    isFiltered: Boolean(isFiltered),
    reorderable: Boolean(reorderable),
    suspended,
    announce: setAnnouncement,
  };

  const banner =
    selection?.selectAllMatching &&
    multi &&
    allSelected &&
    selection.selectAllMatching.total > selected.size ? (
      <div className={styles.banner} role="status">
        {selected.size} selected.
        <Button variant="ghost" onPress={selection.selectAllMatching.onSelectAll}>
          Select all {selection.selectAllMatching.total} {selection.selectAllMatching.noun ?? 'rows'}
        </Button>
      </div>
    ) : null;

  const tableLabel = rest['aria-label'];
  const colCount = renderCols.length;

  const thFor = (col: Column<R>) => {
    const pseudo = (col as unknown as PseudoColumn).pseudo;
    const pin = effectivePin(col, pins);
    const key = sortKeyOf(col);
    const canSort = !pseudo && key && sortable(col);
    const active = canSort && sort?.key === key;
    const ariaSort = active
      ? sort!.direction === 'asc'
        ? 'ascending'
        : 'descending'
      : canSort
        ? 'none'
        : undefined;
    const align = pseudo ? 'start' : alignOf(col);
    const style = {
      insetInlineStart: pin === 'start' ? offsets[col.id] : undefined,
      insetInlineEnd: pin === 'end' ? offsets[col.id] : undefined,
    };
    const label = pseudo === 'select' ? null : headerOf(col);
    const text = pseudo ? String(headerOf(col) ?? col.id) : headerText(col);
    return (
      <th
        key={col.id}
        scope="col"
        role="columnheader"
        className={styles.th}
        data-col={col.id}
        data-align={align}
        data-pin={pin ?? undefined}
        data-pin-edge={col.id === lastStart ? 'start' : col.id === firstEnd ? 'end' : undefined}
        data-sorted={active ? sort!.direction : undefined}
        data-sortable={canSort ? '' : undefined}
        data-pseudo={pseudo ?? undefined}
        data-band={hasBands ? '' : undefined}
        aria-sort={ariaSort}
        aria-label={pseudo === 'select' ? undefined : text}
        tabIndex={pseudo ? undefined : col.id === headStop ? 0 : -1}
        onFocus={(e) => {
          if (e.target === e.currentTarget && !pseudo) setHeadFocus(col.id);
        }}
        onKeyDown={pseudo ? undefined : (e) => onHeadKeyDown(col, e)}
        style={style}
        onContextMenu={
          menuEnabled && !pseudo
            ? (e) => {
                e.preventDefault();
                setMenuCol(col.id);
              }
            : undefined
        }
      >
        {pseudo === 'select' ? (
          <Checkbox
            aria-label={selectAllLabel}
            hideLabel
            isSelected={allSelected}
            isIndeterminate={someSelected}
            onChange={toggleAll}
          />
        ) : pseudo === 'expand' ? (
          <span className={styles.srOnly}>Expand</span>
        ) : (
          <div className={styles.thInner}>
            {canSort ? (
              <AriaButton
                className={styles.sortButton}
                excludeFromTabOrder
                onPress={() => setSort(nextSort(sort, col, unsortedOk))}
              >
                <span
                  className={styles.thLabel}
                  data-th-label=""
                  data-hidden={col.hideLabel ? '' : undefined}
                  title={col.hint ?? text}
                >
                  {label}
                </span>
                <span className={styles.sortGlyph} aria-hidden="true" data-active={active ? '' : undefined}>
                  {active ? (sort!.direction === 'asc' ? '↑' : '↓') : '↕'}
                </span>
              </AriaButton>
            ) : (
              <span
                className={styles.thLabel}
                data-th-label=""
                data-hidden={col.hideLabel ? '' : undefined}
                title={col.hint ?? (typeof label === 'string' ? label : undefined)}
              >
                {label}
              </span>
            )}
            {col.filtered ? <span className={styles.filterDot} role="img" aria-label="Filtered" /> : null}
            {menuEnabled && !pseudo ? (
              <span className={styles.kebab}>
                <DropdownMenu
                  label={`${text} column menu`}
                  isOpen={menuCol === col.id}
                  onOpenChange={(o) => setMenuCol(o ? col.id : null)}
                  trigger={<IconButton label={`${text} column menu`} icon="more" excludeFromTabOrder />}
                  items={headerMenuItems(col)}
                  onAction={(id) => onHeaderMenu(col, id)}
                />
              </span>
            ) : null}
            {!pseudo && col.resizable !== false ? (
              <span
                className={styles.resizer}
                role="separator"
                aria-orientation="vertical"
                aria-valuenow={Math.round(measured[col.id] ?? model.widths[col.id] ?? 0)}
                aria-label={`Resize ${text}`}
                tabIndex={-1}
                onPointerDown={(e) => startResize(col, e)}
                onDoubleClick={() => autosize(col)}
                onKeyDown={(e) => onResizerKey(col, e)}
              />
            ) : null}
          </div>
        )}
      </th>
    );
  };

  const renderTd = (col: Column<R>, r: R, entry: Extract<DisplayRow<R>, { kind: 'row' }>, ci: number) => {
    const pseudo = (col as unknown as PseudoColumn).pseudo;
    const pin = effectivePin(col, pins);
    const style = {
      insetInlineStart: pin === 'start' ? offsets[col.id] : undefined,
      insetInlineEnd: pin === 'end' ? offsets[col.id] : undefined,
    };
    const common = {
      className: styles.td,
      'data-col': col.id,
      'data-pin': pin ?? undefined,
      'data-pin-edge': col.id === lastStart ? 'start' : col.id === firstEnd ? 'end' : undefined,
      style,
    } as const;
    if (pseudo === 'select') {
      return (
        <td
          key={col.id}
          {...common}
          role="gridcell"
          data-pseudo="select"
          onClickCapture={(e) => (shiftRef.current = e.shiftKey)}
        >
          <Checkbox
            aria-label={rowLabel?.(r) ?? 'Select row'}
            hideLabel
            isSelected={selected.has(entry.key)}
            isIndeterminate={!selected.has(entry.key) && Boolean(selection?.isIndeterminate?.(r))}
            isDisabled={!selectable(r)}
            onChange={(on) => toggleSelect(r, on)}
          />
        </td>
      );
    }
    if (pseudo === 'expand') {
      const can = rowCanExpand(r);
      const isOpen = expanded.has(entry.key);
      return (
        <td key={col.id} {...common} role="gridcell" data-pseudo="expand">
          {can ? (
            <IconButton
              label={expandLabel ? expandLabel(r, isOpen) : isOpen ? 'Collapse row' : 'Expand row'}
              icon={<Icon name={isOpen ? 'chevron-down' : 'chevron-right'} size={12} />}
              aria-expanded={isOpen}
              onPress={() => toggleExpanded(r)}
            />
          ) : null}
        </td>
      );
    }
    if (pseudo === 'actions') {
      const acts = actionsOf?.(r) ?? [];
      const primary = acts.filter((a) => a.primary).slice(0, 2);
      const more = acts.filter((a) => !primary.includes(a));
      return (
        <td key={col.id} {...common} role="gridcell" data-pseudo="actions">
          <span className={styles.rowActions}>
            {primary.map((a) => (
              <Tooltip key={a.id} content={a.hint ?? a.label}>
                <IconButton
                  label={a.label}
                  icon={a.icon ?? 'more'}
                  tone={a.danger ? 'danger' : 'default'}
                  isDisabled={a.disabled}
                  onPress={() => a.onPress(r)}
                />
              </Tooltip>
            ))}
            {more.length ? (
              <DropdownMenu
                label="Row actions"
                trigger={<IconButton label="Row actions" icon="more" />}
                items={more.map((a) => ({
                  id: a.id,
                  label: a.label,
                  icon: typeof a.icon === 'string' ? <Icon name={a.icon as IconName} size={12} /> : a.icon,
                  tone: a.danger ? ('danger' as const) : undefined,
                  disabled: a.disabled,
                  description: a.hint,
                }))}
                onAction={(id) => more.find((a) => a.id === id)?.onPress(r)}
              />
            ) : null}
          </span>
        </td>
      );
    }
    const ctx: CellCtx = { index: entry.index, density: model.density, card: false };
    const content = col.cell ? col.cell(r, ctx) : defaultCell(col, r);
    const sec = col.secondary?.(r);
    const header = ci === 0 && !selection && !renderExpanded;
    return (
      <td
        key={col.id}
        {...common}
        role={header ? 'rowheader' : 'gridcell'}
        data-align={alignOf(col)}
        data-mono={isMono(col) ? '' : undefined}
        data-type={col.type}
      >
        <div
          className={styles.cell}
          data-cell=""
          data-wrap={col.wrap ? '' : undefined}
          data-truncate={col.truncate}
          style={col.wrap ? ({ '--lines': col.wrap } as React.CSSProperties) : undefined}
        >
          {sec ? (
            <span className={styles.twoLine}>
              <span className={styles.primaryLine}>{content}</span>
              <span className={styles.secondaryLine}>{sec}</span>
            </span>
          ) : (
            content
          )}
        </div>
      </td>
    );
  };

  const vItems = virtual ? virtualizer.getVirtualItems() : [];
  const winFrom = virtual ? (vItems[0]?.index ?? 0) : 0;
  const winTo = virtual
    ? vItems.length
      ? vItems[vItems.length - 1]!.index
      : Math.min(display.length, VIRTUAL_FALLBACK) - 1
    : display.length - 1;
  const padTop = virtual && vItems.length ? Math.max(0, vItems[0]!.start - scrollMargin) : 0;
  const padBottom = virtual
    ? vItems.length
      ? Math.max(0, virtualizer.getTotalSize() - (vItems[vItems.length - 1]!.end - scrollMargin))
      : Math.max(0, display.length - 1 - winTo) * (vcfg?.estimateRowHeight ?? 40)
    : 0;
  const renderedKeys = new Set<Key>();
  for (let i = winFrom; i <= winTo; i += 1) {
    const d = display[i];
    if (d?.kind === 'row') renderedKeys.add(d.key);
  }
  const firstRenderedKey = [...renderedKeys][0];
  const bodyRows: ReactNode[] = [];
  const rowStyleMeta = (d: Extract<DisplayRow<R>, { kind: 'row' }>) => {
    const st = rowState?.(d.row);
    return st;
  };
  display.forEach((d, di) => {
    if (virtual && (di < winFrom || di > winTo)) return;
    const measure = virtual ? { ref: virtualizer.measureElement, 'data-index': di } : {};
    if (d.kind === 'group') {
      const hasSummary = visible.some((c) => c.summary);
      const lead = leading.length + 1; // pseudo columns + the first data column carry the label
      const label = (
        <div className={styles.groupInner}>
          {groupBy?.collapsible ? (
            <AriaButton
              className={styles.groupToggle}
              aria-expanded={!d.collapsed}
              aria-label={`${d.collapsed ? 'Expand' : 'Collapse'} group ${d.groupKey}`}
              onPress={() => toggleGroupKey(d.groupKey)}
            >
              <Icon name={d.collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
            </AriaButton>
          ) : null}
          <span className={styles.groupLabel}>{groupBy?.label(d.groupKey, d.rows)}</span>
          <span className={styles.groupCount}>{d.rows.length}</span>
        </div>
      );
      bodyRows.push(
        <tr key={d.id} className={styles.groupRow} data-group-row="" role="row" {...measure}>
          <td colSpan={hasSummary ? lead : colCount} role="gridcell" className={styles.groupCell}>
            {label}
          </td>
          {hasSummary
            ? renderCols.slice(lead).map((c) => (
                <td
                  key={c.id}
                  role="gridcell"
                  className={styles.groupCell}
                  data-align={alignOf(c)}
                  data-mono={isMono(c) ? '' : undefined}
                >
                  {typeof c.summary === 'function' ? c.summary(d.rows) : c.summary}
                </td>
              ))
            : null}
        </tr>,
      );
      return;
    }
    if (d.kind === 'detail') {
      bodyRows.push(
        <tr key={d.id} className={styles.detailRow} data-detail-row="" {...measure}>
          <td colSpan={colCount} role="gridcell" className={styles.detailCell}>
            {renderExpanded?.(d.row)}
          </td>
        </tr>,
      );
      return;
    }
    const r = d.row;
    const isSel = selected.has(d.key);
    const isOpen = expanded.has(d.key) && rowCanExpand(r);
    const st = rowStyleMeta(d);
    const rid = `${uid}:${String(d.key)}`;
    const isFocusStop =
      focusedKey === d.key ||
      ((focusedKey === null || !renderedKeys.has(focusedKey)) && d.key === firstRenderedKey);
    bodyRows.push(
      <tr
        key={d.id}
        role="row"
        className={[styles.tr, rowClassName?.(r)].filter(Boolean).join(' ')}
        data-row-id={rid}
        data-row-key={String(d.key)}
        data-zebra={zebraOn && d.index % 2 === 1 ? '' : undefined}
        data-selected={isSel ? '' : undefined}
        data-focused={focusedKey === d.key ? '' : undefined}
        data-state={st}
        data-href={rowHref?.(r) ? '' : undefined}
        data-clickable={openable || selectOnRowClick || expandOnRowClick ? '' : undefined}
        aria-selected={selection ? isSel : undefined}
        aria-expanded={renderExpanded && rowCanExpand(r) ? isOpen : undefined}
        aria-rowindex={di + 2}
        {...measure}
        tabIndex={isFocusStop ? 0 : -1}
        onFocus={(e) => {
          if (e.target === e.currentTarget && focusedKey !== d.key) setFocusedKey(d.key);
        }}
        onClick={(e) => onRowClick(e, r, d.key)}
        onPointerDown={(e) => {
          downAt.current = { x: e.clientX, y: e.clientY };
        }}
        onMouseDown={(e) => {
          // shift-click in select mode ranges rows; it must not also start a native text selection
          if (e.shiftKey && selection) e.preventDefault();
        }}
        {...(rowProps?.(r) ?? {})}
      >
        {renderCols.map((c, ci) => renderTd(c, r, d, ci))}
      </tr>,
    );
  });

  const progress = refreshing;

  const spacer = (key: string, height: number) => (
    <tr key={`spacer-${key}`} className={styles.spacer} aria-hidden="true" data-spacer={key}>
      <td colSpan={colCount} style={{ height }} />
    </tr>
  );

  const tableEl = (
    <table
      ref={tableRef}
      className={styles.table}
      role={renderExpanded ? 'treegrid' : 'grid'}
      aria-label={tableLabel}
      aria-rowcount={display.length + 1}
      aria-busy={loading ? true : undefined}
      data-sticky={stickyHeader && !embedded && !headParent ? '' : undefined}
      data-shift={stickyHeader && !embedded && headParent ? '' : undefined}
      data-tall={tall ? '' : undefined}
      style={{ minWidth: Math.max(minWidth ?? 0, minTotal) || undefined }}
    >
      <colgroup>
        {renderCols.map((c) => (
          <col key={c.id} style={{ width: widthStyle(c) }} />
        ))}
      </colgroup>
      <thead className={styles.thead}>
        {hasBands ? (
          <tr className={styles.bandRow} role="row">
            {renderBands(renderCols, styles)}
          </tr>
        ) : null}
        <tr role="row">{renderCols.map((c) => thFor(c))}</tr>
      </thead>
      <EnterContext.Provider value={entering}>
        <tbody ref={bodyRef} className={styles.tbody} onKeyDown={onBodyKeyDown} onMouseOver={onBodyMouseOver}>
          {loading === 'quiet'
            ? null
            : loading
              ? Array.from({ length: 8 }, (_, i) => (
                  <tr key={`sk-${i}`} className={styles.tr} aria-hidden="true">
                    {renderCols.map((c) => (
                      <td key={c.id} className={styles.td} data-col={c.id}>
                        <span
                          className={styles.bone}
                          style={{ inlineSize: `${50 + ((i * 7 + c.id.length * 11) % 40)}%` }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              : [
                  padTop > 0 ? spacer('top', padTop) : null,
                  ...bodyRows,
                  padBottom > 0 ? spacer('bottom', padBottom) : null,
                ]}
        </tbody>
      </EnterContext.Provider>
      {visible.some((c) => c.summary) && !groupBy && !loading && rows.length > 0 ? (
        <tfoot className={styles.tfoot}>
          <tr>
            {renderCols.map((c) => (
              <td key={c.id} className={styles.td} data-col={c.id} data-align={alignOf(c)}>
                {typeof c.summary === 'function' ? c.summary(rows) : c.summary}
              </td>
            ))}
          </tr>
        </tfoot>
      ) : null}
    </table>
  );

  const stateBlock = loading ? null : error ? (
    <div className={styles.state}>
      <ErrorState error={error} compact onRetry={onRetry} title={errorTitle} />
    </div>
  ) : isEmpty ? (
    <div className={styles.state}>
      {emptyNode && typeof emptyNode === 'object' ? (
        emptyNode
      ) : (
        <EmptyState compact title={(emptyNode as string) || 'Nothing to show'} />
      )}
    </div>
  ) : null;

  return (
    <DataTableContext.Provider value={ctxValue}>
      <div
        ref={cardRef}
        className={[styles.card, className].filter(Boolean).join(' ')}
        data-variant={variant}
        data-density={model.density}
        data-zebra={zebraOn ? '' : undefined}
        data-testid="data-table"
      >
        <span className={styles.srOnly} role="status" aria-live="polite" data-dt-announce="">
          {announcement}
        </span>
        {toolbarNode ? null : <SelectionBar />}
        {toolbarNode}
        {otherKids}
        {banner}
        <div
          className={styles.bodyHost}
          data-scroll-start={scrollX.start ? '' : undefined}
          data-scroll-end={scrollX.end ? '' : undefined}
          data-cues={scrollCues ? '' : undefined}
          style={
            {
              '--pin-start': `${pinSum('start')}px`,
              '--pin-end': `${pinSum('end')}px`,
            } as React.CSSProperties
          }
        >
          {progress ? <div className={styles.progress} role="progressbar" aria-label="Refreshing" /> : null}
          {cardMode ? (
            <CardList
              display={display}
              columns={visible}
              rowKey={rowKey}
              selection={selection}
              selected={selected}
              toggleSelect={toggleSelect}
              onOpen={(r, e) => open(r, e)}
              openable={openable}
              rowActions={rowActions}
              renderExpanded={renderExpanded}
              expanded={expanded}
              toggleExpanded={toggleExpanded}
              rowCanExpand={rowCanExpand}
              sort={sort}
              setSort={setSort}
              unsortedOk={unsortedOk}
              sortable={sortable}
              loading={loading === true}
              ariaLabel={tableLabel}
              rowState={rowState}
              rowLabel={rowLabel}
              rowProps={rowProps}
              expandLabel={expandLabel}
              expandOnRowClick={expandOnRowClick}
              groupBy={groupBy}
              toggleGroupKey={toggleGroupKey}
            />
          ) : (
            <div
              ref={scrollerRef}
              data-dt-scroller=""
              className={styles.scroller}
              data-rail={scrollX.overflow && scrollCues ? '' : undefined}
              data-scrolled-x={scrollX.start ? '' : undefined}
              data-scrolled-end={scrollX.end ? '' : undefined}
              style={{ '--dt-scroller-width': `${scrollerWidth}px` } as React.CSSProperties}
              tabIndex={scrollX.overflow ? 0 : undefined}
              role={scrollX.overflow ? 'region' : undefined}
              aria-label={scrollX.overflow ? `${tableLabel} (scrollable)` : undefined}
            >
              {tableEl}
              {stateBlock}
            </div>
          )}
          {cardMode ? stateBlock : null}
        </div>
        {scrollX.overflow && scrollCues && !cardMode ? (
          <div ref={railRef} className={styles.rail} aria-hidden="true" data-testid="table-scroll-rail">
            <div ref={railInnerRef} className={styles.railInner} />
          </div>
        ) : null}
        {footerNode}
      </div>
    </DataTableContext.Provider>
  );
}

function renderBands<R>(cols: Column<R>[], s: Record<string, string>) {
  // Pseudo (select/expand/actions) columns never carry a group.
  return groupBands(cols).map((b) => (
    <th
      key={b.key}
      colSpan={b.span}
      scope="colgroup"
      role={b.label ? 'columnheader' : 'presentation'}
      className={s.bandCell}
      data-labelled={b.label ? '' : undefined}
    >
      {b.label}
    </th>
  ));
}

/* ── Card layout (narrow screens) ──────────────────────────────────────── */

function CardList<R>({
  display,
  columns,
  rowKey,
  selection,
  selected,
  toggleSelect,
  onOpen,
  openable,
  rowActions,
  renderExpanded,
  expanded,
  toggleExpanded,
  rowCanExpand,
  sort,
  setSort,
  unsortedOk,
  sortable,
  loading,
  ariaLabel,
  rowState,
  rowLabel,
  rowProps,
  expandLabel,
  expandOnRowClick,
  groupBy,
  toggleGroupKey,
}: {
  display: DisplayRow<R>[];
  columns: Column<R>[];
  rowKey: (r: R) => Key;
  selection?: SelectionConfig<R>;
  selected: Set<Key>;
  toggleSelect: (r: R, on?: boolean) => void;
  onOpen: (r: R, e?: { metaKey?: boolean; ctrlKey?: boolean }) => boolean;
  openable: boolean;
  rowActions?: (r: R) => RowAction<R>[];
  renderExpanded?: (r: R) => ReactNode;
  expanded: Set<Key>;
  toggleExpanded: (r: R) => void;
  rowCanExpand: (r: R) => boolean;
  sort: SortState | null;
  setSort: (s: SortState | null) => void;
  unsortedOk: boolean;
  sortable: (c: Column<R>) => boolean;
  loading?: boolean;
  ariaLabel: string;
  rowState?: (r: R) => RowStateKind | undefined;
  rowLabel?: (r: R) => string;
  rowProps?: (r: R) => Record<string, string | undefined>;
  expandLabel?: (r: R, open: boolean) => string;
  expandOnRowClick?: boolean;
  groupBy?: GroupByConfig<R>;
  toggleGroupKey?: (key: string) => void;
}) {
  const [more, setMore] = useState<Set<Key>>(new Set());
  const sortCols = columns.filter((c) => sortKeyOf(c) && sortable(c));
  const headline = columns.filter((c) => c.priority === 1);
  const body = columns.filter((c) => c.priority === 2);
  const detail = columns.filter((c) => c.priority === 3);
  const lead = headline.find((c) => c.cardTitle) ?? headline[0];
  const restHead = headline.filter((c) => c !== lead);
  if (loading)
    return (
      <div className={styles.cards} aria-busy="true">
        <span className={styles.bone} />
      </div>
    );
  return (
    <div className={styles.cardsHost}>
      {sortCols.length ? (
        <div className={styles.cardSort}>
          <label className={styles.cardSortLabel}>
            Sort by
            <select
              className={styles.cardSortSelect}
              value={sort?.key ?? ''}
              onChange={(e) => {
                const col = sortCols.find((c) => sortKeyOf(c) === e.target.value);
                setSort(col ? nextSort(null, col, unsortedOk) : null);
              }}
            >
              <option value="">Default</option>
              {sortCols.map((c) => (
                <option key={c.id} value={sortKeyOf(c)}>
                  {headerText(c)}
                </option>
              ))}
            </select>
          </label>
          {sort ? (
            <Button
              variant="ghost"
              onPress={() => setSort({ ...sort, direction: sort.direction === 'asc' ? 'desc' : 'asc' })}
            >
              {sort.direction === 'asc' ? 'Ascending' : 'Descending'}
            </Button>
          ) : null}
        </div>
      ) : null}
      <ul className={styles.cards} aria-label={ariaLabel}>
        {display.map((d) => {
          if (d.kind === 'group') {
            const sums = columns.filter((c) => c.summary && c.priority && c.priority <= 2);
            return (
              <li key={d.id} className={styles.cardGroup}>
                <span className={styles.cardGroupHead}>
                  {groupBy?.collapsible ? (
                    <AriaButton
                      className={styles.groupToggle}
                      aria-expanded={!d.collapsed}
                      aria-label={`${d.collapsed ? 'Expand' : 'Collapse'} group ${d.groupKey}`}
                      onPress={() => toggleGroupKey?.(d.groupKey)}
                    >
                      <Icon name={d.collapsed ? 'chevron-right' : 'chevron-down'} size={12} />
                    </AriaButton>
                  ) : null}
                  {groupBy ? groupBy.label(d.groupKey, d.rows) : d.groupKey}
                </span>
                {sums.length ? (
                  <span className={styles.cardGroupSums}>
                    {sums.map((c) => (
                      <span key={c.id}>
                        <span className={styles.cardGroupSumLabel}>{headerText(c)}</span>{' '}
                        {typeof c.summary === 'function' ? c.summary(d.rows) : c.summary}
                      </span>
                    ))}
                  </span>
                ) : null}
              </li>
            );
          }
          if (d.kind === 'detail')
            return (
              <li key={d.id} className={styles.cardDetail}>
                {renderExpanded?.(d.row)}
              </li>
            );
          const r = d.row;
          const acts = rowActions?.(r) ?? [];
          const isMore = more.has(d.key);
          const ctx: CellCtx = { index: d.index, density: 'regular', card: true };
          const cellOf = (c: Column<R>) => (c.cell ? c.cell(r, ctx) : defaultCell(c, r));
          return (
            <li
              key={d.id}
              className={styles.card2}
              data-selected={selected.has(d.key) ? '' : undefined}
              data-state={rowState?.(r)}
              data-row-key={String(d.key)}
              {...(rowProps?.(r) ?? {})}
              data-clickable={openable ? '' : undefined}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
                if (openable) onOpen(r, e);
                else if (expandOnRowClick) toggleExpanded(r);
              }}
            >
              <div className={styles.cardHead}>
                {selection && (selection.mode ?? 'multiple') === 'multiple' ? (
                  <Checkbox
                    aria-label={rowLabel?.(r) ?? 'Select row'}
                    hideLabel
                    isSelected={selected.has(d.key)}
                    isDisabled={selection.isDisabled?.(r)}
                    onChange={(on) => toggleSelect(r, on)}
                  />
                ) : null}
                <div className={styles.cardTitle}>{lead ? cellOf(lead) : String(rowKey(r))}</div>
                {renderExpanded && rowCanExpand(r) ? (
                  <IconButton
                    label={
                      expandLabel
                        ? expandLabel(r, expanded.has(d.key))
                        : expanded.has(d.key)
                          ? 'Collapse row'
                          : 'Expand row'
                    }
                    icon={<Icon name={expanded.has(d.key) ? 'chevron-down' : 'chevron-right'} size={12} />}
                    aria-expanded={expanded.has(d.key)}
                    onPress={() => toggleExpanded(r)}
                  />
                ) : null}
                {acts.length ? (
                  <DropdownMenu
                    label="Row actions"
                    trigger={<IconButton label="Row actions" icon="more" />}
                    items={acts.map((a) => ({
                      id: a.id,
                      label: a.label,
                      tone: a.danger ? ('danger' as const) : undefined,
                      disabled: a.disabled,
                    }))}
                    onAction={(id) => acts.find((a) => a.id === id)?.onPress(r)}
                  />
                ) : null}
              </div>
              {restHead.length ? (
                <div className={styles.cardMeta}>
                  {restHead.map((c) => (
                    <span key={c.id}>{cellOf(c)}</span>
                  ))}
                </div>
              ) : null}
              {body.length ? (
                <dl className={styles.cardGrid}>
                  {body.map((c) => (
                    <Fragment key={c.id}>
                      <dt>{headerText(c)}</dt>
                      <dd>{cellOf(c)}</dd>
                    </Fragment>
                  ))}
                </dl>
              ) : null}
              {detail.length ? (
                <>
                  {isMore ? (
                    <dl className={styles.cardGrid}>
                      {detail.map((c) => (
                        <Fragment key={c.id}>
                          <dt>{headerText(c)}</dt>
                          <dd>{cellOf(c)}</dd>
                        </Fragment>
                      ))}
                    </dl>
                  ) : null}
                  <Button
                    variant="ghost"
                    aria-expanded={isMore}
                    onPress={() =>
                      setMore((s) => {
                        const n = new Set(s);
                        if (n.has(d.key)) n.delete(d.key);
                        else n.add(d.key);
                        return n;
                      })
                    }
                  >
                    {isMore ? 'Less' : 'More'}
                  </Button>
                </>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
