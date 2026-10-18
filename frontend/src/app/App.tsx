import { useEffect, useState } from 'react';
import { initRunStatusBus } from '@/lib/run-status';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { I18nProvider } from 'react-aria-components';
import { ToastProvider } from '@/ui/Toast';
import { createQueryClient } from './queryClient';
import { prefetchDeepLink } from './prefetch';
import { createAppRouter } from './router';

export function App() {
  const [queryClient] = useState(createQueryClient);
  // A deep link to a run asks for its data and its chunk at once (an effect: no side effect in a state initializer,
  // which StrictMode runs twice; the second prefetch of the same key shares the first request).
  useEffect(() => prefetchDeepLink(queryClient), [queryClient]);
  const [router] = useState(createAppRouter);
  useEffect(() => initRunStatusBus(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale="en-US">
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>
  );
}
