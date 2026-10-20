import { describe, expect, it } from 'vitest';
import {
  pluralItems,
  publishDisabledNote,
  stateCount,
  stateTotalText,
  stateUrlValue,
  versionItemsText,
} from '../itemState';

const counts = { active: 124, disabled: 6, all: 130 };

describe('state in the URL (A2-2)', () => {
  it('omits the default', () => {
    expect(stateUrlValue('active')).toBeUndefined();
    expect(stateUrlValue('disabled')).toBe('disabled');
    expect(stateUrlValue('all')).toBe('all');
  });
});

describe('counts (A2-3, A2-6)', () => {
  it('reads each option from the counts and sums to all', () => {
    expect(stateCount(counts, 'active')).toBe(124);
    expect(stateCount(counts, 'disabled')).toBe(6);
    expect(counts.active + counts.disabled).toBe(counts.all);
    expect(stateCount(undefined, 'all')).toBeUndefined();
  });
  it('words the toolbar count for the selected state', () => {
    expect(stateTotalText('active', counts, 130)).toBe('124 items');
    expect(stateTotalText('disabled', counts, 130)).toBe('6 items');
    expect(stateTotalText('all', counts, 130)).toBe('130 items');
    expect(stateTotalText('disabled', { active: 3, disabled: 1, all: 4 }, 4)).toBe('1 item');
    expect(stateTotalText('active', undefined, 9)).toBe('9 items');
  });
});

describe('version header and publish note (A2-36, A2-40)', () => {
  it('shows the disabled count only when there is one', () => {
    expect(versionItemsText(130, 6)).toBe('130 items (6 disabled)');
    expect(versionItemsText(130, 0)).toBe('130 items');
    expect(versionItemsText(1, undefined)).toBe('1 item');
    expect(pluralItems(0)).toBe('0 items');
  });
  it('words the publish note in singular and plural', () => {
    expect(publishDisabledNote(6, 'v2')).toBe('6 items are disabled. Runs on v2 skip them.');
    expect(publishDisabledNote(1, 'v2')).toBe('1 item is disabled. Runs on v2 skip it.');
    expect(publishDisabledNote(0, 'v2')).toBe('');
  });
});
