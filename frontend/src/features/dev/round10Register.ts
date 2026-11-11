/** Registers the round 10 composed pages at /__mock/round10/<variant> (dev only; see Round10Mocks.tsx). */
import { lazy } from 'react';
import { registerMock } from '@/app/mocks';

const names = [
  'customize-where',
  'customize-start',
  'review',
  'env-versions',
  'env-versions-none',
  'home-short',
  'sheet-bar',
  'sheet-versions',
  'sheet-runs',
] as const;

for (const variant of names) {
  registerMock({
    area: 'round10',
    variant,
    title: `Round 10: ${variant}`,
    component: lazy(() => import('./Round10Mocks').then((m) => ({ default: m.ROUND10_PAGES[variant]!.Page }))),
  });
}
