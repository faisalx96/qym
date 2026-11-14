import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { CopyButton, Eyebrow, SegmentedControl } from '@/ui';
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

/**
 * The prompt messages, Rendered (a document with an outline to jump through) or Raw (the exact text, mono). The Copy
 * actions always copy the exact raw text. The change marks of the last settings change show in both views.
 */
export function PromptMessages({
  messages,
  view,
  change,
}: {
  messages: Message[];
  view: PromptView;
  change: LineChange | null;
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
        const first =
          lead && lead.kind !== 'section'
            ? [{ id: 'top', label: i === 0 ? 'Instructions' : 'Message', key: null, depth: 0 as const, path: [] }]
            : [];
        return [...first, ...list.map((e, n) => ({ ...e, path: pathOf(list, n) }))];
      }),
    [docs],
  );

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
              {list.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  className={s.outlineLink}
                  data-depth={e.depth}
                  aria-current={active === `${i}:${e.id}` ? 'location' : undefined}
                  onClick={() => go(i, e.id, e.path)}
                >
                  {e.label}
                </button>
              ))}
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
            <PromptDocument doc={docs[i]!} added={change?.added[i]} change={change} jump={jump} prefix={prefix(i)} />
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
