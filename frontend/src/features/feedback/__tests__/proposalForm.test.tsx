import { describe, expect, it } from 'vitest';
import type { Proposal } from '@/api/feedback';
import {
  canSubmit,
  changedFrom,
  formFromProposal,
  mergeProposal,
  submitLabel,
  validate,
} from '../proposalForm';

const base = (over: Partial<Proposal> = {}): Proposal => ({
  seq: 1,
  title: 'Export the comparison',
  summary: 's',
  description: 'A long enough description of the request for the team.',
  business_need: 'b',
  justification: 'j',
  priority: { level: 'high', reasoning: 'r' },
  complexity: { level: 'M', reasoning: 'r' },
  related: [],
  open_gaps: [],
  repaired: [],
  superseded: false,
  ...over,
});

describe('proposal form', () => {
  it('labels the submit button for a possible duplicate', () => {
    expect(submitLabel(base())).toBe('Submit request');
    expect(
      submitLabel(base({ related: [{ request_id: 'FB-0001', kind: 'duplicate', note: 'n', title: 't', status: 'new' }] })),
    ).toBe('Submit as a possible duplicate');
  });

  it('disables submit for empty fields, while submitting and when superseded', () => {
    const p = base();
    const form = formFromProposal(p);
    expect(canSubmit(form, p, false)).toBe(true);
    expect(canSubmit(form, p, true)).toBe(false);
    expect(canSubmit({ ...form, description: '  ' }, p, false)).toBe(false);
    expect(validate({ ...form, description: '' }).description).toBe('The description cannot be empty.');
    expect(canSubmit({ ...form, title: '' }, p, false)).toBe(false);
    expect(canSubmit(form, base({ superseded: true }), false)).toBe(false);
  });

  it('remembers what the person changed from what the assistant proposed', () => {
    const p = base();
    expect(changedFrom(formFromProposal(p), p, 'priority')).toBeNull();
    expect(changedFrom({ ...formFromProposal(p), priority: 'medium' }, p, 'priority')).toBe('High');
    expect(changedFrom({ ...formFromProposal(p), complexity: 'L' }, p, 'complexity')).toBe('M');
  });

  it('keeps edits to fields the new proposal left alone and replaces the rest (QE-73)', () => {
    const old = base();
    const edited = { ...formFromProposal(old), title: 'My own title', description: 'My own description of it.' };
    const next = base({ seq: 2, description: 'The assistant rewrote the description after more answers.' });
    const merged = mergeProposal(edited, old, next);
    expect(merged.form.title).toBe('My own title');
    expect(merged.form.description).toBe(next.description);
    expect(merged.updated).toEqual(['Description']);
  });
});
