import { describe, expect, it } from 'vitest';
import type { ChecklistItem } from '@/api/feedback';
import { gapLabels, knownCount, STATE_WORD } from '../checklist';

const item = (key: string, state: ChecklistItem['state']): ChecklistItem => ({ key, label: key.toUpperCase(), state, value: '' });

describe('checklist', () => {
  it('counts known and declined items as known', () => {
    const items = [item('a', 'filled'), item('b', 'declined'), item('c', 'partial'), item('d', 'open')];
    expect(knownCount(items)).toBe(2);
  });
  it('names every state with a word, never a colour alone', () => {
    expect(STATE_WORD).toEqual({ filled: 'Known', partial: 'Partly known', open: 'Not asked yet', declined: 'Not known' });
  });
  it('lists the labels of the gaps', () => {
    expect(gapLabels([item('urgency', 'open'), item('scope', 'open')], ['urgency', 'scope', 'zzz'])).toEqual(['URGENCY', 'SCOPE', 'zzz']);
  });
});
