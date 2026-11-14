import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Button, CopyButton, EmptyState, ErrorState, Skeleton, Tag, Text } from '@/ui';
import { APP_LOCALE } from '@/lib/dates';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import { changedLines, type LineChange } from '../model/promptDiff';
import { PromptMessages, PromptViewSwitch, usePromptView } from './PromptMessages';
import { sectionNotes } from '../model/contents';
import s from './pane.module.css';

/** Space between the pane and the bottom of the viewport (the action rail's button line). */
const PANE_BOTTOM_GAP = 12;
const PANE_MIN_HEIGHT = 360;

/**
 * The target that the prompt is for, as one quiet line (cv5 Q1): item id, metric and score. A row click at the left
 * chooses it (the row stays highlighted); the guidance tabs keep the last choice, else the first target.
 */
function TargetLine({ ws }: { ws: RunWorkspace }) {
  const focus = ws.focus;
  if (!focus)
    return (
      <Text variant="sm" tone="muted" as="p" className={s.target}>
        No target
      </Text>
    );
  const score = ws.rowById.get(focus.itemId)?.metric_scores[focus.metric];
  return (
    <Text variant="sm" tone="muted" as="p" className={s.target} data-testid="prompt-pane-target">
      <span className={s.mono}>{focus.itemId}</span>
      {' · '}
      <span className={s.mono}>{focus.metric}</span>
      {score != null ? (
        <>
          {' · '}
          <span className={s.mono}>{score.toFixed(2)}</span>
        </>
      ) : null}
    </Text>
  );
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

/**
 * The prompt preview as a fixed pane next to the settings (cv5 K3, owner: "the prompt is always open on the right
 * ... because I want to see what these impact"). Sticky under the page header with its own scroll. It follows every
 * setting on the left; while an update is on its way the text stays in place, slightly dimmed, and the head says
 * "Updating". The lines that the last change added are marked, and the head counts what it added and removed.
 */
export function PromptPane({
  ws,
  note,
  peek = null,
}: {
  ws: RunWorkspace;
  note?: string | null;
  /** cv5 Q4: the section keys of a hovered or focused Prompt contents switch. */
  peek?: string[] | null;
}) {
  const ref = useFitHeight();
  const scroller = useRef<HTMLDivElement>(null);
  const { preview } = ws;
  const [view, setView] = usePromptView();
  const notes = useMemo(() => sectionNotes(ws.settings), [ws.settings]);
  const change = useChanges(ws.focusKey, preview.messages, preview.pending);
  const firstAdded = change?.added.findIndex((set) => set.size > 0) ?? -1;

  const showChange = () => {
    const root = scroller.current;
    const line = root?.querySelector<HTMLElement>('[data-added]');
    if (!root || !line) return;
    // below the sticky location line of the narrow outline (the rail is beside the text, not above it)
    const offset = (root.querySelector('[data-outline-bar]')?.getBoundingClientRect().height ?? 0) + 48;
    root.scrollTop += line.getBoundingClientRect().top - root.getBoundingClientRect().top - offset;
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
        <div className={s.targetRow}>
          <TargetLine ws={ws} />
          <PromptViewSwitch view={view} onView={setView} />
        </div>
        {/* cv5 Z11: an honest, quiet line when the open tab shows something the prompt does not use (a draft) */}
        {note ? (
          <Text variant="sm" tone="muted" as="p" className={s.note} data-testid="prompt-pane-note">
            {note}
          </Text>
        ) : null}
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
          <PromptMessages
            messages={preview.messages}
            view={view}
            change={change}
            peek={peek}
            notes={notes}
          />
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

/**
 * The pane's place before the run workspace exists (cv5 Z11): the same surface and size, so the columns do not move
 * when the run loads. A loading run shows the skeleton; a run that needs a pass or failed to load says why.
 */
export function PromptPanePlaceholder({ state }: { state: 'loading' | 'pass' | 'error' }) {
  const ref = useFitHeight();
  return (
    <aside ref={ref} className={s.pane} aria-label="Prompt preview" data-testid="prompt-pane">
      <header className={s.head}>
        <div className={s.titleRow}>
          <Text as="h2" variant="md" weight={650}>
            Prompt preview
          </Text>
        </div>
      </header>
      <div className={s.scroll}>
        {state === 'loading' ? (
          <Skeleton kind="lines" rows={12} label="Building prompt preview" />
        ) : (
          <EmptyState
            compact
            title="Nothing to preview"
            body={
              state === 'pass'
                ? 'Choose a pass of this run to see the prompt.'
                : 'The run did not load, so there is no prompt to show.'
            }
          />
        )}
      </div>
    </aside>
  );
}
