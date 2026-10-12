import { useEffect, useRef, useState } from 'react';
import { Button, CopyButton, EmptyState, ErrorState, Eyebrow, Skeleton, Switch, Tag, Text } from '@/ui';
import { fieldsSent } from '../model/settings';
import type { RunWorkspace } from '../workspace/useRunWorkspace';
import s from './blocks.module.css';

/** Role-labelled messages, copy, char count, context toggles, fields sent. No LLM call is made. */
export function PromptPreview({ ws, maxHeight = true }: { ws: RunWorkspace; maxHeight?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const chars = ws.preview.characters;
  // The item data (where a mapping edit shows up) is in the last message: keep it in view after each update.
  useEffect(() => {
    const el = box.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chars]);
  const { preview, settings, update, focus } = ws;
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
        {preview.characters != null ? (
          <Tag kind="count" aria-label={`${preview.characters} characters`}>
            {`${preview.characters.toLocaleString()} chars`}
          </Tag>
        ) : null}
        <Text variant="sm" tone="muted" as="span" role="status" aria-live="polite">
          {preview.pending ? 'Updating…' : ''}
        </Text>
        <span className={s.spacer} />
        <Switch isSelected={settings.useRules} onChange={(v) => update({ useRules: v })}>
          Production rules
        </Switch>
        <Switch isSelected={settings.useDocuments} onChange={(v) => update({ useDocuments: v })}>
          Project documents
        </Switch>
        <Switch isSelected={settings.useTrace} onChange={(v) => update({ useTrace: v })}>
          Trace evidence
        </Switch>
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
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
          <div
            ref={box}
            className={s.messages}
            data-expanded={expanded || !maxHeight ? '' : undefined}
            tabIndex={0}
            role="region"
            aria-label="Prompt messages"
          >
            {preview.messages.map((m, i) => (
              <article key={i} className={s.message}>
                <header className={s.messageHead}>
                  <Eyebrow tone={m.role === 'system' ? 'accent' : 'muted'}>{m.role}</Eyebrow>
                  <CopyButton text={m.content} label={`Copy ${m.role} message`} />
                </header>
                <pre className={s.messageBody} dir="auto">
                  {m.content}
                </pre>
              </article>
            ))}
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
