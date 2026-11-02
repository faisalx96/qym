import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const ctx = vi.hoisted(() => ({
  value: { canManage: false, readOnly: false } as { canManage: boolean; readOnly: boolean },
}));

vi.mock('@/features/shell', () => ({
  useProjectContext: () => ({ project: { id: 'p1', name: 'Proj' }, slug: 'proj', ...ctx.value }),
  useDocumentTitle: () => undefined,
  useMediaQuery: () => true,
}));
vi.mock('@/api/evalCommon', () => ({
  useEvalEnvironments: () => ({ isPending: false, isError: false, data: [{ id: 'e1', name: 'Alpha' }] }),
}));
vi.mock('@/features/experiments/launch/LaunchProvider', () => ({
  LaunchProvider: () => <div>editor mounted</div>,
}));

import { DefaultPresetEditorPage } from '../DefaultPresetEditorPage';

function renderPage() {
  return render(
    <MemoryRouter>
      <DefaultPresetEditorPage environmentId="e1" />
    </MemoryRouter>,
  );
}

describe('DefaultPresetEditorPage access', () => {
  it('a non-manager sees the read-only notice and no editor', () => {
    ctx.value = { canManage: false, readOnly: false };
    renderPage();
    expect(screen.getByText('Only managers publish the default preset')).toBeTruthy();
    expect(screen.queryByText('editor mounted')).toBeNull();
    expect(screen.getAllByRole('link', { name: 'Back to the environment' }).length).toBeGreaterThan(0);
  });

  it('an archived project cannot publish', () => {
    ctx.value = { canManage: true, readOnly: true };
    renderPage();
    expect(screen.getByText('This project is archived')).toBeTruthy();
    expect(screen.queryByText('editor mounted')).toBeNull();
  });

  it('a manager gets the editor', () => {
    ctx.value = { canManage: true, readOnly: false };
    renderPage();
    expect(screen.getByText('editor mounted')).toBeTruthy();
  });
});
