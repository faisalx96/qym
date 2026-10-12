import { describe, expect, it } from 'vitest';
import type { Member } from '@/api/types';
import { transferCandidates } from '../transferCandidates';

const member = (user_id: string, is_active: boolean): Member => ({
  user_id,
  email: `${user_id}@x.com`,
  display_name: user_id,
  role: 'MEMBER',
  is_active,
  created_at: '',
  updated_at: '',
});

describe('transferCandidates', () => {
  it('leaves out the removed member and disabled members', () => {
    const members = [
      member('owner', true),
      member('gone', true),
      member('disabled', false),
      member('peer', true),
    ];
    expect(transferCandidates(members, 'gone').map((m) => m.user_id)).toEqual(['owner', 'peer']);
  });

  it('offers everyone active when nobody is being removed', () => {
    expect(
      transferCandidates([member('a', true), member('b', false)], undefined).map((m) => m.user_id),
    ).toEqual(['a']);
  });
});
