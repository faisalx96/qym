import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CopyButton, Eyebrow, SegmentedControl } from '@/ui';
import type { SectionNote } from '../model/contents';
import type { LineChange } from '../model/promptDiff';
import { outline, parsePrompt, type PromptDoc } from '../model/promptDoc';
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

const roleName = (role: string) => role.charAt(0).toUpperCase() + role.slice(1);

/** The builder's order of the sections (`build_analysis_prompt`), to place a section that is not sent. */
const ORDER = [
  'ANALYSIS RULES',
  'EVALUATION ITEM DATA',
  'INPUT',
  'EXPECTED OUTPUT',
  'ACTUAL OUTPUT',
  'ERROR',
  'TRACE EVIDENCE',
  'SELECTED METRIC RESULT',
  'ITEM METADATA',
  'SELECTED METRIC METADATA',
  'SELECTED METADATA',
  'RESPONSE FORMAT',
  'REFERENCE DOCUMENTS',
];

const NO_NOTES: SectionNote[] = [];

interface Entry {
  id: string;
  label: string;
  key: string | null;
  depth: 0 | 1;
  path: string[];
  /** cv5 Q4: "off" = its switch is off (not sent); "empty" = on, but this target has none. */
  state?: 'off' | 'empty';
}

/** The outline entries of a message, with the switched-off and empty sections at their place (cv5 Q4). */
function withNotes(list: Entry[], notes: SectionNote[]): Entry[] {
  const present = new Set(list.map((e) => e.key));
  const out = list.map((e) => {
    const note = notes.find((n) => n.key === e.key || (n.key === 'SELECTED METRIC METADATA' && e.key === 'SELECTED METADATA'));
    return note?.state === 'off' ? { ...e, state: 'off' as const } : e;
  });
  // rank: the builder's order; a section of a custom template keeps its place after the one before it
  let last = -1;
  const ranked = out.map((e) => {
    const r = e.key ? ORDER.indexOf(e.key) : -1;
    last = r >= 0 ? r : e.id === 'top' ? -1 : last + 0.001;
    return { e, rank: last };
  });
  for (const n of notes) {
    if (present.has(n.key) || (n.key === 'SELECTED METRIC METADATA' && present.has('SELECTED METADATA'))) continue;
    ranked.push({
      e: { id: `note-${n.key}`, label: n.label, key: n.key, depth: n.parent ? 1 : 0, path: [], state: n.state },
      rank: ORDER.indexOf(n.key),
    });
  }
  return ranked.sort((a, b) => a.rank - b.rank).map((r) => r.e);
}

/**
 * The prompt messages, Rendered (a document with an outline to jump through) or Raw (the exact text, mono). The Copy
 * actions always copy the exact raw text. The change marks of the last settings change show in both views.
 */
export function PromptMessages({
  messages,
  view,
  change,
  peek = null,
  notes = NO_NOTES,
}: {
  messages: Message[];
  view: PromptView;
  change: LineChange | null;
  /** cv5 Q4: the section keys of a hovered or focused Prompt contents switch (marked, and brought into view). */
  peek?: string[] | null;
  /** cv5 Q4: the sections of the switches, to say "not sent" or "none" in the outline. */
  notes?: SectionNote[];
}) {
  const base = useId().replace(/:/g, '');
  const docs = useMemo<PromptDoc[]>(() => messages.map((m) => parsePrompt(m.content)), [messages]);
  const [jump, setJump] = useState<{ ids: ReadonlySet<string>; n: number } | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const nav = useRef<HTMLElement>(null);
  const prefix = (i: number) => `${base}-m${i}-`;

  const entries = useMemo(
    () =>
      docs.map((doc, i) => {
        const list = outline(doc);
        const lead = doc.blocks.find((b) => b.kind !== 'blank');
        const first: Entry[] =
          // the system message's opening prose; the user message's closing line needs no entry
          i === 0 && lead && lead.kind !== 'section'
            ? [{ id: 'top', label: 'Instructions', key: null, depth: 0, path: [] }]
            : [];
        const own = notes.filter((n) => n.message === Math.min(i, 1));
        return withNotes([...first, ...list.map((e, n) => ({ ...e, path: pathOf(list, n) }))], own);
      }),
    [docs, notes],
  );
  const peekSet = useMemo(() => (peek ? new Set(peek) : null), [peek]);

  // cv5 Q4: a peeked section that is out of view comes into view (no animation)
  useEffect(() => {
    if (!peekSet || view !== 'rendered') return;
    const root = scrollParent(nav.current);
    if (!root) return;
    const el = [...root.querySelectorAll<HTMLElement>('section[data-key]')].find((n) =>
      peekSet.has(n.dataset.key ?? ''),
    );
    if (!el) return;
    const box = root.getBoundingClientRect();
    const top = box.top + (nav.current?.offsetHeight ?? 0) + 8;
    const r = el.getBoundingClientRect();
    if (r.top < top || r.top > box.bottom - 48) root.scrollTop += r.top - top;
  }, [peekSet, view]);

  const go = (i: number, id: string, path: string[]) => {
    setJump((j) => ({ ids: new Set(path), n: (j?.n ?? 0) + 1 }));
    // after the sections on the path open
    requestAnimationFrame(() => {
      const el = document.getElementById(`${prefix(i)}${id}`);
      const root = scrollParent(el);
      if (!el || !root) return;
      const offset = (nav.current?.offsetHeight ?? 0) + 8;
      root.scrollTop += el.getBoundingClientRect().top - root.getBoundingClientRect().top - offset;
    });
  };

  // The section in view is the outline's current entry (read on scroll, one frame at a time).
  useEffect(() => {
    if (view !== 'rendered') return undefined;
    const root = scrollParent(nav.current);
    if (!root) return undefined;
    let frame = 0;
    const read = () => {
      frame = 0;
      const box = root.getBoundingClientRect();
      // at the end of the scroll the last section in view is the current one, though its top cannot reach the line
      const atEnd = root.scrollTop + root.clientHeight >= root.scrollHeight - 2;
      const line = atEnd ? box.bottom - 24 : box.top + (nav.current?.offsetHeight ?? 0) + 16;
      let current: string | null = null;
      entries.forEach((list, i) =>
        list.forEach((e) => {
          if (e.id.startsWith('note-')) return;
          const el = document.getElementById(`${prefix(i)}${e.id}`);
          if (el && el.getBoundingClientRect().top <= line) current = `${i}:${e.id}`;
        }),
      );
      setActive(current);
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
    // prefix is stable (useId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, view]);

  return (
    <>
      {view === 'rendered' ? (
        <nav ref={nav} className={s.outline} aria-label="Prompt sections">
          {entries.map((list, i) => (
            <div key={i} className={s.outlineGroup}>
              <span className={s.outlineRole}>{roleName(messages[i]?.role ?? '')}</span>
              {list.map((e) =>
                e.state && e.id.startsWith('note-') ? (
                  // a section that is not in this prompt: said, not silently missing (cv5 Q4)
                  <span
                    key={e.id}
                    className={s.outlineNote}
                    data-depth={e.depth}
                    data-peek={e.key && peekSet?.has(e.key) ? '' : undefined}
                  >
                    {e.label}
                    <span className={s.outlineState}>{e.state === 'off' ? 'not sent' : 'none'}</span>
                  </span>
                ) : (
                  <button
                    key={e.id}
                    type="button"
                    className={s.outlineLink}
                    data-depth={e.depth}
                    data-peek={e.key && peekSet?.has(e.key) ? '' : undefined}
                    aria-current={active === `${i}:${e.id}` ? 'location' : undefined}
                    onClick={() => go(i, e.id, e.path)}
                  >
                    {e.label}
                    {e.state === 'off' ? <span className={s.outlineState}>not sent</span> : null}
                  </button>
                ),
              )}
            </div>
          ))}
        </nav>
      ) : null}
      {messages.map((m, i) => (
        <article key={i} className={pane.message} id={`${prefix(i)}top`}>
          <header className={pane.messageHead}>
            <Eyebrow tone={m.role === 'system' ? 'accent' : 'muted'}>{m.role}</Eyebrow>
            <CopyButton text={m.content} label={`Copy ${m.role} message`} />
          </header>
          {view === 'rendered' ? (
            <PromptDocument
              doc={docs[i]!}
              added={change?.added[i]}
              change={change}
              jump={jump}
              prefix={prefix(i)}
              peek={peekSet}
            />
          ) : (
            <RawBody content={m.content} added={change?.added[i]} />
          )}
        </article>
      ))}
    </>
  );
}

/** The outline entry's section and the sections around it (a part of the item data opens the item data too). */
function pathOf(list: ReturnType<typeof outline>, n: number): string[] {
  const entry = list[n]!;
  if (entry.depth === 0) return [entry.id];
  for (let k = n - 1; k >= 0; k -= 1) if (list[k]!.depth === 0) return [list[k]!.id, entry.id];
  return [entry.id];
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
