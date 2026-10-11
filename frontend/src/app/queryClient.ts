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
      mutations: { retry: false },
    },
  });
}
