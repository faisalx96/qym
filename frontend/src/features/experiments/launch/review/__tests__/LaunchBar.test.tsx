import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { StepsBar } from '../LaunchBar';
import { EDITOR_STEPS, WIZARD_STEPS, type WizardStepDef, type WizardStepId } from '../../wizard/steps';

// Round 10, C-1-1: five slots in this DOM order on every step; no bar-launch.
const PARTS = ['bar-skip', 'bar-cancel', 'bar-status', 'bar-back', 'bar-continue'];

function bar(
  step: WizardStepId,
  steps: readonly WizardStepDef[] = WIZARD_STEPS,
  opts: { disabled?: boolean; action?: 'launch' | 'publish'; label?: string } = {},
) {
  const fns = { onBack: vi.fn(), onGo: vi.fn(), onCancel: vi.fn(), onPress: vi.fn() };
  const view = render(
    <StepsBar
      steps={steps}
      step={step}
      onBack={fns.onBack}
      onGo={fns.onGo}
      onCancel={fns.onCancel}
      primary={{ label: opts.label ?? 'Launch 6 runs', disabled: opts.disabled ?? false, onPress: fns.onPress }}
      action={opts.action}
      status="status"
    />,
  );
  return { ...view, ...fns };
}

describe('LaunchBar (round 10, point 1)', () => {
  it.each(WIZARD_STEPS.map((s) => s.id))('R10 C-1-1 the same five parts in order on step %s', (step) => {
    const { container } = bar(step);
    const parts = Array.from(container.querySelectorAll('[data-part=launch-bar] [data-part]')).map((e) => e.getAttribute('data-part'));
    expect(parts).toEqual(PARTS);
    expect(container.querySelectorAll('[data-part=bar-launch]')).toHaveLength(0);
    expect(container.querySelectorAll('button')).toHaveLength(4);
  });

  it.each(EDITOR_STEPS.map((s) => s.id))('R10 C-1-1 the editor has the same five parts on step %s', (step) => {
    const { container } = bar(step, EDITOR_STEPS, { action: 'publish', label: 'Publish v2' });
    const parts = Array.from(container.querySelectorAll('[data-part=launch-bar] [data-part]')).map((e) => e.getAttribute('data-part'));
    expect(parts).toEqual(PARTS);
  });

  it('R10 C-1-3 / C-1-4 the primary slot: Continue (enabled whatever the problems) before the last step, the launch on it', () => {
    const where = bar('where', WIZARD_STEPS, { disabled: true });
    const cont = where.container.querySelector('[data-part=bar-continue]')!;
    expect(cont).toHaveAttribute('data-action', 'continue');
    expect(cont).toHaveTextContent(/^Continue$/);
    expect(cont).toHaveAttribute('data-variant', 'neutral');
    expect(cont).toBeEnabled();
    expect(cont).toHaveAttribute('aria-label', 'Continue to starting point');
    expect(screen.getByRole('button', { name: 'Skip to review and launch' })).toBeEnabled();
    expect(screen.queryAllByRole('button', { name: /^(Launch|Publish)/ })).toHaveLength(0);
    where.unmount();

    const review = bar('review', WIZARD_STEPS, { disabled: true });
    const launch = review.container.querySelector('[data-part=bar-continue]')!;
    expect(launch).toHaveAttribute('data-action', 'launch');
    expect(launch).toHaveTextContent('Launch 6 runs');
    expect(launch).toHaveAttribute('data-variant', 'primary');
    expect(launch).toBeDisabled();
    const skip = screen.getByRole('button', { name: 'Skip to review and launch' });
    expect(skip).toBeDisabled();
    expect(skip).toHaveAttribute('aria-disabled', 'true');
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

  it('editor: Back from the first step names the environment page (review O1)', async () => {
    const view = bar('where', WIZARD_STEPS, { action: 'publish' });
    expect(screen.queryByRole('button', { name: 'Back to the start' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Back to the environment' }));
    expect(view.onBack).toHaveBeenCalledTimes(1);
  });

  it('Skip jumps to the last step, Cancel and the last step’s launch call their handlers', async () => {
    const view = bar('models');
    await userEvent.click(screen.getByRole('button', { name: 'Skip to review and launch' }));
    expect(view.onGo).toHaveBeenCalledWith('review');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(view.onCancel).toHaveBeenCalled();
    view.unmount();
    const review = bar('review');
    await userEvent.click(screen.getByRole('button', { name: 'Launch 6 runs' }));
    expect(review.onPress).toHaveBeenCalled();
  });

  it('C-8-2 the editor uses the same slots over its own step list; Publish on its last step', async () => {
    const view = bar('models', EDITOR_STEPS, { action: 'publish', label: 'Publish v2' });
    expect(screen.getByRole('button', { name: 'Back to environment and dataset' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Back to environment and dataset' }));
    expect(view.onGo).toHaveBeenCalledWith('where');
    expect(screen.getByRole('button', { name: /Continue to environment configurations/ })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Skip to review and publish' })).toBeEnabled();
    view.unmount();
    const last = EDITOR_STEPS[EDITOR_STEPS.length - 1]!.id;
    const review = bar(last, EDITOR_STEPS, { action: 'publish', label: 'Publish v2' });
    const primary = review.container.querySelector('[data-part=bar-continue]')!;
    expect(primary).toHaveAttribute('data-action', 'publish');
    expect(primary).toHaveTextContent('Publish v2');
  });
});
