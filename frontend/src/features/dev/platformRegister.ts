import { createElement, lazy } from 'react';
import { registerMock } from '@/app/mocks';
import { PLATFORM_FIXTURE_STATES } from '@/features/performance/platform-fixtures';

for (const state of PLATFORM_FIXTURE_STATES) {
  registerMock({
    area: 'performance',
    variant: `platform-${state}`,
    title: `Estishraf platform: ${state}`,
    component: lazy(() =>
      import('./PlatformMocks').then(({ PlatformMockPage }) => ({
        default: () => createElement(PlatformMockPage, { state }),
      })),
    ),
  });
}
for (const page of ['home', 'new', 'targets'] as const) {
  registerMock({
    area: 'performance',
    variant: `platform-${page}`,
    title: `Estishraf platform: ${page}`,
    component: lazy(() =>
      import('./PlatformMocks').then(({ PlatformMockPage }) => ({
        default: () => createElement(PlatformMockPage, { page }),
      })),
    ),
  });
}
registerMock({
  area: 'performance',
  variant: 'platform-home-running',
  title: 'Estishraf platform: active home',
  component: lazy(() =>
    import('./PlatformMocks').then(({ PlatformMockPage }) => ({
      default: () => createElement(PlatformMockPage, { page: 'home', state: 'running' }),
    })),
  ),
});
