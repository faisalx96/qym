import { describe, expect, it } from 'vitest';
import type { ChecklistItem, Proposal } from '@/api/feedback';
import {
  applyEvent,
  connectionLost,
  CORRECTED_TEXT,
  initialState,
  itemsFromMessages,
  stopped,
  userRefused,
  userSent,
  userMessageCount,
} from '../turnState';

const clock = (iso: string) => (iso ? '12:00' : '');
const empty: ChecklistItem[] = [];
const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  seq: 5,
  title: 'T',
  summary: 's',
  description: 'd',
  business_need: 'b',
  justification: 'j',
  priority: { level: 'medium', reasoning: 'r' },
  complexity: { level: 'M', reasoning: 'r' },
  related: [],
  open_gaps: [],
  repaired: [],
  superseded: false,
  ...over,
});
const ev = (event: string, data: Record<string, unknown>) => ({ event, data });

describe('turn state', () => {
  it('streams text into one assistant item and finishes it on done', () => {
    let s = userSent(initialState([], empty, null), 'hello', 'u1', '12:00');
    expect(s.running).toBe(true);
    s = applyEvent(s, ev('message', { seq: 1, created_at: '2026-01-01T12:00:00Z' }), clock);
    s = applyEvent(s, ev('delta', { text: 'Thanks. ' }), clock);
    s = applyEvent(s, ev('delta', { text: 'Who?' }), clock);
    expect(s.items.at(-1)).toMatchObject({ role: 'assistant', text: 'Thanks. Who?', streaming: true });
    s = applyEvent(s, ev('done', { seq: 2, message_id: 9, phase: 'asking' }), clock);
    expect(s.running).toBe(false);
    expect(s.items.at(-1)).toMatchObject({ streaming: false, status: 'ok', seq: 2 });
    expect(s.items[0]).toMatchObject({ pending: false, seq: 1 });
  });

  it('puts a tool line before the streaming answer and hides the proposal tool', () => {
    let s = userSent(initialState([], empty, null), 'x', 'u1', '12:00');
    s = applyEvent(s, ev('delta', { text: 'a' }), clock);
    s = applyEvent(s, ev('tool', { seq: 3, name: 'search_requests', summary: 'Searched requests', ids: ['FB-0001'] }), clock);
    s = applyEvent(s, ev('tool', { seq: 4, name: 'propose_request', summary: 'Proposed', ids: [] }), clock);
    expect(s.items.map((i) => i.role)).toEqual(['user', 'tool', 'assistant']);
  });

  it('keeps the partial text as interrupted on an error and offers retry', () => {
    let s = userSent(initialState([], empty, null), 'x', 'u1', '12:00');
    s = applyEvent(s, ev('delta', { text: 'partial' }), clock);
    s = applyEvent(s, ev('error', { code: 'agent_timeout', message: 'timed out', retryable: true }), clock);
    expect(s.items.find((i) => i.role === 'assistant')).toMatchObject({ status: 'interrupted', text: 'partial' });
    const err = s.items.at(-1)!;
    expect(err).toMatchObject({ role: 'error', retryable: true });
    expect(err.text).toBe('The assistant could not answer: timed out. Your message is saved.');
    expect(s.running).toBe(false);
  });

  it('does not double the full stop when the cause ends with one (QE-124)', () => {
    let s = userSent(initialState([], empty, null), 'x', 'u1', '12:00');
    s = applyEvent(
      s,
      ev('error', { code: 'agent_unavailable', message: 'The stored key cannot be decrypted. Save the connection again.', retryable: false }),
      clock,
    );
    expect(s.items.at(-1)!.text).toBe(
      'The assistant could not answer: The stored key cannot be decrypted. Save the connection again. Your message is saved.',
    );
  });

  it('drops an empty streaming item, and a lost connection reads as not reachable', () => {
    let s = userSent(initialState([], empty, null), 'x', 'u1', '12:00');
    s = connectionLost(s);
    expect(s.items.some((i) => i.streaming)).toBe(false);
    expect(s.items.at(-1)!.text).toContain('the connection was lost');
  });

  it('marks stopped text and rolls back a refused message', () => {
    let s = userSent(initialState([], empty, null), 'x', 'u1', '12:00');
    s = applyEvent(s, ev('delta', { text: 'half' }), clock);
    s = stopped(s);
    expect(s.items.at(-1)).toMatchObject({ status: 'stopped', text: 'half', streaming: false });
    const refused = userRefused(userSent(initialState([], empty, null), 'y', 'u2', '12:00'), 'u2');
    expect(refused.items).toEqual([]);
  });

  it('stores the proposal, supersedes it on the next message, and notes a corrected reference', () => {
    let s = initialState([], empty, null);
    s = applyEvent(s, ev('proposal', { seq: 5, proposal: proposal(), repaired: ['related:FB-9999'] }), clock);
    expect(s.proposal?.seq).toBe(5);
    expect(s.proposalArrivals).toBe(1);
    expect(s.items.at(-1)).toMatchObject({ role: 'event', text: CORRECTED_TEXT });
    s = userSent(s, 'more', 'u3', '12:01');
    expect(s.proposal?.superseded).toBe(true);
  });

  it('maps stored messages to log items without the proposal tool message', () => {
    const items = itemsFromMessages(
      [
        { id: 1, seq: 1, role: 'user', content: 'a', tool_name: null, ids: [], kind: null, status: 'ok', created_at: 'x' },
        { id: 2, seq: 2, role: 'tool', content: 'Proposed request: T', tool_name: 'propose_request', ids: [], kind: 'proposal', status: 'ok', created_at: 'x' },
        { id: 3, seq: 3, role: 'tool', content: 'Searched', tool_name: 'search_requests', ids: ['FB-0001'], kind: 'search', status: 'ok', created_at: 'x' },
      ],
      clock,
    );
    expect(items.map((i) => i.role)).toEqual(['user', 'tool']);
    expect(userMessageCount(initialState(items, empty, null))).toBe(1);
  });
});
