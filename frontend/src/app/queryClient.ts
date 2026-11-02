import { QueryClient } from '@tanstack/react-query';
import { ApiError } from '@/lib/http';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true,
        retry: (count, error) => {
          if (error instanceof ApiError && error.status < 500 && error.status !== 0) return false;
          return count < 2;
        },
      },
      // 'always': a click made while offline must fail with a visible network error. With the default
      // ('online') the mutation is paused with a spinner and silently fires whenever the network returns.
      mutations: { retry: false, networkMode: 'always' },
    },
  });
}
