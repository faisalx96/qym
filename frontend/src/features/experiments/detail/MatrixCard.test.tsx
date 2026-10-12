import { render, screen } from '@testing-library/react';
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

describe('MatrixCard save as preset', () => {
  it('stays available to a member who may not cancel or retry (the server only asks for project access)', () => {
    renderCard(false, true);
    expect(screen.getByRole('button', { name: /^Save as preset/ })).toBeEnabled();
  });

  it('is off when saving presets is not allowed (read-only project)', () => {
    renderCard(true, false);
    expect(screen.getByRole('button', { name: /^Save as preset/ })).toBeDisabled();
  });
});
