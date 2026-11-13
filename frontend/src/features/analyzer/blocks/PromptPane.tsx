import { useLayoutEffect, useRef, useState } from 'react';
import { Button, CopyButton, EmptyState, ErrorState, Eyebrow, Select, Skeleton, Tag, Text } from '@/ui';
import { APP_LOCALE } from '@/lib/dates';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import { changedLines, type LineChange } from '../model/promptDiff';
import s from './pane.module.css';

/** Space between the pane and the bottom of the viewport (the action rail's button line). */
const PANE_BOTTOM_GAP = 12;
const PANE_MIN_HEIGHT = 360;

/** The options of the previewed-target select: "item · metric score" for each target in the list. */
export function targetItems(ws: RunWorkspace) {
  return ws.allKeys.map((k) => {
    const [itemId = '', metric = ''] = k.split('\u0000');
    const score = ws.rowById.get(itemId)?.metric_scores[metric];
    return { key: k, label: `${itemId} · ${metric}${score != null ? ` ${score.toFixed(2)}` : ''}` };
  });
}

/** The pane reaches from its top to the bottom of the viewport (as the dataset item pane, cv4 E7). */
function useFitHeight() {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let frame = 0;
    let last = -1;
    const fit = () => {
      frame = 0;
      const top = Math.max(0, el.getBoundingClientRect().top);
      const height = Math.max(PANE_MIN_HEIGHT, Math.floor(window.innerHeight - top - PANE_BOTTOM_GAP));
      if (height === last) return;
      last = height;
      el.style.setProperty('--pane-height', `${height}px`);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(fit);
    };
    fit();
    window.addEventListener('resize', schedule);
    // the page scrolls in a layout element, not the window: listen in the capture phase
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, { capture: true });
    };
  }, []);
  return ref;
}

interface Messages {
  key: string | null;
  messages: { role: string; content: string }[];
}

/**
 * What the last settings change did to the prompt: the lines it added (marked in the text) and the count it removed.
 * Kept until the next change; a new target starts clean (another target is not a change of the settings).
 */
function useChanges(key: string | null, messages: Messages['messages'], pending: boolean) {
  const [state, setState] = useState<{ base: Messages; change: LineChange | null }>({
    base: { key, messages },
    change: null,
  });
  // `messages` is the query's own array (stable until new data arrives); an empty list is never a base.
  if (!pending && messages.length > 0 && messages !== state.base.messages) {
    const sameTarget = state.base.key === key && state.base.messages.length > 0;
    setState({
      base: { key, messages },
      change: sameTarget ? changedLines(state.base.messages, messages) : null,
    });
  }
  return state.change;
}

function MessageBody({ content, added }: { content: string; added: ReadonlySet<number> | undefined }) {
  if (!added?.size) {
    return (
      <pre className={s.body} dir="auto">
        {content}
      </pre>
    );
  }
  return (
    <pre className={s.body} dir="auto">
      {content.split('\n').map((line, i) => (
        <span key={i} className={s.line} data-added={added.has(i) ? '' : undefined}>
          {line}
          {'\n'}
        </span>
      ))}
    </pre>
  );
}

/**
 * The prompt preview as a fixed pane next to the settings (cv5 K3, owner: "the prompt is always open on the right
 * ... because I want to see what these impact"). Sticky under the page header with its own scroll. It follows every
 * setting on the left; while an update is on its way the text stays in place, slightly dimmed, and the head says
 * "Updating". The lines that the last change added are marked, and the head counts what it added and removed.
 */
export function PromptPane({ ws }: { ws: RunWorkspace }) {
  const ref = useFitHeight();
  const scroller = useRef<HTMLDivElement>(null);
  const { preview } = ws;
  const items = targetItems(ws);
  const change = useChanges(ws.focusKey, preview.messages, preview.pending);
  const firstAdded = change?.added.findIndex((set) => set.size > 0) ?? -1;

  const showChange = () => {
    const root = scroller.current;
    const line = root?.querySelector<HTMLElement>('[data-added]');
    if (!root || !line) return;
    root.scrollTop += line.getBoundingClientRect().top - root.getBoundingClientRect().top - 48;
  };

  return (
    <aside ref={ref} className={s.pane} aria-label="Prompt preview" data-testid="prompt-pane">
      <header className={s.head}>
        <div className={s.titleRow}>
          <Text as="h2" variant="md" weight={650}>
            Prompt preview
          </Text>
          <span className={s.chars}>
            {preview.characters != null ? (
              <Tag kind="count" aria-label={`${preview.characters} characters`}>
                {`${preview.characters.toLocaleString(APP_LOCALE)} chars`}
              </Tag>
            ) : null}
          </span>
          <Text variant="sm" tone="muted" as="span" role="status" aria-live="polite" className={s.status}>
            {preview.pending ? 'Updating' : change ? changeText(change) : ''}
          </Text>
          {!preview.pending && firstAdded >= 0 ? (
            <Button size="sm" onPress={showChange}>
              Show change
            </Button>
          ) : null}
          {preview.messages.length ? (
            <CopyButton
              text={() => preview.messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n')}
              label="Copy prompt"
            />
          ) : null}
        </div>
        {/* The label before the control, as "Metrics" before its chips; a target has no default, so no "changed" tint. */}
        <div className={s.targetRow}>
          <Text variant="sm" weight={600} tone="muted" as="span" aria-hidden="true">
            Target
          </Text>
          <Select
            label="Previewed target"
            hideLabel
            items={items}
            value={ws.focusKey}
            onChange={(k) => k != null && ws.setFocusKey(String(k))}
            isDisabled={items.length === 0}
            placeholder="No targets"
            searchable="auto"
            width={320}
          />
        </div>
      </header>
      <div
        ref={scroller}
        className={s.scroll}
        data-pending={preview.pending && preview.messages.length ? '' : undefined}
        // Scrollable region: focusable so keyboard users can scroll it.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        role="region"
        aria-label="Prompt messages"
      >
        {!preview.hasTarget ? (
          <EmptyState
            compact
            title="Nothing to preview"
            body="This run has no target at the current settings. Change the metrics or the max score to see a prompt."
          />
        ) : preview.error ? (
          <ErrorState
            error={preview.error}
            title="Couldn’t build the prompt preview"
            onRetry={preview.retry}
            compact
          />
        ) : preview.messages.length === 0 ? (
          <Skeleton kind="lines" rows={12} label="Building prompt preview" />
        ) : (
          preview.messages.map((m, i) => (
            <article key={i} className={s.message}>
              <header className={s.messageHead}>
                <Eyebrow tone={m.role === 'system' ? 'accent' : 'muted'}>{m.role}</Eyebrow>
                <CopyButton text={m.content} label={`Copy ${m.role} message`} />
              </header>
              <MessageBody content={m.content} added={change?.added[i]} />
            </article>
          ))
        )}
      </div>
    </aside>
  );
}

function changeText(change: LineChange): string {
  if (!change.addedCount && !change.removedCount) return 'No change to the prompt';
  const parts: string[] = [];
  if (change.addedCount)
    parts.push(`${change.addedCount} ${change.addedCount === 1 ? 'line' : 'lines'} added`);
  if (change.removedCount)
    parts.push(`${change.removedCount} ${change.removedCount === 1 ? 'line' : 'lines'} removed`);
  return parts.join(' · ');
}
