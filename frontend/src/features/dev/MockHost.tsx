import { Suspense } from 'react';
import { Link, useParams } from 'react-router-dom';
import { mockRoutes } from '@/app/mocks';
import { EmptyState, Stack, Text } from '@/ui';

/** /__mock/:area/:variant — renders a registered design variant (dev only). */
export function MockHost() {
  const { area, variant } = useParams();
  const match = mockRoutes.find((m) => m.area === area && m.variant === variant);
  if (!match) {
    return (
      <Stack gap="md" style={{ padding: 'var(--space-xl)' }}>
        <EmptyState
          title="No such mock"
          body={`Register it in src/app/mocks.ts (area "${area}", variant "${variant}").`}
        />
        <Text variant="lg">Registered mocks</Text>
        <ul>
          {mockRoutes.map((m) => (
            <li key={`${m.area}/${m.variant}`}>
              <Link to={`/__mock/${m.area}/${m.variant}`}>
                {m.area} / {m.variant} — {m.title}
              </Link>
            </li>
          ))}
        </ul>
      </Stack>
    );
  }
  const Component = match.component;
  return (
    <Suspense fallback={null}>
      <Component />
    </Suspense>
  );
}
