import { useState } from 'react';
import { Button, CopyButton, EmptyState, ErrorState, Skeleton, Tag, Text } from '@/ui';
import { PromptMessages, PromptViewSwitch, usePromptView } from './PromptMessages';
import { fieldsSent } from '../model/settings';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import s from './blocks.module.css';
import { APP_LOCALE } from '@/lib/dates';

/**
 * Role-labelled messages (Rendered or Raw, cv5 Q2), copy, char count and fields sent (the context switches are in "Prompt
 * contents" on the page and in the drawer head). No LLM call is made. The text never auto-scrolls: while an update is
 * pending it is dimmed in place instead of being swapped.
 */
export function PromptPreview({ ws, maxHeight = true }: { ws: RunWorkspace; maxHeight?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = usePromptView();
  const { preview, focus } = ws;
  const fields = fieldsSent(ws.cfg);
  return (
    <div className={s.stack}>
      <div className={s.previewBar}>
        {focus ? (
          <Text variant="sm" tone="muted" as="span">
            Item <span className={s.mono}>{focus.itemId}</span> ·{' '}
            <span className={s.mono}>{focus.metric}</span>
          </Text>
        ) : null}
        <span className={s.charsSlot}>
          {preview.characters != null ? (
            <Tag kind="count" aria-label={`${preview.characters} characters`}>
              {`${preview.characters.toLocaleString(APP_LOCALE)} chars`}
            </Tag>
          ) : null}
        </span>
        <Text variant="sm" tone="muted" as="span" role="status" aria-live="polite" className={s.updating}>
          {preview.pending ? 'Updating…' : ''}
        </Text>
        {preview.messages.length ? <PromptViewSwitch view={view} onView={setView} /> : null}
      </div>
      {!preview.hasTarget ? (
        <EmptyState
          compact
          title="Nothing to preview"
          body="Select a target to see the exact messages the analyzer would send."
        />
      ) : preview.error ? (
        <ErrorState
          error={preview.error}
          title="Couldn’t build the prompt preview"
          onRetry={preview.retry}
          compact
        />
      ) : preview.messages.length === 0 ? (
        <Skeleton kind="lines" rows={4} label="Building prompt preview" />
      ) : (
        <>
          {/* Scrollable region: focusable so keyboard users can scroll it. */}
          <div
            className={s.messages}
            data-pending={preview.pending ? '' : undefined}
            data-expanded={expanded || !maxHeight ? '' : undefined}
            // the drawer body is the one scroller, so the outline sticks to it (cv5 Q2)
            data-fill={!maxHeight ? '' : undefined}
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
            tabIndex={0}
            role="region"
            aria-label="Prompt messages"
          >
            <PromptMessages messages={preview.messages} view={view} change={null} />
          </div>
          <div className={s.previewFoot}>
            <Text variant="sm" tone="muted" as="span">
              Sent:
            </Text>
            {fields.map((f) => (
              <Tag key={f} kind="data">
                {f}
              </Tag>
            ))}
            <span className={s.spacer} />
            {maxHeight ? (
              <Button size="sm" onPress={() => setExpanded((e) => !e)} aria-expanded={expanded}>
                {expanded ? 'Collapse' : 'Expand'}
              </Button>
            ) : null}
            <CopyButton
              text={() => preview.messages.map((m) => `[${m.role}]\n${m.content}`).join('\n\n')}
              label="Copy prompt"
            />
          </div>
        </>
      )}
    </div>
  );
}
