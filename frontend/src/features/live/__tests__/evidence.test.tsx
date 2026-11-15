import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Bilingual, RulesApplied, ServiceStatus } from '../components/turn/Evidence';
import { rulesAppliedOf } from '../lib/summary';
import { liveEvidenceTurns } from '@/features/dev/liveFixtures';

describe('shared turn evidence', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('uses the main neutral state tag for degraded services', () => {
    render(<ServiceStatus status="degraded" />);
    const status = screen.getByText('Degraded').closest('[data-kind]');
    expect(status).toHaveAttribute('data-kind', 'state');
    expect(status).not.toHaveAttribute('data-tone');
    expect(status).not.toHaveAttribute('data-shape');
  });
  it.each([
    ['failed', 'danger'],
    ['ok', 'success'],
    ['skipped', null],
  ])('preserves the %s status', (status, tone) => {
    const { container } = render(<ServiceStatus status={status} />);
    if (tone) expect(container.firstChild).toHaveAttribute('data-tone', tone);
    else expect(container.firstChild).not.toHaveAttribute('data-tone');
    expect(container.firstChild).toHaveAttribute('data-kind', 'state');
    expect(container.firstChild).not.toHaveAttribute('data-shape');
  });
  it('shows both languages with explicit directions and fixed labels', () => {
    render(<Bilingual en="English analysis" ar="التحليل العربي" />);
    expect(screen.getByText('English')).toBeVisible();
    expect(screen.getByText('Arabic')).toBeVisible();
    expect(screen.getByText('English analysis')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('التحليل العربي')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('التحليل العربي')).toHaveAttribute('lang', 'ar');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it('renders only supplied sides and nothing for absent text', () => {
    const view = render(<Bilingual en="English analysis" ar={null} />);
    expect(screen.queryByText('Arabic')).not.toBeInTheDocument();
    view.rerender(<Bilingual en={null} ar="التحليل العربي" />);
    expect(screen.queryByText('English')).not.toBeInTheDocument();
    view.rerender(<Bilingual en={null} ar={null} />);
    expect(view.container).toBeEmptyDOMElement();
  });
  it('supports an explicit clamp while keeping both language blocks present', async () => {
    const user = userEvent.setup();
    render(
      <Bilingual en={'Long English analysis. '.repeat(20)} ar={'التحليل العربي. '.repeat(20)} clamp={2} />,
    );
    expect(screen.getAllByRole('button', { name: 'Show more' })).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: 'Show more' })[0]!);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });
  it('renders rule text, mono IDs and sources with working copy controls', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('isSecureContext', true);
    const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const rules = rulesAppliedOf(liveEvidenceTurns['privacy-refusal'].summary);
    const rule = rules[0]!;
    render(<RulesApplied rules={rules} />);
    expect(screen.getByText('G5')).toHaveAttribute('data-kind', 'data');
    expect(screen.getByText(rule.titleEn!)).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(rule.titleAr!)).toHaveAttribute('lang', 'ar');
    expect(screen.getByText(rule.verdictEn!)).toBeVisible();
    expect(screen.getByText(rule.verdictAr!)).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText(rule.sources[0]!)).toHaveAttribute('data-mono');
    await user.click(screen.getByRole('button', { name: 'Copy rule source' }));
    expect(writeText).toHaveBeenCalledWith(rule.sources[0]);
    writeText.mockRestore();
  });
  it('renders no empty rules container', () => {
    expect(render(<RulesApplied rules={[]} />).container).toBeEmptyDOMElement();
  });
});
