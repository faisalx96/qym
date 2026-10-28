import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StepsBar } from '../LaunchBar';
import { EDITOR_STEPS, WIZARD_STEPS, type WizardStepDef, type WizardStepId } from '../../wizard/steps';

const PARTS = ['bar-back', 'bar-skip', 'bar-continue', 'bar-status', 'bar-cancel', 'bar-launch'];

function bar(step: WizardStepId, steps: readonly WizardStepDef[] = WIZARD_STEPS) {
  const fns = { onBack: vi.fn(), onGo: vi.fn(), onCancel: vi.fn(), onPress: vi.fn() };
  const view = render(
    <StepsBar
      steps={steps}
      step={step}
      onBack={fns.onBack}
      onGo={fns.onGo}
      onCancel={fns.onCancel}
      primary={{ label: 'Launch 6 runs', disabled: false, onPress: fns.onPress }}
      status="status"
    />,
  );
  return { ...view, ...fns };
}

describe('LaunchBar (round 9, point 3)', () => {
  it.each(WIZARD_STEPS.map((s) => s.id))('C-3-2 the same six parts on step %s', (step) => {
    const { container } = bar(step);
    const parts = Array.from(container.querySelectorAll('[data-part]')).map((e) => e.getAttribute('data-part'));
    expect(parts.filter((p) => PARTS.includes(p!)).sort()).toEqual([...PARTS].sort());
    expect(container.querySelectorAll('button')).toHaveLength(5);
  });

  it('C-3-4 Skip and Continue are disabled on the review step and enabled elsewhere', () => {
    const review = bar('review');
    expect(screen.getByRole('button', { name: /Skip to review/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Skip to review/ })).toHaveAttribute('aria-disabled', 'true');
    review.unmount();
    bar('models');
    expect(screen.getByRole('button', { name: /Skip to review/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Continue to environment configurations' })).toBeEnabled();
  });

  it('C-3-2 labels are fixed; the destination is the accessible name', async () => {
    const view = bar('where');
    expect(screen.getByRole('button', { name: 'Continue to starting point' })).toHaveTextContent(/^Continue$/);
    await userEvent.click(screen.getByRole('button', { name: 'Continue to starting point' }));
    expect(view.onGo).toHaveBeenCalledWith('start');
    // Back from the first step goes to the start view
    await userEvent.click(screen.getByRole('button', { name: 'Back to the start' }));
    expect(view.onBack).toHaveBeenCalledTimes(1);
  });

  it('Skip jumps to the last step, Launch and Cancel call their handlers', async () => {
    const view = bar('models');
    await userEvent.click(screen.getByRole('button', { name: /Skip to review/ }));
    expect(view.onGo).toHaveBeenCalledWith('review');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await userEvent.click(screen.getByRole('button', { name: 'Launch 6 runs' }));
    expect(view.onCancel).toHaveBeenCalled();
    expect(view.onPress).toHaveBeenCalled();
  });

  it('C-8-2 the editor uses the same slots over its own step list', async () => {
    const view = bar('models', EDITOR_STEPS);
    expect(screen.getByRole('button', { name: 'Back to environment and dataset' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Back to environment and dataset' }));
    expect(view.onGo).toHaveBeenCalledWith('where');
    expect(screen.getByRole('button', { name: /Continue to environment configurations/ })).toBeEnabled();
  });
});
