import { useQuery, useQueryClient } from '@tanstack/react-query';
import { performanceKeys } from '@/api/performance';
import type { PlatformProgress, PlatformTokenHint } from '@/api/performancePlatform';

type Receipt = { requestAt: string | null; version: number };
export const SIGN_IN_SAVED = 'New sign-in saved. The test picks it up within a few seconds.';

/** Only server timestamps and a successful write receipt decide this; never a client timer. */
export function signInSaved(
  progress: PlatformProgress | null,
  tokens: PlatformTokenHint[],
  receipt?: Receipt | null,
): boolean {
  const requestedAt = progress?.auth.rejected_at ?? null;
  const saved = tokens.find((token) => token.name === 'session_cookie');
  if (requestedAt && saved?.updated_at && Date.parse(saved.updated_at) >= Date.parse(requestedAt))
    return true;
  // The POST returns a version, not a timestamp. Acknowledge this request immediately while
  // invalidation loads its saved timestamp; a later rejection must be evaluated from the read.
  return Boolean(receipt && (saved?.version ?? 0) < receipt.version && requestedAt === receipt.requestAt);
}
export function useSignInSaved(
  slug: string,
  runId: string,
  progress: PlatformProgress | null,
  tokens: PlatformTokenHint[],
) {
  const client = useQueryClient();
  const queryKey = [...performanceKeys.all(slug), 'platform-sign-in-receipt', runId];
  const receipt = useQuery<Receipt | null>({
    queryKey,
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  });
  return {
    saved: signInSaved(progress, tokens, receipt.data),
    acknowledge: (version: number) =>
      client.setQueryData<Receipt>(queryKey, { requestAt: progress?.auth.rejected_at ?? null, version }),
  };
}
