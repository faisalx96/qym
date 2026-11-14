/* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex --
   The resize handle is the WAI-ARIA window splitter widget (as ui/SplitPane): a focusable separator that takes keys and drag. */
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
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { singleKeyShortcutsEnabled } from '@/features/runs-list/useRunsKeyboard';
import { useDelayedPending } from '@/lib/pending';
import { readLocal, writeLocal } from '@/lib/storage';
import { textDirAttrs, type TextMode } from '@/lib/text';
import { Button, Icon, Kbd, Skeleton, StateTag, type StateTagTone } from '@/ui';
import { useShellScroller } from '../../../hooks/useScrollMargin';
import { defaultPageSize } from '../../../lib/itemsPaging';
import { itemVerdict, type ItemVerdict } from '../../../lib/itemVerdict';
import { verdictTone } from '../../../lib/verdictMark';
import { useRunPage } from '../../../RunContext';
import type { Row } from '../../../types';
import pager from '../../RunPager.module.css';
import { useItemsUi } from '../ItemsUi';
import { Act, CopyTile } from './actions';
import { firstBadPass, promptLine, useItem, type ItemData } from './model';
import { PaneTextMode } from './values';
import s from './pane.module.css';

const PAGE_SIZES = [20, 50, 100, 500];
/** At its default width the pane leaves this much of the table in view (the row number and the status). */
const TABLE_IN_VIEW = 240;

/** A block of the loading frame, in the design's own order. */
export type SkeletonBlock = 'metrics' | 'input' | 'expected' | 'output' | 'pair';

/** The StateTag tone of an item verdict (an item result is the result of a check, as the Items table shows it). */
export function verdictMark(v: ItemVerdict): StateTagTone {
  return v.kind === 'aggregate' ? (v.tone ?? 'warning') : verdictTone(v.kind);
}

export interface PaneCtx {
  row: Row;
  item: ItemData;
  /** The pass in view (multi-pass items). */
  focus: number;
  setFocus: (pass: number) => void;
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
export function LinkTile({ text }: { text: string }) {
  return <CopyTile text={text} label="Copy link" icon="link" />;
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

/** The loading frame: the design's own blocks with bones in them, so the content arrives in place. */
export function PaneSkeleton({ blocks }: { blocks: SkeletonBlock[] }) {
  const block = (kind: Exclude<SkeletonBlock, 'pair'>, key: string) => {
    const [label, rows, tone] = (
      {
        metrics: ['Loading metrics', 4, 'neutral'],
        input: ['Loading input', 3, 'info'],
        expected: ['Loading expected output', 3, 'gold'],
        output: ['Loading output', 3, 'neutral'],
      } as const
    )[kind];
    return (
      <section key={key} className={s.block} data-tone={tone} aria-hidden="true">
        <header className={s.blockHead}>
          <Skeleton kind="value" width={72} label={label} />
        </header>
        <div className={s.blockBody}>
          <Skeleton kind="lines" rows={rows} label={label} />
        </div>
      </section>
    );
  };
  return (
    <div className={s.skeleton} aria-busy="true" aria-label="Loading item">
      {blocks.map((b, i) =>
        b === 'pair' ? (
          <div key={i} className={s.pair}>
            {block('expected', 'e')}
            {block('output', 'o')}
          </div>
        ) : (
          block(b, String(i))
        ),
      )}
    </div>
  );
}

const NOT_FOR_KEYS =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="dialog"], dialog';
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
  children,
}: PaneShellProps) {
  const scroller = useShellScroller();
  const box = usePaneBox(scroller, navSelector);
  const viewport = useViewportWidth();
  const bodyRef = useRef<HTMLDivElement>(null);

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
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const el = event.target as HTMLElement | null;
      if (el?.closest?.(NOT_FOR_KEYS) || modalOpen()) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ---- the open row reads as selected while a pane shows it
  useEffect(() => {
    document.body.dataset.itemPane = 'overlay';
    return () => {
      delete document.body.dataset.itemPane;
    };
  }, []);

  // a new item starts at its top
  useLayoutEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0;
  }, [itemId]);

  // ---- width: as wide as the content needs. The default leaves the start of the list in view; the header button
  // takes the whole page width and gives it back; drag, arrow keys and double click (reset) do the fine work.
  const maxWidth = Math.max(minWidth, viewport - box.start);
  const defaultWidth = clamp(wantedWidth, minWidth, maxWidth - TABLE_IN_VIEW);
  const [stored, setStored] = useState<{ key: string; value: number | null }>(() => ({
    key: '',
    value: null,
  }));
  const storedValue = (() => {
    if (stored.key === storageKey) return stored.value;
    const n = Number(readLocal(storageKey));
    return Number.isFinite(n) && n > 0 ? n : null;
  })();
  const width = clamp(storedValue ?? defaultWidth, Math.min(minWidth, maxWidth), maxWidth);
  const full = width >= maxWidth - 8;
  const dragging = useRef(false);
  const setWidth = (n: number | null, persist: boolean) => {
    const value = n === null ? null : clamp(Math.round(n), minWidth, maxWidth);
    setStored({ key: storageKey, value });
    if (persist) writeLocal(storageKey, value === null ? null : String(value));
  };
  const onResizeKey = (e: ReactKeyboardEvent) => {
    const step = e.key === 'ArrowLeft' ? 16 : e.key === 'ArrowRight' ? -16 : 0;
    if (step) setWidth(width + step, true);
    else if (e.key === 'Home') setWidth(maxWidth, true);
    else if (e.key === 'End') setWidth(minWidth, true);
    else return;
    e.preventDefault();
  };
  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragging.current) setWidth(window.innerWidth - e.clientX, false);
  };
  const onResizeUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setWidth(window.innerWidth - e.clientX, true);
  };

  const pane = (
    <aside
      className={s.pane}
      data-pane="overlay"
      data-design={design}
      data-full={full ? '' : undefined}
      data-testid="item-pane"
      data-item-id={itemId}
      aria-label={label}
      style={{ top: box.top, width }}
    >
      <div
        className={s.resizer}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the item pane"
        aria-valuenow={width}
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        tabIndex={0}
        onKeyDown={onResizeKey}
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeUp}
        onDoubleClick={() => setWidth(null, true)}
      />
      <header className={s.head}>
        <div className={s.headRow}>
          <div className={s.ident}>{ident}</div>
          <div className={s.headActions}>
            {actions}
            <Act
              label={full ? 'Give the list its room back' : 'Use the full page width'}
              icon={full ? 'collapse' : 'expand'}
              aria-pressed={full}
              onPress={() => setWidth(full ? null : maxWidth, true)}
            />
            <nav className={pager.pager} aria-label="Previous and next item">
              <Step which="previous" target={prev} onGo={() => onStep('previous')} />
              <span className={pager.pos}>
                <span className={pager.num}>{at + 1}</span> of {total.toLocaleString('en-US')}
              </span>
              <Step which="next" target={next} onGo={() => onStep('next')} />
            </nav>
            <Act tone="danger" label="Close item" icon="close" onPress={onClose} />
          </div>
        </div>
        {title ? (
          <h3 className={s.title} {...textDirAttrs(title)}>
            {title}
          </h3>
        ) : null}
      </header>
      <div ref={bodyRef} className={s.body}>
        <PaneTextMode.Provider value={textMode}>{children}</PaneTextMode.Provider>
      </div>
    </aside>
  );
  return createPortal(pane, document.body);
}

function PaneItem({
  row,
  rows,
  id,
  width: singleWidth,
  multiWidth,
  minWidth = 480,
  skeleton,
  children,
}: Omit<PaneProps, 'openId'> & { row: Row }) {
  const item = useItem(row);
  const ui = useItemsUi();
  const { api, payload } = useRunPage();

  // ---- one item at a time: a new row replaces the open one
  const { expanded, toggleExpanded, details, requestScroll } = ui;
  useEffect(() => {
    for (const other of expanded) if (other !== row.item_id) toggleExpanded(other, false);
  }, [expanded, row.item_id, toggleExpanded]);

  // ---- the pass in view belongs to one item: a new item opens on its own first failed pass
  const [pick, setPick] = useState<{ id: string; pass: number } | null>(null);
  const focus = pick?.id === row.item_id ? pick.pass : firstBadPass(item.passes);
  const setFocus = useCallback((pass: number) => setPick({ id: row.item_id, pass }), [row.item_id]);

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
      toggleExpanded(row.item_id, false);
      toggleExpanded(target.item_id, true);
      requestScroll(target.item_id);
    },
    [rows, row.item_id, next, prev, toggleExpanded, requestScroll, api],
  );
  const close = useCallback(() => {
    toggleExpanded(row.item_id, false);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`tr[data-item-id="${CSS.escape(row.item_id)}"]`)?.focus(),
    );
  }, [row.item_id, toggleExpanded]);

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

  const ctx: PaneCtx = { row, item, focus, setFocus };
  const tone = verdictMark(item.verdict);
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
          <LinkTile text={item.link} />
        </>
      }
      title={item.prompt || undefined}
      at={at}
      total={rows.length}
      prev={peek(prev)}
      next={peek(next)}
      onStep={go}
      onClose={close}
    >
      {item.loaded ? (
        children(ctx)
      ) : item.loadError ? (
        <div className={s.loadError} role="alert">
          <p className={s.note}>Couldn’t load this item.</p>
          <div>
            <Button size="sm" variant="neutral" onPress={item.retryLoad}>
              Retry
            </Button>
          </div>
        </div>
      ) : pending ? (
        <PaneSkeleton blocks={skeleton} />
      ) : null}
    </PaneShell>
  );
}

/** The pane of the item opened last; nothing when no item is open. */
export function Pane({ openId, rows, ...rest }: PaneProps) {
  const row = rows.find((r) => r.item_id === openId);
  return row ? <PaneItem row={row} rows={rows} {...rest} /> : null;
}
