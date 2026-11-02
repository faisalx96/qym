import type { Member } from '@/api/types';

/** Who can take over a removed member's runs: everyone but the removed member and disabled accounts (the server refuses them). */
export function transferCandidates(members: readonly Member[], removedUserId: string | undefined): Member[] {
  return members.filter((m) => m.user_id !== removedUserId && m.is_active !== false);
}
