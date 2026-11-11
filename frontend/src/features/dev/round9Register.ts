/** Registers the round 9 composed pages at /__mock/round9/<variant> (dev only; see Round9Mocks.tsx). */
import { lazy } from 'react';
import { registerMock } from '@/app/mocks';

const names = [
  'create-home',
  'create-home-flagged',
  'customize-where',
  'customize-models',
  'customize-settings',
  'review',
  'preset-edit',
  'preset-publish',
  'environment-experiments',
  'environment-settings',
  'environments-table',
  'sheet-bar',
  'sheet-boxes',
  'sheet-task',
  'sheet-priority',
  'sheet-table',
] as const;

for (const variant of names) {
  registerMock({
    area: 'round9',
    variant,
    title: `Round 9: ${variant}`,
    component: lazy(() => import('./Round9Mocks').then((m) => ({ default: m.ROUND9_PAGES[variant]!.Page }))),
  });
}
