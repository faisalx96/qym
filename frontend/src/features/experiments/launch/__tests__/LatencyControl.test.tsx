import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LatencyControl } from '../entry/LatencyControl';
import { RunSettings } from '../entry/RunSettings';
import { LATENCY_HELPER } from '../copy';
import { live, makeEnv, renderSection } from './sectionTestKit';

/** QA3-10 to QA3-16, QA3-23: the one control the home view and Customize step 1 both render. */
const box = () => screen.getByRole('checkbox', { name: 'Latency-sensitive run' }) as HTMLInputElement;

describe('LatencyControl', () => {
  it('off: checkbox, helper, no reason and no callout', () => {
    renderSection(<LatencyControl />);
    expect(box().checked).toBe(false);
    expect(screen.getByTestId('launch-latency')).toBeTruthy();
    expect(screen.getByText(LATENCY_HELPER)).toBeTruthy();
    expect(screen.queryByTestId('launch-latency-reason')).toBeNull();
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('on: the warning callout (role note), one document value', () => {
    renderSection(<LatencyControl />);
    fireEvent.click(box());
    expect(live.current?.doc.latencySensitive).toBe(true);
    expect(screen.getByRole('note')).toHaveTextContent('Other jobs wait while this run executes');
  });

  it('partial gate: names the managers-only environment for a member', () => {
    renderSection(<LatencyControl />, {
      canManage: false,
      envs: [makeEnv('open', 'staging'), makeEnv('prod', 'production', { latencyMinRole: 'manager' })],
    });
    fireEvent.click(box());
    expect(box().disabled).toBe(false);
    expect(screen.getByRole('note')).toHaveTextContent('Only a project manager can launch it on production.');
  });

  it('disabled: reason shown, and a ticked box is cleared at that moment', () => {
    renderSection(<LatencyControl />, {
      canManage: false,
      envs: [makeEnv('prod', 'production', { latencyMinRole: 'manager' })],
    });
    expect(box().disabled).toBe(true);
    expect(screen.getByTestId('launch-latency-reason')).toHaveTextContent(
      'Only project managers can launch latency-sensitive runs on production.',
    );
    expect(box().getAttribute('aria-describedby')).toBe('launch-latency-help launch-latency-reason');
    expect(live.current?.doc.latencySensitive).toBe(false);
  });

  it('read only: disabled, helper stays, no reason', () => {
    renderSection(<LatencyControl />, { overrides: { readOnly: true } });
    expect(box().disabled).toBe(true);
    expect(screen.getByText(LATENCY_HELPER)).toBeTruthy();
    expect(screen.queryByTestId('launch-latency-reason')).toBeNull();
  });

  it('is the same DOM on step 1 (RunSettings) as on its own', () => {
    const alone = renderSection(<LatencyControl />);
    const aloneHtml = screen.getByTestId('launch-latency').outerHTML;
    alone.unmount();
    renderSection(<RunSettings />);
    expect(screen.getAllByTestId('launch-latency')).toHaveLength(1);
    expect(screen.getByTestId('launch-latency').outerHTML).toBe(aloneHtml);
    expect(screen.queryByLabelText('Versioning details')).toBeNull();
    expect(document.querySelector('textarea')).toBeNull();
  });
});
