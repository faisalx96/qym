import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { buildMatrix } from '../lib/matrix';
import { makeDetail, makeJob } from '../lib/testData';
import { MatrixCard } from './MatrixCard';
import type { ExperimentFlows } from './useExperimentFlows';

function renderCard(canControl: boolean, canSavePreset: boolean) {
  const job = makeJob({
    id: 'j1',
    environment_id: 'e1',
    status: 'SUCCEEDED',
    qym_config: { env_overrides: {} } as never,
  });
  const flows = {
    busy: new Set<string>(),
    denied: false,
    savePreset: vi.fn(),
    dialogs: null,
  } as unknown as ExperimentFlows;
  render(
    <MemoryRouter>
      <MatrixCard
        slug="p"
        matrix={buildMatrix(makeDetail([job]))}
        selected={[]}
        onToggle={vi.fn()}
        onSelectAll={vi.fn()}
        onClear={vi.fn()}
        onCompare={vi.fn()}
        onShowAttempts={vi.fn()}
        flows={flows}
        canControl={canControl}
        canSavePreset={canSavePreset}
        canPromote={false}
        onPromote={vi.fn()}
      />
    </MemoryRouter>,
  );
}

async function openCellMenu() {
  await userEvent.setup().click(screen.getByRole('button', { name: /^Actions: / }));
}

describe('MatrixCard cell menu (E2)', () => {
  it('keeps one handle per cell and no action buttons at rest', () => {
    renderCard(true, true);
    expect(screen.getAllByRole('button', { name: /^Actions: / })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /Save as preset/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Promote to default preset/ })).toBeNull();
  });

  it('offers Save as preset to a member who may not cancel or retry (the server only asks for project access)', async () => {
    renderCard(false, true);
    await openCellMenu();
    expect(screen.getByRole('menuitem', { name: /Save as preset/ }).getAttribute('aria-disabled')).not.toBe(
      'true',
    );
  });

  it('turns Save as preset off when saving presets is not allowed (read-only project)', async () => {
    renderCard(true, false);
    await openCellMenu();
    expect(screen.getByRole('menuitem', { name: /Save as preset/ }).getAttribute('aria-disabled')).toBe(
      'true',
    );
  });
});
