import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bilingual, RulesApplied, ServiceStatus, SqlPreview } from '../components/turn/Evidence';
import { ExplanationLanguageProvider, explanationLanguageKey } from '../ExplanationLanguage';
import { rulesAppliedOf } from '../lib/summary';
import { liveEvidenceTurns } from '@/features/dev/liveFixtures';

describe('shared turn evidence', () => {
  beforeEach(() => localStorage.removeItem(explanationLanguageKey));
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.removeItem(explanationLanguageKey);
  });
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
  it('shows both languages with explicit directions and no repeated language labels', () => {
    localStorage.setItem(explanationLanguageKey, 'both');
    render(
      <ExplanationLanguageProvider>
        <Bilingual en="English analysis" ar="التحليل العربي" />
      </ExplanationLanguageProvider>,
    );
    expect(screen.queryByText('English')).not.toBeInTheDocument();
    expect(screen.queryByText('Arabic')).not.toBeInTheDocument();
    expect(screen.getByText('English analysis')).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('التحليل العربي')).toHaveAttribute('dir', 'rtl');
    expect(screen.getByText('التحليل العربي')).toHaveAttribute('lang', 'ar');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
  it.each(['en', 'ar', 'both', 'invalid'])(
    'honours the stored %s preference without substituting missing translations',
    (language) => {
      localStorage.setItem(explanationLanguageKey, language);
      const view = render(
        <ExplanationLanguageProvider>
          <Bilingual en="English analysis" ar="التحليل العربي" />
        </ExplanationLanguageProvider>,
      );
      expect(screen.queryByText('English analysis') !== null).toBe(language !== 'ar');
      expect(screen.queryByText('التحليل العربي') !== null).toBe(language === 'ar' || language === 'both');
      view.rerender(
        <ExplanationLanguageProvider>
          <Bilingual
            en={language === 'ar' ? 'English analysis' : null}
            ar={language === 'ar' ? null : 'التحليل العربي'}
          />
        </ExplanationLanguageProvider>,
      );
      if (language !== 'both') expect(view.container).toBeEmptyDOMElement();
    },
  );
  it('defaults to English when storage access throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('Blocked');
      },
    });
    render(
      <ExplanationLanguageProvider>
        <Bilingual en="English analysis" ar="التحليل العربي" />
      </ExplanationLanguageProvider>,
    );
    expect(screen.getByText('English analysis')).toBeInTheDocument();
    expect(screen.queryByText('التحليل العربي')).not.toBeInTheDocument();
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
    localStorage.setItem(explanationLanguageKey, 'both');
    render(
      <ExplanationLanguageProvider>
        <Bilingual en={'Long English analysis. '.repeat(20)} ar={'التحليل العربي. '.repeat(20)} clamp={2} />
      </ExplanationLanguageProvider>,
    );
    expect(screen.getAllByRole('button', { name: 'Show more' })).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: 'Show more' })[0]!);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
  });
  it('renders rule titles and explanations in a table without source locations or copy controls', () => {
    const rules = rulesAppliedOf(liveEvidenceTurns['privacy-refusal'].summary);
    const rule = rules[0]!;
    localStorage.setItem(explanationLanguageKey, 'both');
    render(
      <ExplanationLanguageProvider>
        <RulesApplied rules={rules} />
      </ExplanationLanguageProvider>,
    );
    expect(screen.getByText('G5')).toHaveAttribute('data-kind', 'data');
    expect(screen.getByText(rule.titleEn!)).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText(rule.titleAr!)).toHaveAttribute('lang', 'ar');
    expect(screen.getByText(rule.verdictEn!)).toBeVisible();
    expect(screen.getByText(rule.verdictAr!)).toHaveAttribute('dir', 'rtl');
    expect(screen.getByRole('grid')).toBeInTheDocument();
    expect(screen.queryByText(rule.sources[0]!)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy rule source' })).not.toBeInTheDocument();
  });
  it('uses the shared empty state when there are no cited rules', () => {
    render(<RulesApplied rules={[]} />);
    expect(screen.getByText('No cited rules recorded for this turn')).toBeInTheDocument();
  });

  it('preserves result column names, isolates Arabic cells and aligns numeric columns including nullable samples', () => {
    render(
      <SqlPreview
        expanded
        result={{
          rows: 12,
          columns: ['اسم المدينة', 'TotalOrders', 'nullable', 'mixed'],
          columnsTotal: 4,
          sample: [
            ['الرياض', '12.5', null, '12'],
            ['جدة', '-1e3', '0', 'text'],
          ],
        }}
      />,
    );
    expect(screen.getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'اسم المدينة',
      'TotalOrders',
      'nullable',
      'mixed',
    ]);
    const first = screen.getByText('الرياض');
    expect(first).toHaveAttribute('data-text-mode', 'raw');
    expect(first).toHaveAttribute('dir', 'rtl');
    expect(first).toHaveAttribute('lang', 'ar');
    expect(first.closest('[data-col]')).toHaveAttribute('data-align', 'start');
    for (const value of ['12.5', '-1e3', '0'])
      expect(screen.getByText(value).closest('[data-col]')).toHaveAttribute('data-align', 'end');
    expect(screen.getByText('12').closest('[data-col]')).toHaveAttribute('data-align', 'start');
    const footer = screen.getByText('Showing 2 of 12 rows');
    expect(
      screen.getByRole('grid').compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
