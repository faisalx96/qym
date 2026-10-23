/** The conversation log and what a turn's events do to it (spec-e 4.8). Pure, so it is testable without a browser. */
import type { ChecklistItem, FeedbackMessage, Proposal } from '@/api/feedback';
import type { SseEvent } from './sse';

export interface LogItem {
  key: string;
  role: 'user' | 'assistant' | 'tool' | 'event' | 'error';
  text: string;
  time?: string;
  seq?: number;
  ids?: string[];
  streaming?: boolean;
  pending?: boolean;
  status?: 'ok' | 'stopped' | 'interrupted';
  retryable?: boolean;
}

export interface TurnError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface TurnState {
  items: LogItem[];
  running: boolean;
  word: '' | 'reading' | 'searching' | 'thinking';
  checklist: ChecklistItem[];
  proposal: Proposal | null;
  /** Set when a new proposal arrived (the card focuses its heading once per value). */
  proposalArrivals: number;
  error: TurnError | null;
}

export const CORRECTED_TEXT =
  'The assistant’s proposal named a request that does not exist. It was removed before you saw it.';

export function itemsFromMessages(messages: FeedbackMessage[], clock: (iso: string) => string): LogItem[] {
  return messages
    .filter((m) => m.role !== 'tool' || m.tool_name !== 'propose_request')
    .map((m) => ({
      key: `m${m.seq}`,
      role: m.role,
      text: m.content,
      time: clock(m.created_at),
      seq: m.seq,
      ids: m.ids,
      status: m.status,
    }));
}

export function initialState(
  messages: LogItem[],
  checklist: ChecklistItem[],
  proposal: Proposal | null,
): TurnState {
  return { items: messages, running: false, word: '', checklist, proposal, proposalArrivals: 0, error: null };
}

const hasStreaming = (items: LogItem[]) => items.some((i) => i.streaming);

export function userSent(state: TurnState, text: string, key: string, time: string): TurnState {
  return {
    ...state,
    running: true,
    word: 'thinking',
    error: null,
    proposal: state.proposal ? { ...state.proposal, superseded: true } : null,
    items: [
      ...state.items.filter((i) => i.role !== 'error'),
      { key, role: 'user', text, time, pending: true },
    ],
  };
}

export function turnStarted(state: TurnState): TurnState {
  return { ...state, running: true, word: 'thinking', error: null, items: state.items.filter((i) => i.role !== 'error') };
}

/** Roll back an optimistic message the server refused (429, validation). */
export function userRefused(state: TurnState, key: string): TurnState {
  return { ...state, running: false, word: '', items: state.items.filter((i) => i.key !== key) };
}

function finishStreaming(items: LogItem[], status: LogItem['status'], extra: Partial<LogItem> = {}): LogItem[] {
  return items.flatMap((i) => {
    if (!i.streaming) return [i];
    if (!i.text.trim()) return [];
    return [{ ...i, streaming: false, status, ...extra }];
  });
}

export function applyEvent(state: TurnState, ev: SseEvent, clock: (iso: string) => string): TurnState {
  const d = ev.data as Record<string, unknown>;
  switch (ev.event) {
    case 'message': {
      const items = state.items.map((i) =>
        i.pending ? { ...i, pending: false, seq: Number(d.seq), time: clock(String(d.created_at ?? '')) || i.time } : i,
      );
      return { ...state, items };
    }
    case 'status':
      return { ...state, word: (d.phase as TurnState['word']) ?? 'thinking' };
    case 'tool': {
      if (d.name === 'propose_request') return state;
      const ids = Array.isArray(d.ids) ? (d.ids as string[]) : [];
      const item: LogItem = { key: `t${d.seq}`, role: 'tool', text: String(d.summary ?? ''), ids, seq: Number(d.seq) };
      // A tool line sits before the streaming answer.
      const idx = state.items.findIndex((i) => i.streaming);
      const items = [...state.items];
      if (idx >= 0) items.splice(idx, 0, item);
      else items.push(item);
      return { ...state, items };
    }
    case 'delta': {
      const text = String(d.text ?? '');
      if (!hasStreaming(state.items))
        return {
          ...state,
          items: [...state.items, { key: 'live', role: 'assistant', text, streaming: true }],
        };
      return { ...state, items: state.items.map((i) => (i.streaming ? { ...i, text: i.text + text } : i)) };
    }
    case 'checklist':
      return { ...state, checklist: (d.items as ChecklistItem[]) ?? state.checklist };
    case 'proposal': {
      const proposal = d.proposal as Proposal;
      const repaired = Array.isArray(d.repaired) && d.repaired.length > 0;
      const items = repaired
        ? [...state.items, { key: `c${proposal.seq}`, role: 'event' as const, text: CORRECTED_TEXT }]
        : state.items;
      return { ...state, proposal, proposalArrivals: state.proposalArrivals + 1, items };
    }
    case 'done': {
      const items = finishStreaming(state.items, 'ok', { seq: Number(d.seq), time: clock(new Date().toISOString()) }).map((i) =>
        i.pending ? { ...i, pending: false } : i,
      );
      return { ...state, items, running: false, word: '' };
    }
    case 'error': {
      const message = String(d.message ?? 'not reachable');
      const items = finishStreaming(state.items, 'interrupted');
      return {
        ...state,
        items: [
          ...items,
          {
            key: 'error',
            role: 'error',
            text: `The assistant could not answer: ${message}. Your message is saved.`,
            retryable: d.retryable !== false,
          },
        ],
        running: false,
        word: '',
        error: { code: String(d.code ?? ''), message, retryable: d.retryable !== false },
      };
    }
    default:
      return state;
  }
}

/** The connection broke mid-answer (QE-135): the partial text stays marked "interrupted". */
export function connectionLost(state: TurnState): TurnState {
  return applyEvent(state, { event: 'error', data: { code: 'agent_unavailable', message: 'the connection was lost', retryable: true } }, () => '');
}

/** Stop pressed (QE-50): the partial text stays marked "stopped". */
export function stopped(state: TurnState): TurnState {
  return { ...state, running: false, word: '', items: finishStreaming(state.items, 'stopped').map((i) => (i.pending ? { ...i, pending: false } : i)) };
}

export function userMessageCount(state: TurnState): number {
  return state.items.filter((i) => i.role === 'user').length;
}
