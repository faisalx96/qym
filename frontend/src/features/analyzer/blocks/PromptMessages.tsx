import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type Ref,
  type RefObject,
} from 'react';
import { BarTrigger, CopyButton, DropdownMenu, Eyebrow, SegmentedControl, type MenuItemSpec } from '@/ui';
import type { SectionNote } from '../model/contents';
import type { LineChange } from '../model/promptDiff';
import { parsePrompt, type PromptDoc } from '../model/promptDoc';
import { locationOf, messageOutline, stateText, type OutlineGroup, type OutlineRow } from '../model/outline';
import { PromptDocument } from './PromptDocument';
import s from './promptDoc.module.css';
import pane from './pane.module.css';

export type PromptView = 'rendered' | 'raw';
const VIEW_KEY = 'qym:prompt-view';

function readView(): PromptView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'raw' ? 'raw' : 'rendered';
  } catch {
    return 'rendered';
  }
}

/** Rendered or Raw, remembered for the person (the pane and the drawer share it). */
export function usePromptView() {
  const [view, setView] = useState<PromptView>(readView);
  const update = useCallback((next: PromptView) => {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_KEY, next);
    } catch {
      /* storage can be blocked: the choice lasts for this page only */
    }
  }, []);
  return [view, update] as const;
}

export function PromptViewSwitch({ view, onView }: { view: PromptView; onView: (view: PromptView) => void }) {
  return (
    <SegmentedControl
      label="Prompt view"
      value={view}
      onChange={onView}
      options={[
        { value: 'rendered', label: 'Rendered' },
        { value: 'raw', label: 'Raw' },
      ]}
    />
  );
}

interface Message {
  role: string;
  content: string;
}

/** The nearest ancestor that scrolls (the pane's scroll region, or the drawer body). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return null;
}

/** The outline form: a rail at the start of a wide pane, else one location line that opens a menu. */
export type OutlineForm = 'rail' | 'menu';

/** The width of the messages area (the pane less its padding) from which the outline is a rail (a pane of about 720px). */
export const RAIL_FROM = 600;
/** Space between the sticky outline (or the scroller's top) and a section that a jump brings into view. */
const JUMP_GAP = 8;

const NO_NOTES: SectionNote[] = [];
const rowKey = (row: OutlineRow) => `${row.message}:${row.id}`;

/**
 * The outline form for the width of the messages area. A fixed `form` wins (the drawer is always the menu). The
 * width is read before paint and on each resize, so the form never flashes; the rail's height follows the scroller.
 */
function useOutlineForm(ref: RefObject<HTMLDivElement | null>, fixed: OutlineForm | 'auto') {
  const [form, setForm] = useState<OutlineForm>(fixed === 'auto' ? 'menu' : fixed);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const root = scrollParent(el);
    const read = () => {
      if (fixed === 'auto') setForm(el.clientWidth >= RAIL_FROM ? 'rail' : 'menu');
      else setForm(fixed);
      if (root) {
        const cs = getComputedStyle(root);
        const room =
          root.clientHeight - parseFloat(cs.paddingTop || '0') - parseFloat(cs.paddingBottom || '0');
        el.style.setProperty('--rail-max', `${Math.max(0, Math.floor(room))}px`);
      }
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    if (root) ro.observe(root);
    return () => ro.disconnect();
  }, [ref, fixed]);
  return form;
}

/**
 * The prompt messages, Rendered (a document with an outline to jump through) or Raw (the exact text, mono). The Copy
 * actions always copy the exact raw text. The change marks of the last settings change show in both views.
 *
 * The outline (cv5 N, owner 2026-11-14: "this navbar sucks!!") is one tree: message → section → part of the item data.
 * A wide pane shows it as a sticky rail at the start of the body (the section in view in the accent with a 2px start
 * bar); a narrow pane and the drawer show one location line ("System · Item data · Input") that opens the same tree as
 * a menu. A section that is not in the prompt keeps its row ("not sent" / "none") and one quiet line in the document.
 */
export function PromptMessages({
  messages,
  view,
  change,
  peek = null,
  notes = NO_NOTES,
  form: fixedForm = 'auto',
}: {
  messages: Message[];
  view: PromptView;
  change: LineChange | null;
  /** cv5 Q4: the section keys of a hovered or focused Prompt contents switch (marked, and brought into view). */
  peek?: string[] | null;
  /** cv5 Q4: the sections of the switches, to say "not sent" or "none" in the outline and the document. */
  notes?: SectionNote[];
  /** cv5 N: 'auto' = a rail from RAIL_FROM px of width, else the menu; the drawer passes 'menu'. */
  form?: OutlineForm | 'auto';
}) {
  const base = useId().replace(/:/g, '');
  const docs = useMemo<PromptDoc[]>(() => messages.map((m) => parsePrompt(m.content)), [messages]);
  const [jump, setJump] = useState<{ ids: ReadonlySet<string>; n: number } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const layout = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLElement>(null);
  const form = useOutlineForm(layout, fixedForm);
  const rendered = view === 'rendered';
  const prefix = (i: number) => `${base}-m${i}-`;

  const outlines = useMemo(
    () =>
      docs.map((doc, i) =>
        messageOutline(
          doc,
          i,
          messages[i]?.role ?? '',
          notes.filter((n) => n.message === Math.min(i, 1)),
          change?.added[i],
        ),
      ),
    [docs, messages, notes, change],
  );
  const groups = useMemo(() => outlines.map((o) => o.group), [outlines]);
  const rows = useMemo(() => groups.flatMap((g) => g.rows), [groups]);
  const peekSet = useMemo(() => (peek ? new Set(peek) : null), [peek]);
  const activeRow = rows.find((r) => rowKey(r) === active) ?? rows[0] ?? null;
  const trail = activeRow?.parent ? `${activeRow.message}:${activeRow.parent}` : null;

  /** The height that the sticky location line covers at the top of the scroller. */
  const covered = () => (form === 'menu' ? (bar.current?.offsetHeight ?? 0) : 0);

  // cv5 Q4: a peeked section that is out of view comes into view (no animation)
  useEffect(() => {
    if (!peekSet || !rendered) return;
    const root = scrollParent(layout.current);
    if (!root || !layout.current) return;
    const el = [...layout.current.querySelectorAll<HTMLElement>('[data-key]')].find((n) =>
      peekSet.has(n.dataset.key ?? ''),
    );
    if (!el) return;
    const box = root.getBoundingClientRect();
    const top = box.top + (form === 'menu' ? (bar.current?.offsetHeight ?? 0) : 0) + JUMP_GAP;
    const r = el.getBoundingClientRect();
    if (r.top < top || r.top > box.bottom - 48) root.scrollTop += r.top - top;
  }, [peekSet, rendered, form]);

  const go = (row: OutlineRow) => {
    setJump((j) => ({ ids: new Set(row.path), n: (j?.n ?? 0) + 1 }));
    // after the sections on the path open
    requestAnimationFrame(() => {
      const el = document.getElementById(`${prefix(row.message)}${row.id}`);
      const root = scrollParent(el);
      if (!el || !root) return;
      root.scrollTop +=
        el.getBoundingClientRect().top - root.getBoundingClientRect().top - covered() - JUMP_GAP;
    });
  };

  // The section in view is the outline's current row (read on scroll, one frame at a time).
  useEffect(() => {
    if (!rendered) return undefined;
    const root = scrollParent(layout.current);
    if (!root) return undefined;
    let frame = 0;
    const read = () => {
      frame = 0;
      const box = root.getBoundingClientRect();
      // at the end of the scroll the last section in view is the current one, though its top cannot reach the line
      const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
      const line = atEnd ? box.bottom - 24 : box.top + covered() + 16;
      let current: string | null = null;
      for (const r of rows) {
        const el = document.getElementById(`${prefix(r.message)}${r.id}`);
        if (el && el.getBoundingClientRect().top <= line) current = rowKey(r);
      }
      setActive(current);
      // the location line draws its hairline only while text runs under it
      if (bar.current) bar.current.toggleAttribute('data-scrolled', root.scrollTop > 0);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      root.removeEventListener('scroll', onScroll);
    };
    // prefix is stable (useId); covered() reads the form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, rendered, form]);

  // the rail keeps the current row in its own view (no animation)
  useEffect(() => {
    const nav = rail.current;
    const row = nav?.querySelector<HTMLElement>('[aria-current]');
    if (!nav || !row) return;
    const top = row.offsetTop - nav.offsetTop;
    if (top < nav.scrollTop) nav.scrollTop = top;
    else if (top + row.offsetHeight > nav.scrollTop + nav.clientHeight)
      nav.scrollTop = top + row.offsetHeight - nav.clientHeight;
  }, [active, form]);

  return (
    <div
      ref={layout}
      className={s.prompt}
      data-form={rendered ? form : undefined}
      data-testid="prompt-messages"
    >
      {rendered && form === 'rail' ? (
        <OutlineRail
          navRef={rail}
          base={base}
          groups={groups}
          active={activeRow ? rowKey(activeRow) : null}
          trail={trail}
          peek={peekSet}
          onGo={go}
        />
      ) : null}
      {rendered && form === 'menu' && activeRow ? (
        <div ref={bar} className={s.locationBar} data-outline-bar="">
          <OutlineMenu groups={groups} active={activeRow} onGo={go} />
        </div>
      ) : null}
      <div className={s.messages}>
        {messages.map((m, i) => (
          <article key={i} className={pane.message} id={`${prefix(i)}top`}>
            <header className={pane.messageHead}>
              <Eyebrow tone={m.role === 'system' ? 'accent' : 'muted'}>{m.role}</Eyebrow>
              <CopyButton text={m.content} label={`Copy ${m.role} message`} />
            </header>
            {rendered ? (
              <PromptDocument
                doc={docs[i]!}
                added={change?.added[i]}
                change={change}
                jump={jump}
                prefix={prefix(i)}
                peek={peekSet}
                notes={outlines[i]?.notes}
              />
            ) : (
              <RawBody content={m.content} added={change?.added[i]} />
            )}
          </article>
        ))}
      </div>
    </div>
  );
}

/** The quiet end of a row: the change dot, then "not sent" / "none". */
function RowEnd({ row }: { row: OutlineRow }) {
  if (!row.changed && !row.state) return null;
  return (
    <>
      {row.changed ? <span className={s.changeDot} role="img" aria-label="changed" /> : null}
      {row.state ? <span className={s.rowState}>{stateText(row.state)}</span> : null}
    </>
  );
}

/**
 * The wide form: a slim sticky rail at the start of the pane body. The message names are quiet group labels; the
 * sections hang on one hairline track, the parts of the item data indented under it; the section in view takes the
 * accent and a 2px start bar on the track, its parent section the primary text. Up / Down / Home / End move the focus.
 */
function OutlineRail({
  navRef,
  base,
  groups,
  active,
  trail,
  peek,
  onGo,
}: {
  navRef: Ref<HTMLElement>;
  base: string;
  groups: OutlineGroup[];
  active: string | null;
  trail: string | null;
  peek: ReadonlySet<string> | null;
  onGo: (row: OutlineRow) => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    e.preventDefault();
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? buttons.length - 1
          : Math.min(buttons.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)));
    buttons[next]?.focus();
  };
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- arrow keys move between its buttons
    <nav ref={navRef} className={s.rail} aria-label="Prompt sections" onKeyDown={onKeyDown}>
      {groups.map((g) => (
        <div key={g.message} className={s.railGroup}>
          <p className={s.railName} id={`${base}-g${g.message}`}>
            {g.name}
          </p>
          <ul className={s.railList} aria-labelledby={`${base}-g${g.message}`}>
            {g.rows.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={s.railRow}
                  data-depth={r.depth}
                  data-state={r.state ?? undefined}
                  data-trail={trail === rowKey(r) ? '' : undefined}
                  data-peek={r.key && peek?.has(r.key) ? '' : undefined}
                  aria-current={active === rowKey(r) ? 'location' : undefined}
                  onClick={() => onGo(r)}
                >
                  <span className={s.railLabel}>{r.label}</span>
                  <RowEnd row={r} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/**
 * The narrow form (a narrow pane, the drawer): one line, the current location as the dropdown trigger
 * ("System · Item data · Input"), which opens the same tree in the shared menu, the current row checked.
 */
function OutlineMenu({
  groups,
  active,
  onGo,
}: {
  groups: OutlineGroup[];
  active: OutlineRow;
  onGo: (row: OutlineRow) => void;
}) {
  const group = groups.find((g) => g.message === active.message) ?? groups[0]!;
  const [name, ...path] = locationOf(group, active);
  const items: MenuItemSpec[] = groups.flatMap((g) =>
    g.rows.map((r) => ({
      id: rowKey(r),
      label: r.state ? <span className={s.mutedLabel}>{r.label}</span> : r.label,
      textValue: r.label,
      group: g.name,
      level: r.depth,
      end: r.changed || r.state ? <RowEnd row={r} /> : undefined,
    })),
  );
  const byKey = new Map(groups.flatMap((g) => g.rows.map((r) => [rowKey(r), r] as const)));
  return (
    <nav aria-label="Prompt sections" className={s.location}>
      <DropdownMenu
        label="Prompt sections"
        placement="bottom start"
        selectedId={rowKey(active)}
        items={items}
        onAction={(id) => {
          const row = byKey.get(id);
          if (row) onGo(row);
        }}
        trigger={<BarTrigger label={name ?? ''} value={path.join(' · ')} data-show-value="" />}
      />
    </nav>
  );
}

/** The exact text, mono; the lines that the last change added are marked. */
export function RawBody({ content, added }: { content: string; added: ReadonlySet<number> | undefined }) {
  if (!added?.size) {
    return (
      <pre className={pane.body} dir="auto">
        {content}
      </pre>
    );
  }
  return (
    <pre className={pane.body} dir="auto">
      {content.split('\n').map((line, i) => (
        <span key={i} className={pane.line} data-added={added.has(i) ? '' : undefined}>
          {line}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}
