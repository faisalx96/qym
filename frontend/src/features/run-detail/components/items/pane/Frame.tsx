/**
 * The item pane frame shared by the designs: the header (identity, title, trace, link, width, pager, close), the
 * resize handle, the keyboard (J / K, Escape) and the row selection. The pane lies over the page from the sticky
 * section nav down, so the page's Metric and Pass-if controls stay in reach.
 */
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { singleKeyShortcutsEnabled } from '@/features/runs-list/useRunsKeyboard';
import { useDelayedPending } from '@/lib/pending';
import { readLocal, writeLocal } from '@/lib/storage';
import { textDirAttrs, type TextMode } from '@/lib/text';
import { ErrorState, Icon, Kbd, Skeleton, StateTag, type StateTagTone } from '@/ui';
import { useShellScroller } from '../../../hooks/useScrollMargin';
import { defaultPageSize } from '../../../lib/itemsPaging';
import { itemVerdict, type ItemVerdict } from '../../../lib/itemVerdict';
import { verdictTone } from '../../../lib/verdictMark';
import { useRunPage } from '../../../RunContext';
import type { Row } from '../../../types';
import pager from '../../RunPager.module.css';
import { PAGE_SIZES } from '../ItemsTable';
import { useItemsUi } from '../ItemsUi';
import { Act, CopyAct } from './actions';
import { Block, PaneSection, type BlockTone } from './blocks';
import { OPEN_PASSES, defaultOpenPasses, promptLine, useItem, type ItemData } from './model';
import { ResizeHandle, WidthAct } from './resize';
import { PaneTextMode } from './values';
import { PaneGrowContext, defaultPaneWidth, paneWidth, type PaneGrow } from './width';
import s from './pane.module.css';

/** At its default width the pane leaves this much of the table in view (the row number and the status). */
const TABLE_IN_VIEW = 240;

/** A block of the loading frame, in the design's own order. */
/** The blocks of a loading pane, top to bottom: `outputs` is the Output row (the outputs side by side). */
export type SkeletonBlock = 'metrics' | 'input' | 'expected' | 'output' | 'outputs';

/** The StateTag tone of an item verdict (an item result is the result of a check, as the Items table shows it). */
export function verdictMark(v: ItemVerdict): StateTagTone {
  return v.kind === 'aggregate' ? (v.tone ?? 'warning') : verdictTone(v.kind);
}

export interface PaneCtx {
  row: Row;
  item: ItemData;
  /** The passes open side by side (multi-pass items), in pass order; at least one, at most `OPEN_PASSES`. */
  open: number[];
  /** The same passes in the order the reader picked them (the oldest first): the oldest leaves for a new one. */
  order: number[];
  /** The passes in view, in pick order; more than `OPEN_PASSES` keeps the last ones picked. */
  setOpen: (passes: number[]) => void;
  /** Open the trace drawer on one pass (each Output of a pass in view has its own trace action). */
  trace: (pass: number) => void;
}

export interface PaneProps {
  openId: string;
  rows: Row[];
  /** Design id: names the stored width. */
  id: string;
  /** Default width in px. */
  width: number;
  /** Default width for a multi-pass item (its metrics table has a column per pass). */
  multiWidth?: number;
  minWidth?: number;
  /** The blocks of the design in order: the loading frame draws the same blocks. */
  skeleton: SkeletonBlock[];
  children: (ctx: PaneCtx) => ReactNode;
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(Math.max(n, lo), Math.max(lo, hi));
}

/** The pane's top edge (the bottom of the page's sticky section nav) and the start edge of the page content. */
function usePaneBox(scroller: HTMLElement | null, navSelector: string): { top: number; start: number } {
  const [box, setBox] = useState({ top: 0, start: 0 });
  useLayoutEffect(() => {
    const nav = document.querySelector<HTMLElement>(navSelector);
    const measure = () => {
      const rect = scroller?.getBoundingClientRect();
      const next = {
        top: Math.round((rect?.top ?? 0) + (nav?.offsetHeight ?? 0)),
        start: Math.round(rect?.left ?? 0),
      };
      setBox((cur) => (cur.top === next.top && cur.start === next.start ? cur : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    if (scroller) ro.observe(scroller);
    if (nav) ro.observe(nav);
    return () => ro.disconnect();
  }, [scroller, navSelector]);
  return box;
}

function useViewportWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/** Copy the link of the item. */
export function LinkAct({ text }: { text: string }) {
  return <CopyAct text={text} label="Copy link" icon="link" />;
}

/** What the pager shows of a neighbour item. */
export interface PanePeek {
  number: number;
  prompt: string;
  mark?: { tone: StateTagTone; label: string };
}

/** One step of the pager, drawn as the run pager's step: the neighbour shows on hover and on keyboard focus. */
function Step({
  which,
  target,
  onGo,
}: {
  which: 'previous' | 'next';
  target: PanePeek | undefined;
  onGo: () => void;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const noun = which === 'previous' ? 'Previous item' : 'Next item';
  const icon = <Icon name={which === 'previous' ? 'chevron-up' : 'chevron-down'} size={12} />;
  if (!target) {
    return (
      <span
        className={pager.step}
        role="link"
        aria-disabled="true"
        aria-label={`No ${noun.toLowerCase()}`}
        title={`No ${noun.toLowerCase()}`}
      >
        {icon}
      </span>
    );
  }
  return (
    <span className={pager.stepWrap}>
      <button
        type="button"
        className={`${pager.step} ${s.stepBtn}`}
        aria-label={`${noun}: #${target.number}`}
        aria-keyshortcuts={which === 'previous' ? 'K' : 'J'}
        aria-describedby={open ? id : undefined}
        onClick={onGo}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {icon}
      </button>
      {open ? (
        <span id={id} role="tooltip" className={pager.peekCard}>
          <span>
            {noun} <Kbd>{which === 'previous' ? 'K' : 'J'}</Kbd>
          </span>
          <span className={pager.peek}>
            <span className={s.peekHead}>
              <span className={s.peekNum}>#{target.number}</span>
              {target.mark ? <StateTag tone={target.mark.tone}>{target.mark.label}</StateTag> : null}
            </span>
            {target.prompt ? (
              <span className={s.peekPrompt} {...textDirAttrs(target.prompt)}>
                {target.prompt}
              </span>
            ) : null}
          </span>
        </span>
      ) : null}
    </span>
  );
}

export interface PaneSkeletonProps {
  blocks: SkeletonBlock[];
  /** The metric rows that will arrive (the page knows its metrics before the item texts load). */
  metricRows?: number;
  /** The output blocks of the Output row: one on the run page, one per run on the compare page. */
  outputs?: number;
  /** The class of the element that holds the outputs (the compare page has its own grid). */
  pairClassName?: string;
}

/**
 * The loading frame (DESIGN_LANGUAGE §7 "A loading frame is the loaded layout"): the pane's own blocks and section
 * head, with `Skeleton` shapes in place of the values, so the content arrives in place. No invented value, no word.
 */
export function PaneSkeleton({ blocks, metricRows = 3, outputs = 1, pairClassName }: PaneSkeletonProps) {
  const text = (kind: 'input' | 'expected' | 'output', key: string) => {
    const [title, tone, label, rows] = (
      {
        input: ['Input', 'info', 'Loading input', 2],
        expected: ['Expected', 'gold', 'Loading expected output', 3],
        output: ['Output', 'neutral', 'Loading output', 3],
      } as const satisfies Record<string, readonly [string, BlockTone, string, number]>
    )[kind];
    return (
      <Block key={key} title={title} tone={tone} part={kind} fill={kind === 'output'} busy>
        <Skeleton kind="lines" rows={rows} label={label} />
      </Block>
    );
  };
  return (
    <div className={s.skeleton} data-part="pane-skeleton" aria-busy="true" aria-label="Loading item">
      {blocks.map((b, i) =>
        b === 'outputs' ? (
          // the Output row: one block per output, side by side (Expected has its own row above)
          <div key={i} className={pairClassName ?? s.outs}>
            {Array.from({ length: Math.max(1, outputs) }, (_, n) => text('output', `o${n}`))}
          </div>
        ) : b === 'metrics' ? (
          <PaneSection key={i} title="Metrics" part="metrics-section">
            <section className={s.block} data-tone="neutral" data-part="metrics" aria-hidden="true">
              <div className={s.mgrid} data-loading="">
                <div className={s.mhead}>
                  <span className={s.mtitle}>Metric</span>
                </div>
                {Array.from({ length: Math.max(1, metricRows) }, (_, n) => (
                  <div key={n} className={s.mrow}>
                    <span className={s.boneCell}>
                      <Skeleton kind="value" width="60%" height={14} label="Loading metrics" />
                    </span>
                  </div>
                ))}
              </div>
            </section>
          </PaneSection>
        ) : (
          text(b, String(i))
        ),
      )}
    </div>
  );
}

const NOT_FOR_KEYS =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"], dialog';
const shown = (selector: string) =>
  Array.from(document.querySelectorAll(selector)).some((n) => n.getClientRects().length);
/** A tooltip is on screen and no menu, list or dialog is: Escape has no other owner than the hint. */
const onlyTooltipOpen = () =>
  shown('[role="tooltip"]') && !shown('[role="menu"], [role="listbox"], [role="dialog"], [data-popover]');
/** What a click outside the pane may land on without closing it (see `onDismiss`). */
const KEEP_OPEN_ON = [
  'tr[data-item-id]',
  '[data-part="item-head"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="tooltip"]',
  '[data-trigger]',
  '[data-toast-container]',
  // a control that opens a menu or a popover: what it opens belongs to the page the pane is read with
  '[aria-haspopup]:not([aria-haspopup="false"])',
].join(', ');
/** A menu, a list box or a popover is open: the press that closes it does not close the pane too. */
const floatOpen = () => shown('[role="menu"], [role="listbox"], [data-trigger]');
const modalOpen = () =>
  Array.from(document.querySelectorAll('[aria-modal="true"]')).some((n) => n.getClientRects().length);

export interface PaneShellProps {
  /** Design id (a data attribute for tests and styles). */
  design: string;
  itemId: string;
  /** The accessible name of the pane. */
  label: string;
  /** Names the stored width. */
  storageKey: string;
  defaultWidth: number;
  minWidth?: number;
  /**
   * The pane grows by itself to what its content asks for (the run page's metrics table, I16), up to 75% of the page
   * area, and its default width stays inside the same cap. The stored width is the reader's own, never the growth.
   */
  grow?: boolean;
  /** The page's sticky bar: the pane starts under it. */
  navSelector: string;
  /** Rendered or raw text, as the page shows it. */
  textMode: TextMode | undefined;
  /** The identity of the item: its number, its status, its id. */
  ident: ReactNode;
  /** Header actions before the width button. */
  actions?: ReactNode;
  title?: string;
  /** The position of the item among the items in view (0-based) and how many there are. */
  at: number;
  total: number;
  prev?: PanePeek;
  next?: PanePeek;
  onStep: (which: 'previous' | 'next') => void;
  onClose: () => void;
  /**
   * A click outside the pane closes it with this (the focus stays where the reader clicked). A click on a row of the
   * list is not outside: the row opens its own item. Without it, only Close and Escape close the pane.
   */
  onDismiss?: () => void;
  children: ReactNode;
}

/**
 * The frame of an item pane on any page: the header (identity, actions, width, pager, close), the resize handle, the
 * keyboard (J / K, Escape) and the body. The page gives it the item and the content.
 */
export function PaneShell({
  design,
  itemId,
  label,
  storageKey,
  defaultWidth: wantedWidth,
  minWidth = 480,
  grow = false,
  navSelector,
  textMode,
  ident,
  actions,
  title,
  at,
  total,
  prev,
  next,
  onStep,
  onClose,
  onDismiss,
  children,
}: PaneShellProps) {
  const scroller = useShellScroller();
  const box = usePaneBox(scroller, navSelector);
  const viewport = useViewportWidth();
  const bodyRef = useRef<HTMLDivElement>(null);
  const paneRef = useRef<HTMLElement>(null);

  // ---- a click outside closes the pane, as a click on the scrim closes a drawer. Not outside: a row of the list (it
  // opens its item), the page's sticky bar (its Metric and Pass-if controls are in reach on purpose), and anything that
  // floats over the page (a menu, a popover, a dialog, a tooltip, a toast). A press that starts in the pane (a text
  // selection dragged out, the resize handle) and a click that ends a text selection never close it.
  useEffect(() => {
    if (!onDismiss) return undefined;
    const outside = (target: EventTarget | null) => {
      const el = target instanceof Element ? target : null;
      if (!el || !el.isConnected || paneRef.current?.contains(el)) return false;
      return !el.closest(`${KEEP_OPEN_ON}, ${navSelector}`);
    };
    let armed = false;
    const onDown = (event: PointerEvent) => {
      armed = event.button === 0 && !modalOpen() && !floatOpen() && outside(event.target);
    };
    const onClick = (event: MouseEvent) => {
      if (!armed) return;
      armed = false;
      // a control of the page (React Aria cancels the default of its click) closes the pane like any other place
      if (!outside(event.target)) return;
      if (String(window.getSelection?.() ?? '').trim()) return;
      onDismiss();
    };
    document.addEventListener('pointerdown', onDown, true);
    // in the capture phase: a press handler of the page stops its click from bubbling
    document.addEventListener('click', onClick, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('click', onClick, true);
    };
  }, [onDismiss, navSelector]);

  // ---- J / K step through the items while an item is open (the run pager takes them when none is)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.isComposing) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'j' && key !== 'k') return;
      if (!singleKeyShortcutsEnabled()) return;
      const el = event.target as HTMLElement | null;
      if (el?.closest?.(NOT_FOR_KEYS) || modalOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      onStep(key === 'j' ? 'next' : 'previous');
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onStep]);

  // ---- Escape closes the pane from anywhere on the page. It runs last (bubble, on the document): a widget that owns
  // the key (the score editor, a menu, a dialog) has stopped it or prevented it before it arrives here.
  // A tooltip is not such a widget: it only describes the control that has the focus (an action tile after the trace
  // drawer gave the focus back, a pager step). React Aria takes Escape to close its tooltip; the same press closes the
  // pane, so the pane never needs a press more because a hint was open.
  useEffect(() => {
    const done = new WeakSet<Event>();
    const blocked = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      return !!el?.closest?.(NOT_FOR_KEYS) || modalOpen();
    };
    const onCapture = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || blocked(event)) return;
      if (!onlyTooltipOpen()) return;
      done.add(event);
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || done.has(event) || blocked(event)) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onCapture, true);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onCapture, true);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // a new item starts at its top
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [itemId]);

  // ---- width: as wide as the content needs. The default leaves the start of the list in view; the header button
  // takes the whole page width and gives it back; drag, arrow keys and double click (reset) do the fine work.
  // A growing pane (I16) also widens by itself to what its content asks for, up to 75% of the page area (width.ts).
  const area = Math.max(0, viewport - box.start);
  const maxWidth = Math.max(minWidth, area);
  const defaultWidth = grow
    ? defaultPaneWidth(wantedWidth, minWidth, area, TABLE_IN_VIEW)
    : clamp(wantedWidth, minWidth, maxWidth - TABLE_IN_VIEW);
  const [stored, setStored] = useState<{ key: string; value: number | null }>(() => ({
    key: '',
    value: null,
  }));
  const storedValue = (() => {
    if (stored.key === storageKey) return stored.value;
    const n = Number(readLocal(storageKey));
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const base = clamp(storedValue ?? defaultWidth, Math.min(minWidth, maxWidth), maxWidth);
  // what the content asks for, per layout (`key`); for one layout the need only grows, so a scrollbar that comes and
  // goes with the width cannot rock the pane
  const [need, setNeed] = useState<{ key: string; px: number } | null>(null);
  // the layout the reader resized the pane at: that need no longer grows the pane (the reader's width wins) until
  // the layout changes (a pass comes into view or leaves it)
  const [kept, setKept] = useState<string | null>(null);
  const lastKey = useRef<string | null>(null);
  const growCtx = useMemo<PaneGrow>(
    () => ({
      pane: () => paneRef.current,
      need: (key, px) => {
        if (px !== null && key !== lastKey.current) {
          lastKey.current = key;
          setKept(null);
        }
        setNeed((cur) => {
          if (px === null) return cur?.key === key ? null : cur;
          return cur?.key === key && cur.px >= px ? cur : { key, px };
        });
      },
    }),
    [setKept],
  );
  const width = grow && need && need.key !== kept ? paneWidth({ base, need: need.px, area }) : base;
  const full = width >= maxWidth - 8;
  /** `manual`: the reader's own width (drag, keys), which stops the growth for the layout in view. */
  const setWidth = (n: number | null, persist: boolean, manual = false) => {
    const value = n === null ? null : clamp(Math.round(n), minWidth, maxWidth);
    setStored({ key: storageKey, value });
    if (manual) setKept(need?.key ?? null);
    if (persist) writeLocal(storageKey, value === null ? null : String(value));
  };

  const pane = (
    <aside
      ref={paneRef}
      className={s.pane}
      data-pane="overlay"
      data-design={design}
      data-full={full ? '' : undefined}
      data-testid="item-pane"
      data-item-id={itemId}
      aria-label={label}
      style={{ top: box.top, width }}
    >
      <ResizeHandle
        label="Resize the item pane"
        width={width}
        min={minWidth}
        max={maxWidth}
        onWidth={(n, persist) => setWidth(n, persist, true)}
        onReset={() => setWidth(null, true)}
      />
      <header className={s.head}>
        <div className={s.headRow}>
          <div className={s.ident}>{ident}</div>
          <div className={s.headActions}>
            {actions}
            <WidthAct full={full} onPress={() => setWidth(full ? null : maxWidth, true)} />
            <nav className={pager.pager} aria-label="Previous and next item">
              <Step which="previous" target={prev} onGo={() => onStep('previous')} />
              <span className={pager.pos}>
                {at >= 0 ? (
                  <>
                    <span className={pager.num}>{at + 1}</span> of {total.toLocaleString('en-US')}
                  </>
                ) : (
                  'Not in the list'
                )}
              </span>
              <Step which="next" target={next} onGo={() => onStep('next')} />
            </nav>
            <Act label="Close item" icon="close" onPress={onClose} />
          </div>
        </div>
        {title ? (
          <h3 className={s.title} {...textDirAttrs(title)}>
            {title}
          </h3>
        ) : null}
      </header>
      <div ref={bodyRef} className={s.body}>
        <PaneGrowContext.Provider value={grow ? growCtx : null}>
          <PaneTextMode.Provider value={textMode}>{children}</PaneTextMode.Provider>
        </PaneGrowContext.Provider>
      </div>
    </aside>
  );
  return createPortal(pane, document.body);
}

/**
 * The row the pane shows (I14): the live row once its bodies are loaded. While a live refresh reloads them (a new pass
 * arrived, an output or a score moved) the pane keeps the row it showed last, loaded, instead of its loading frame:
 * the frame unmounted the blocks, and with them the opened details, a score edit in progress and the scroll. The
 * fresh row replaces it as soon as its bodies arrive.
 */
export function useShownRow(live: Row, lazy: boolean, ensure: (ids: string[]) => Promise<void>): Row {
  const loaded = live.__details_loaded === true || !lazy;
  const [kept, setKept] = useState<Row | null>(loaded ? live : null);
  if (loaded && kept !== live) setKept(live);
  const stale = !loaded && kept !== null && kept.item_id === live.item_id;
  useEffect(() => {
    if (stale) void ensure([live.item_id]);
  }, [stale, live.item_id, ensure]);
  return stale && kept ? kept : live;
}

function PaneItem({
  row: live,
  rows,
  id,
  width: singleWidth,
  multiWidth,
  minWidth = 480,
  skeleton,
  children,
}: Omit<PaneProps, 'openId'> & { row: Row }) {
  const ui = useItemsUi();
  const { api, payload } = useRunPage();
  const row = useShownRow(live, payload.snapshot.detail_mode === 'lazy', ui.details.ensure);
  const item = useItem(row);

  // one item is open at a time: `toggleExpanded` replaces the open item (ItemsSection)
  const { toggleExpanded, details, requestScroll } = ui;

  // ---- the passes open side by side belong to one item: a new item opens on its own default (defaultOpenPasses).
  // At most OPEN_PASSES are in view; the state keeps the pick order, so a new pick replaces the one picked earliest.
  const [pick, setPick] = useState<{ id: string; passes: number[] } | null>(null);
  const known = new Set(item.passes.map((p) => p.pass));
  const picked = pick?.id === row.item_id ? pick.passes.filter((n) => known.has(n)) : [];
  const order = (picked.length ? picked : defaultOpenPasses(item.passes)).slice(-OPEN_PASSES);
  const open = [...order].sort((a, b) => a - b);
  const setOpen = useCallback(
    (passes: number[]) =>
      passes.length && setPick({ id: row.item_id, passes: [...new Set(passes)].slice(-OPEN_PASSES) }),
    [row.item_id],
  );

  // ---- previous / next in the table's own order, across its pages
  const at = rows.findIndex((r) => r.item_id === row.item_id);
  const prev = at > 0 ? rows[at - 1] : undefined;
  const next = at >= 0 && at < rows.length - 1 ? rows[at + 1] : undefined;
  const go = useCallback(
    (which: 'previous' | 'next') => {
      const target = which === 'next' ? next : prev;
      if (!target) return;
      const stored = Number(readLocal('qym:run-page-size'));
      const size = PAGE_SIZES.includes(stored) ? stored : defaultPageSize(rows.length);
      const page = Math.floor(rows.indexOf(target) / size) + 1;
      if (page !== api.view.page) {
        // another page of the table: the item link does it (the page turns, the row opens and scrolls into view)
        api.setItemParam(target.item_id);
        return;
      }
      toggleExpanded(target.item_id, true);
      requestScroll(target.item_id);
    },
    [rows, next, prev, toggleExpanded, requestScroll, api],
  );
  const close = useCallback(() => {
    toggleExpanded(row.item_id, false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`tr[data-item-id="${CSS.escape(row.item_id)}"]`)?.focus(),
    );
  }, [row.item_id, toggleExpanded]);

  // a click outside: the pane closes and the focus stays where the reader clicked
  const dismiss = useCallback(() => toggleExpanded(row.item_id, false), [row.item_id, toggleExpanded]);

  // the neighbours' details arrive before they are asked for
  const lazy = payload.snapshot.detail_mode === 'lazy';
  const prevId = prev?.item_id;
  const nextId = next?.item_id;
  useEffect(() => {
    if (!lazy) return;
    const ids = [prevId, nextId].filter((x): x is string => !!x);
    if (ids.length) void details.ensure(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lazy, prevId, nextId]);

  const peek = (target: Row | undefined): PanePeek | undefined => {
    if (!target) return undefined;
    const verdict = itemVerdict(api.ctx, target, api.selectedMetric);
    const tone = verdictMark(verdict);
    return {
      number: target.index + 1,
      prompt: promptLine(target.input_full ?? target.input ?? target.input_preview),
      mark: { tone, label: verdict.label },
    };
  };

  const ctx: PaneCtx = {
    row,
    item,
    open,
    order,
    setOpen,
    trace: (pass: number) => ui.openTrace(row.item_id, pass),
  };
  const tone = verdictMark(item.verdict);
  // the header's trace action opens the first open pass; each Output of a pass has its own
  const focus = open[0] ?? item.passes[0]!.pass;
  const focusPass = item.passes.find((p) => p.pass === focus) ?? item.passes[0]!;
  const traceId = item.multi ? focusPass.scoped.trace_id : row.trace_id;
  const pending = useDelayedPending(!item.loaded);

  return (
    <PaneShell
      design={id}
      itemId={row.item_id}
      label={`Item #${row.index + 1}`}
      // remembered per design, apart for multi-pass items (their table has a column per pass)
      storageKey={`qym:item-pane:${id}:${item.multi ? 'multi' : 'single'}`}
      defaultWidth={item.multi ? (multiWidth ?? singleWidth) : singleWidth}
      minWidth={minWidth}
      // the metrics table keeps one line per metric: the pane grows to it, up to 75% of the page (I16)
      grow
      navSelector="[data-run-nav]"
      textMode={ui.textMode}
      ident={
        <>
          <span className={s.num}>#{row.index + 1}</span>
          <StateTag tone={tone}>{item.verdict.label}</StateTag>
          <span className={s.itemId} title="Item id">
            {row.item_id}
          </span>
        </>
      }
      actions={
        <>
          <Act
            label="Open trace"
            icon="trace"
            isDisabled={!traceId}
            disabledReason="No trace was recorded for this item"
            onPress={() => ui.openTrace(row.item_id, item.multi ? focus : item.model.viewPass)}
          />
          <LinkAct text={item.link} />
        </>
      }
      title={item.prompt || undefined}
      at={at}
      total={rows.length}
      prev={peek(prev)}
      next={peek(next)}
      onStep={go}
      onClose={close}
      onDismiss={dismiss}
    >
      {item.loaded ? (
        children(ctx)
      ) : item.loadError ? (
        // a failed load is never an empty state (§3 "Failed requests"): the platform error state with its Retry
        <ErrorState
          compact
          error={item.loadErrorCause}
          title="Couldn’t load this item"
          onRetry={item.retryLoad}
        />
      ) : pending ? (
        <PaneSkeleton blocks={skeleton} metricRows={item.metrics.length} />
      ) : null}
    </PaneShell>
  );
}

/** The pane of the item opened last; nothing when no item is open. */
export function Pane({ openId, rows, ...rest }: PaneProps) {
  const { model } = useRunPage();
  // the open item stays open when a live refresh takes it out of the table's rows (a filter it no longer matches,
  // I14): it is found among the run's rows, and the pager shows that it is not in the list
  const row = rows.find((r) => r.item_id === openId) ?? model.rows.find((r) => r.item_id === openId);
  return row ? <PaneItem row={row} rows={rows} {...rest} /> : null;
}
