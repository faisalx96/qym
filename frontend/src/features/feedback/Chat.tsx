import { forwardRef, useEffect, useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Icon, Kbd, Text, TextBlock, Textarea } from '@/ui';
import type { LogItem } from './turnState';
import styles from './feedback.module.css';

/** Request ids become links only in tool lines (QE-90), never by scanning free text. */
function ToolText({ item }: { item: LogItem }) {
  const ids = item.ids ?? [];
  if (!ids.length) return <>{item.text}</>;
  return (
    <>
      {item.text}
      {' · '}
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 ? ' ' : null}
          <Link to={`/feedback/${id}`} className={styles.idLink} data-link-sm="" data-request-link={id}>
            {id}
          </Link>
        </span>
      ))}
    </>
  );
}

export function MsgItem({ item, who, onRetry }: { item: LogItem; who: string; onRetry?: () => void }) {
  if (item.role === 'tool')
    return (
      <li className={styles.toolLine} data-role="tool">
        <Icon name="search" size={12} />
        <span>
          <ToolText item={item} />
        </span>
      </li>
    );
  if (item.role === 'event')
    return (
      <li className={styles.toolLine} data-role="event">
        <Icon name="info" size={12} />
        <span>{item.text}</span>
      </li>
    );
  if (item.role === 'error')
    return (
      <li>
        <div className={styles.errorLine} role="alert" data-testid="agent-unavailable">
          <Icon name="warning" size={14} />
          <span className={styles.errorText}>{item.text}</span>
          {onRetry && item.retryable ? (
            <Button size="sm" variant="neutral" icon={<Icon name="retry" size={12} />} onPress={onRetry}>
              Retry
            </Button>
          ) : null}
        </div>
      </li>
    );
  const user = item.role === 'user';
  return (
    <li
      className={styles.msg}
      data-role={item.role}
      data-streaming={item.streaming ? '' : undefined}
      aria-busy={item.streaming ? true : undefined}
    >
      <span className={styles.msgIcon} aria-hidden="true">
        <Icon name={user ? 'user' : 'bot'} size={14} />
      </span>
      <div className={styles.msgBody}>
        <div className={styles.msgMeta}>
          <span className={styles.msgWho}>{user ? who : 'Assistant'}</span>
          {item.streaming ? (
            <span className={styles.writing}>writing…</span>
          ) : item.status === 'stopped' || item.status === 'interrupted' ? (
            <span className={styles.writing} data-testid="partial-mark">
              {item.status}
            </span>
          ) : (
            <time>{item.time}</time>
          )}
        </div>
        <TextBlock text={item.text} mode="raw" className={styles.msgText} />
      </div>
    </li>
  );
}

export interface ChatProps {
  items: LogItem[];
  who: string;
  headMeta: string;
  running: boolean;
  announce: string;
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  onRetry: () => void;
  note?: string;
  limitReached?: boolean;
  height?: number;
  extra?: ReactNode;
  /** Older messages exist on the server (QE-55). */
  onLoadEarlier?: () => void;
}

const NEAR = 40;

export const Chat = forwardRef<HTMLTextAreaElement, ChatProps>(function Chat(p, composerRef) {
  const logRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });
  useEffect(() => {
    const el = logRef.current;
    if (!el) return undefined;
    const on = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR;
    };
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);
  const tooLong = p.value.length > 4000;
  const canSend = p.value.trim().length > 0 && !p.running && !tooLong;
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) p.onSend();
    }
  };
  return (
    <Card
      as="section"
      flush
      fill
      aria-label="Conversation"
      className={styles.chatCard}
      style={p.height ? { blockSize: p.height } : undefined}
      data-testid="chat"
    >
      <div className={styles.chatHead}>
        <Text variant="md">Conversation</Text>
        <span className={styles.chatMeta}>{p.headMeta}</span>
      </div>
      {/* A scrollable log is a tab stop so the keyboard can scroll it (WCAG 2.1.1, scrollable-region-focusable). */}
      {/* eslint-disable jsx-a11y/no-noninteractive-tabindex */}
      <div
        ref={logRef}
        className={styles.log}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Conversation messages"
        tabIndex={0}
        data-testid="chat-log"
      >
        {p.onLoadEarlier ? (
          <Button size="sm" variant="ghost" onPress={p.onLoadEarlier} data-testid="load-earlier">
            Show earlier messages
          </Button>
        ) : null}
        <ol className={styles.msgs}>
          {p.items.map((m) => (
            <MsgItem key={m.key} item={m} who={p.who} onRetry={p.onRetry} />
          ))}
          {p.extra}
        </ol>
      </div>
      {/* eslint-enable jsx-a11y/no-noninteractive-tabindex */}
      <p className={styles.srOnly} role="status" data-testid="chat-status">
        {p.announce}
      </p>
      <div className={styles.composer}>
        <Textarea
          ref={composerRef}
          label="Your reply"
          hideLabel
          rows={3}
          value={p.value}
          onChange={p.onChange}
          onKeyDown={onKeyDown}
          isDisabled={p.running}
          placeholder="Reply to the assistant"
          aria-describedby="composer-hint"
          errorMessage={tooLong ? '4,000 characters at most' : p.note}
        />
        <div className={styles.composerFoot}>
          <span className={styles.composerHint} id="composer-hint">
            {p.running ? (
              'The assistant is writing. You can send your next reply when it has finished.'
            ) : (
              <>
                <Kbd>Enter</Kbd> sends, <Kbd>Shift</Kbd> <Kbd>Enter</Kbd> starts a new line
                {p.value.length >= 3600 ? (
                  <>
                    {' '}
                    <span className={styles.counter} data-over={tooLong ? '' : undefined}>
                      {p.value.length.toLocaleString('en-US')} / 4,000
                    </span>
                  </>
                ) : null}
              </>
            )}
          </span>
          {p.running ? (
            <Button variant="neutral" icon={<Icon name="stop" size={12} />} onPress={p.onStop}>
              Stop
            </Button>
          ) : (
            <Button
              variant="accent"
              isDisabled={!canSend}
              icon={<Icon name="next" size={14} />}
              onPress={p.onSend}
            >
              Send
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
});
