import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RunSettings } from '../entry/RunSettings';
import { LATENCY_HELPER } from '../copy';
import { live, makeEnv, renderSection } from './sectionTestKit';

describe('Latency-sensitive checkbox', () => {
  it('is off by default with its helper, and turning it on shows the warning', () => {
    renderSection(<RunSettings />);
    const box = screen.getByRole('checkbox', { name: 'Latency-sensitive run' });
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText(LATENCY_HELPER)).toBeTruthy();
    expect(screen.queryByText('Other jobs wait while this run executes')).toBeNull();
    fireEvent.click(box);
    expect(live.current?.doc.latencySensitive).toBe(true);
    expect(screen.getByText('Other jobs wait while this run executes')).toBeTruthy();
    expect(screen.queryByText(/Only a project manager can launch it/)).toBeNull();
  });

  it('names the managers-only environments to a member when some are open', () => {
    renderSection(<RunSettings />, {
      canManage: false,
      envs: [makeEnv('open', 'staging'), makeEnv('prod', 'production', { latencyMinRole: 'manager' })],
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Latency-sensitive run' }));
    expect(
      screen.getByText('Only a project manager can launch it on production. Clear the box or ask a project manager.'),
    ).toBeTruthy();
  });

  it('is disabled with a reason when every selected environment needs a manager', () => {
    renderSection(<RunSettings />, {
      canManage: false,
      envs: [makeEnv('prod', 'production', { latencyMinRole: 'manager' })],
    });
    const box = screen.getByRole('checkbox', { name: 'Latency-sensitive run' }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
    expect(screen.getByTestId('launch-latency-reason').textContent).toBe(
      'Only project managers can launch latency-sensitive runs on production.',
    );
    expect(box.getAttribute('aria-describedby')).toContain('launch-latency-reason');
  });

  it('stays enabled for a manager on managers-only environments', () => {
    renderSection(<RunSettings />, {
      canManage: true,
      envs: [makeEnv('prod', 'production', { latencyMinRole: 'manager' })],
    });
    expect((screen.getByRole('checkbox', { name: 'Latency-sensitive run' }) as HTMLInputElement).disabled).toBe(false);
    expect(screen.queryByTestId('launch-latency-reason')).toBeNull();
  });
});
