import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useBlocker, useNavigate } from 'react-router-dom';
import { Callout } from '@/features/experiments/launch/components/Callout';
import {
  feedbackKeys,
  loadOlderMessages,
  stopTurn,
  useConfirmFeedback,
  useDeleteDraft,
  useFeedbackMessages,
  useFeedbackRequest,
  type FeedbackDetail,
  type FeedbackMessage,
} from '@/api/feedback';
import { useAuth } from '@/features/shell/AuthContext';
import { useDocumentTitle } from '@/features/shell/hooks';
import { constrained } from '@/features/shell/layout';
import { useCrumbLabel } from '@/lib/crumb-label';
import { api, ApiError } from '@/lib/http';
import { useSubmitLock } from '@/lib/pending';
import { Button, ConfirmDialog, ErrorState, PageHeader, Tag, useToast } from '@/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Chat } from './Chat';
import { ChecklistRail } from './ChecklistRail';
import { clock } from './format';
import { ChatLoadingFrame } from './LoadingFrames';
import { ProposalCard } from './ProposalCard';
import type { ProposalForm } from './proposalForm';
import { streamPost, type SseEvent } from './sse';
import {
  applyEvent,
  connectionLost,
  initialState,
  itemsFromMessages,
  prepend,
  stopped,
  turnStarted,
  userMessageCount,
  userRefused,
  userSent,
  type LogItem,
  type TurnState,
} from './turnState';
import styles from './feedback.module.css';

type Action =
  | { type: 'init'; state: TurnState }
  | { type: 'event'; ev: SseEvent }
  | { type: 'sent'; text: string; key: string }
  | { type: 'refused'; key: string }
  | { type: 'start' }
  | { type: 'older'; items: LogItem[] }
  | { type: 'lost' }
  | { type: 'stop' }
  | { type: 'error'; message: string; code: string; retryable: boolean };

function reduce(state: TurnState, a: Action): TurnState {
  switch (a.type) {
    case 'init':
      return a.state;
    case 'event':
      return applyEvent(state, a.ev, clock);
    case 'sent':
      return userSent(state, a.text, a.key, clock(new Date().toISOString()));
    case 'refused':
      return userRefused(state, a.key);
    case 'start':
      return turnStarted(state);
    case 'older':
      return prepend(state, a.items);
    case 'lost':
      return connectionLost(state);
    case 'stop':
      return stopped(state);
    case 'error':
      return applyEvent(
        state,
        { event: 'error', data: { code: a.code, message: a.message, retryable: a.retryable } },
        clock,
      );
    default:
      return state;
  }
}

/** True when the person's message is the last one: the assistant owes an answer (QE-35). */
function needsAnswer(messages: FeedbackMessage[]): boolean {
  return [...messages].reverse().find((m) => m.role !== 'tool')?.role === 'user';
}

const composerKey = (ref: string) => `qym:feedback-composer:${ref}`;
function readComposer(ref: string): string {
  try {
    return sessionStorage.getItem(composerKey(ref)) ?? '';
  } catch {
    return '';
  }
}
function writeComposer(ref: string, v: string) {
  try {
    if (v) sessionStorage.setItem(composerKey(ref), v);
    else sessionStorage.removeItem(composerKey(ref));
  } catch {
    /* storage can be unavailable */
  }
}

/** /feedback/<uuid> of a draft: the chat, the checklist and the proposal card (QE-35 to QE-76). */
export function DraftPage({ refId }: { refId: string }) {
  const detail = useFeedbackRequest(refId);
  const messages = useFeedbackMessages(refId);
  if (detail.isError || messages.isError)
    return (
      <div className={`${constrained} ${styles.page}`}>
        <ErrorState
          error={detail.error ?? messages.error}
          title="Couldn’t open this request"
          notFoundMessage="This request does not exist or is not yours"
          onRetry={() => {
            void detail.refetch();
            void messages.refetch();
          }}
        />
      </div>
    );
  if (!detail.data || !messages.data) return <ChatLoadingFrame />;
  return (
    <DraftConversation
      refId={refId}
      detail={detail.data}
      messages={messages.data.messages}
      hasMore={messages.data.has_more}
    />
  );
}

function DraftConversation({
  refId,
  detail,
  messages,
  hasMore,
}: {
  refId: string;
  detail: FeedbackDetail;
  messages: FeedbackMessage[];
  hasMore: boolean;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { me } = useAuth();
  const lock = useSubmitLock();
  const del = useDeleteDraft();
  const confirm = useConfirmFeedback(refId);
  const req = detail.request;
  const info = detail.draft!;
  const [state, dispatch] = useReducer(reduce, undefined, () => {
    const base = initialState(itemsFromMessages(messages, clock), detail.checklist, detail.proposal);
    return needsAnswer(messages) ? turnStarted(base) : base;
  });
  const [text, setText] = useState(() => readComposer(refId));
  const [note, setNote] = useState('');
  const [welcome, setWelcome] = useState(true);
  const [more, setMore] = useState(hasMore);
  const [dirty, setDirty] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [stale, setStale] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; description?: string } | undefined>();
  const [announce, setAnnounce] = useState('');
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const started = useRef(false);
  const wantFocus = useRef(false);
  const restoreFocus = useRef(false);
  const proposalTitle = state.proposal && !state.proposal.superseded ? state.proposal.title : '';
  useDocumentTitle(proposalTitle || 'New feedback');
  useCrumbLabel('New feedback');

  const blocker = useBlocker(dirty && !confirm.isSuccess);
  useEffect(() => {
    if (!dirty) return undefined;
    const on = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', on);
    return () => window.removeEventListener('beforeunload', on);
  }, [dirty]);

  // The server finished (or is finishing) a turn this page did not start: show what it stored.
  const reloadFromServer = useCallback(async () => {
    const [d, m] = await Promise.all([
      qc.fetchQuery({
        queryKey: feedbackKeys.detail(refId),
        queryFn: () => api.get<FeedbackDetail>(`/v1/feedback/${encodeURIComponent(refId)}`),
        staleTime: 0,
      }),
      api.get<{ messages: FeedbackMessage[] }>(`/v1/feedback/${encodeURIComponent(refId)}/messages?limit=50`),
    ]);
    dispatch({
      type: 'init',
      state: initialState(itemsFromMessages(m.messages, clock), d.checklist, d.proposal),
    });
    return d.request.phase;
  }, [refId, qc]);

  const run = useCallback(
    async (path: string, body?: unknown, optimisticKey?: string) => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setAnnounce('The assistant is writing');
      let terminal = false;
      try {
        await streamPost({
          path: `/v1/feedback/${refId}/${path}`,
          body,
          signal: ctrl.signal,
          onEvent: (ev) => {
            if (ev.event === 'done' || ev.event === 'error') terminal = true;
            dispatch({ type: 'event', ev });
            if (ev.event === 'done') setAnnounce('The assistant answered');
            if (ev.event === 'proposal') setAnnounce('The assistant proposed a request. Review it below.');
          },
        });
        if (!terminal) dispatch({ type: 'lost' });
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        if (e instanceof ApiError) {
          if (optimisticKey) dispatch({ type: 'refused', key: optimisticKey });
          if (e.status === 409 && e.code === 'nothing_to_answer') {
            await reloadFromServer();
            return;
          }
          if (e.status === 409 && e.code === 'turn_in_progress') {
            if (path === 'turn') {
              // Another window (or this one before a reload) is mid-turn: wait for its stored answer.
              dispatch({ type: 'start' });
              for (let i = 0; i < 40; i += 1) {
                await new Promise((r) => setTimeout(r, 1500));
                if ((await reloadFromServer()) !== 'thinking') return;
                dispatch({ type: 'start' });
              }
              return;
            }
            setNote('The assistant is already answering in another window.');
            return;
          }
          if (e.status === 429) {
            setNote(e.detail || 'Too many messages. Try again soon.');
            return;
          }
          if (e.status === 503) {
            dispatch({
              type: 'error',
              code: 'feedback_not_configured',
              message: 'the assistant is not set up',
              retryable: false,
            });
            return;
          }
          dispatch({
            type: 'error',
            code: e.code ?? 'error',
            message: e.detail || 'not reachable',
            retryable: true,
          });
          return;
        }
        dispatch({ type: 'lost' });
      } finally {
        abortRef.current = null;
        void qc.invalidateQueries({ queryKey: feedbackKeys.detail(refId) });
      }
    },
    [refId, qc, reloadFromServer],
  );

  // QE-35: a draft whose last message is the person's gets its answer; one that ends with the assistant makes no call.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    if (needsAnswer(messages)) setTimeout(() => void run('turn'), 0);
  }, [messages, run]);

  // QE-142: "Keep talking" pressed while the closing message streams focuses the composer once it is enabled again.
  useEffect(() => {
    if (state.running) return;
    if (wantFocus.current) {
      wantFocus.current = false;
      composerRef.current?.focus();
    }
    // QE-140: the composer is disabled while the assistant writes, which drops the focus the person had when they
    // pressed Enter; give it back when the turn ends unless the focus already went somewhere on purpose (the proposal).
    if (restoreFocus.current) {
      restoreFocus.current = false;
      const a = document.activeElement;
      if (!a || a === document.body) composerRef.current?.focus();
    }
  }, [state.running]);

  // QE-58: a new proposal moves focus to its heading.
  useEffect(() => {
    if (!state.proposalArrivals) return;
    const t = setTimeout(() => {
      const h = document.getElementById('proposal-title');
      h?.focus({ preventScroll: true });
      h?.closest('section')?.scrollIntoView({ block: 'start' });
    }, 50);
    return () => clearTimeout(t);
  }, [state.proposalArrivals]);

  const send = () => {
    const value = text.trim();
    if (!value || state.running) return;
    const key = `u${Date.now()}`;
    restoreFocus.current = document.activeElement === composerRef.current;
    setNote('');
    dispatch({ type: 'sent', text: value, key });
    setText('');
    writeComposer(refId, '');
    void run('messages', { content: value }, key).then(() => undefined);
  };
  // A refused send puts the text back (QE-136).
  const lastSent = useRef('');
  const sendWithRestore = () => {
    lastSent.current = text;
    send();
  };
  useEffect(() => {
    if (note && !text && lastSent.current) {
      setText(lastSent.current);
      lastSent.current = '';
    }
  }, [note, text]);

  const loadEarlier = async () => {
    const first = state.items.find((i) => i.seq !== undefined)?.seq;
    if (first === undefined) return;
    const older = await loadOlderMessages(refId, first);
    dispatch({ type: 'older', items: itemsFromMessages(older.messages, clock) });
    setMore(older.has_more);
  };

  const stop = () => {
    abortRef.current?.abort();
    dispatch({ type: 'stop' });
    void stopTurn(refId).catch(() => undefined);
  };
  const retry = () => {
    dispatch({ type: 'start' });
    void run('turn');
  };
  const submit = (form: ProposalForm) =>
    lock(async () => {
      setStale('');
      setFieldErrors(undefined);
      const p = state.proposal!;
      try {
        const res = await confirm.mutateAsync({ ...form, proposal_seq: p.seq });
        setDirty(false);
        writeComposer(refId, '');
        toast.show(`Submitted as ${res.request.ref}`, { tone: 'success' });
        navigate(`/feedback/${res.request.ref}`, { replace: true });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'proposal_stale')
          setStale('The conversation moved on. Ask the assistant to propose again.');
        else if (e instanceof ApiError && e.status === 422)
          setFieldErrors({
            [(e.body as { field?: string })?.field === 'title' ? 'title' : 'description']: e.detail,
          });
        else toast.show('Couldn’t submit. Your edits are kept.', { tone: 'error' });
      }
    });

  const [mountedAt] = useState(() => Date.now());
  const ageDays = Math.floor((mountedAt - new Date(info.last_activity_at).getTime()) / 86_400_000);
  // The log holds only the loaded page of messages, so a long conversation counts from the server's number (QE-129).
  const count = Math.max(userMessageCount(state), info.user_message_count);
  const limit = info.max_user_messages;
  const stamp = state.items.filter((i) => i.time).at(-1)?.time;
  const subjectTag = req.subject === 'platform' ? 'Platform' : (req.project?.name ?? 'Product');
  return (
    <div className={`${constrained} ${styles.page}`} data-testid="feedback-chat-page">
      <PageHeader
        title="New feedback"
        description="Answer the assistant’s questions. Nothing is submitted until you confirm a proposal."
        meta={[
          <Tag key="s">{subjectTag}</Tag>,
          'Draft, only you can see it',
          `Deleted after ${info.retention_days} days without a submit`,
        ]}
        actions={
          <Button variant="ghost" size="md" onPress={() => setDiscard(true)}>
            Discard draft
          </Button>
        }
      />
      {welcome && ageDays >= 1 && messages.length > 1 ? (
        <Callout tone="info" title="Welcome back">
          This draft is from {ageDays} {ageDays === 1 ? 'day' : 'days'} ago. The assistant remembers the
          conversation. It is deleted in {info.days_left} {info.days_left === 1 ? 'day' : 'days'} if you do
          not submit it.{' '}
          <Button size="sm" variant="ghost" onPress={() => setWelcome(false)}>
            Dismiss
          </Button>
        </Callout>
      ) : null}
      {count >= limit ? (
        <Callout tone="warning" title={`${count} of ${limit} messages used`}>
          The assistant will now propose a request from what it knows. You can edit everything before you
          submit.
        </Callout>
      ) : null}
      <div className={styles.split} data-chat-split>
        <div className={styles.stackCol}>
          <Chat
            items={state.items}
            who={me.display_name || me.email}
            headMeta={`${subjectTag}${stamp ? ` · draft saved ${stamp}` : ''}`}
            running={state.running}
            announce={announce}
            value={text}
            onChange={(v) => {
              setText(v);
              writeComposer(refId, v);
            }}
            onSend={sendWithRestore}
            onStop={stop}
            onRetry={retry}
            note={note}
            onLoadEarlier={more ? loadEarlier : undefined}
            ref={composerRef}
            height={state.proposal ? 300 : undefined}
          />
          {state.proposal ? (
            <ProposalCard
              proposal={state.proposal}
              checklist={state.checklist}
              submitting={confirm.isPending}
              waiting={state.running}
              stale={stale}
              fieldErrors={fieldErrors}
              onSubmit={(f) => void submit(f)}
              onKeepTalking={() => {
                if (state.running) wantFocus.current = true;
                else composerRef.current?.focus();
              }}
              onDirty={setDirty}
            />
          ) : null}
        </div>
        <ChecklistRail items={state.checklist} />
      </div>
      <ConfirmDialog
        open={discard}
        onOpenChange={setDiscard}
        title="Delete this draft?"
        description="The conversation is deleted. This cannot be undone."
        confirmLabel="Delete draft"
        tone="danger"
        onConfirm={async () => {
          try {
            await del.mutateAsync(refId);
            setDirty(false);
            navigate('/feedback');
          } catch {
            toast.show('Couldn’t delete the draft.', { tone: 'error' });
          }
        }}
      />
      <ConfirmDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(o) => !o && blocker.state === 'blocked' && blocker.reset()}
        title="Leave this page?"
        description="You changed the proposal. Your edits are lost if you leave; the draft itself is kept."
        confirmLabel="Leave"
        onConfirm={() => {
          if (blocker.state === 'blocked') blocker.proceed();
        }}
      />
    </div>
  );
}
