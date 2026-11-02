import { useEffect, useState } from 'react';
import { initRunStatusBus } from '@/lib/run-status';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { I18nProvider } from 'react-aria-components';
import { ToastProvider } from '@/ui/Toast';
import { createQueryClient } from './queryClient';
import { bindPrefetchClient } from './prefetch';
import { createAppRouter } from './router';

export function App() {
  const [queryClient] = useState(() => {
    const client = createQueryClient();
    bindPrefetchClient(client); // the run route's loader prefetches into this client
    return client;
  });
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
