import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { liveDiagnosisSpec, liveOverview, liveTurnDetail, liveTurnsPage } from '@/features/dev/liveFixtures';
import { DIAGNOSES } from '../lib/diagnosis';
import { diagnosisSpec, mixSegments } from '../lib/mix';
import { filterChips } from '../lib/filters';
import { EvaluationScores } from '../components/turn/EvaluationScores';
import { DiagnosisLabel } from '../components/turn/Evidence';
import { DiagnosisVerdict } from '../components/turn/DiagnosisVerdict';
import { ConversationTab } from '../components/turn/ConversationTab';
import { TurnsTable } from '../components/TurnsTable';
import { TurnFilters } from '../components/TurnFilters';
import { DayNumbers } from '../components/DayNumbers';
import { DiagnosisMix } from '../components/DiagnosisMix';
import { DaysTable } from '../components/DaysTable';
import { TrendChart } from '../components/TrendChart';

const staleSpec = {
  ...liveDiagnosisSpec,
  values: DIAGNOSES.slice(0, 6).map(({ value }) => ({ value, label: value, tone: 'neutral' })),
};
const counts = Object.fromEntries(DIAGNOSES.map(({ value }) => [value, 1]));

describe('worker diagnosis labels', () => {
  it.each(DIAGNOSES)(
    'renders $value consistently in tags, verdicts, turns and conversations',
    (diagnosis) => {
      const data = {
        ...liveTurnDetail,
        specs: [staleSpec],
        turn: { ...liveTurnDetail.turn, label: diagnosis.value },
        summary: { verdict: { label: diagnosis.value } },
        conversation: [{ ...liveTurnDetail.conversation[0]!, label: diagnosis.value }],
      };
      const { container } = render(
        <MemoryRouter>
          <DiagnosisLabel value={diagnosis.value} specs={[]} />
          <DiagnosisVerdict data={data} />
          <ConversationTab data={data} slug="demo" source="worker" />
          <TurnsTable
            slug="demo"
            source="worker"
            filters={{}}
            specs={[staleSpec]}
            data={{ ...liveTurnsPage, rows: [{ ...liveTurnsPage.rows[0]!, label: diagnosis.value }] }}
            refreshing={false}
          />
        </MemoryRouter>,
      );
      const marks = container.querySelectorAll('[data-shape], [data-kind="state"]');
      const diagnosisMarks = [...marks].filter((mark) => mark.textContent === diagnosis.label);
      expect(diagnosisMarks).toHaveLength(4);
      for (const mark of diagnosisMarks) {
        expect(mark).toHaveAttribute('data-tone', diagnosis.tone);
        if (diagnosis.series) expect(mark).toHaveAttribute('data-series', String(diagnosis.series));
        else expect(mark).not.toHaveAttribute('data-series');
      }
      const rail = container.querySelector('[data-live-card="why"]');
      if (diagnosis.series) expect(rail).toHaveAttribute('data-series', String(diagnosis.series));
      else expect(rail).toHaveAttribute('data-tone', diagnosis.tone);
    },
  );

  it.each(DIAGNOSES)(
    'names and colours categorical evaluator score $value with a stale spec',
    (diagnosis) => {
      const score = liveTurnDetail.scores.find((item) => item.metric_name === 'diagnosis')!;
      render(
        <EvaluationScores
          data={{
            ...liveTurnDetail,
            specs: [staleSpec],
            scores: [
              {
                ...score,
                spec: staleSpec,
                label: diagnosis.value,
                score_raw: diagnosis.value,
                score_numeric: null,
                skipped: false,
              },
            ],
          }}
        />,
      );
      const grid = within(screen.getByRole('grid', { name: 'Evaluation scores' }));
      const mark = grid.getByText(diagnosis.label);
      expect(mark).toHaveAttribute('data-kind', 'state');
      if (diagnosis.series) expect(mark).toHaveAttribute('data-series', String(diagnosis.series));
      else expect(mark).toHaveAttribute('data-tone', diagnosis.tone);
    },
  );

  it('keeps re-evaluation blue instead of using the previous diagnosis colour', () => {
    const { container } = render(
      <DiagnosisVerdict
        data={{ ...liveTurnDetail, summary: { verdict: { label: 'needs_review' } } }}
        reevaluating
      />,
    );
    const mark = container.querySelector('[data-live-block="diagnosis-label"]');
    expect(mark).toHaveTextContent('Re-evaluating');
    expect(mark).toHaveAttribute('data-tone', 'info');
    expect(mark).not.toHaveAttribute('data-series');
  });

  it.each([{ specs: [] }, { specs: [staleSpec] }])(
    'lists new zero-count diagnoses with a missing or stale spec: $specs',
    ({ specs }) => {
      render(<TurnFilters filters={{}} facets={undefined} specs={specs} />, { wrapper: MemoryRouter });
      for (const { label, series, tone } of DIAGNOSES) {
        const chip = screen.getByRole('button', { name: `${label} 0` });
        expect(chip).toBeVisible();
        const mark = chip.querySelector('[data-chip-mark]');
        if (series) expect(mark).toHaveAttribute('data-series', String(series));
        else expect(mark).toHaveAttribute('data-tone', tone);
      }
      fireEvent.click(screen.getByRole('button', { name: 'Needs review 0' }));
      expect(
        filterChips({ labels: ['needs_review', 'not_verified', 'not_judged'] }, undefined, specs).map(
          ({ label }) => label,
        ),
      ).toEqual(['Diagnosis: Needs review', 'Diagnosis: Not verified', 'Diagnosis: Not judged']);
    },
  );

  it('includes every count in distributions and preserves the existing Not OK and numeric-rate semantics', () => {
    const specs = [staleSpec];
    const data = { ...liveOverview, specs, day: { ...liveOverview.day, label_mix: counts } };
    const trend = [
      { day: '2026-11-01', turns: 9, counts_by_label: counts, primary_rate: 0.75, worker_gap: false },
    ];
    const { container } = render(
      <MemoryRouter>
        <DayNumbers overview={data} linkTo={() => '/turns'} />
        <DiagnosisMix overview={data} linkTo={() => '/turns'} />
        <TrendChart trend={trend} specs={specs} primaryMetric={null} days={14} onDays={() => {}} />
        <DaysTable
          days={{ ...liveOverview.days, rows: [{ ...liveOverview.days.rows[0]!, label_mix: counts }] }}
          specs={specs}
          slug="demo"
          source="worker"
          primaryMetric={null}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-live-stat="not-ok"]')).toHaveTextContent('8');
    const mix = within(screen.getByRole('grid', { name: 'Diagnosis mix' }));
    const trendBlock = container.querySelector('[data-live-block="trend"]') as HTMLElement;
    for (const { label, color, value } of DIAGNOSES) {
      expect(mix.getByText(label)).toBeVisible();
      expect(container.querySelector(`[data-live-label="${value}"]`)?.getAttribute('style')).toContain(color);
    }
    for (const { label, color } of DIAGNOSES) {
      expect(
        within(trendBlock).getByText(label).parentElement?.querySelector('[aria-hidden="true"]'),
      ).toHaveStyle({ background: color });
      expect(trendBlock.querySelector('[data-part="bar"]')?.getAttribute('style')).toContain(color);
      expect(container.querySelector(`[data-live-day] [aria-label="${label}: 1 turns"]`)).toHaveStyle({
        background: color,
      });
    }
    const segments = mixSegments(counts, diagnosisSpec(specs));
    expect(segments).toHaveLength(9);
    expect(segments.every(({ n, share }) => n === 1 && share === 1 / 9)).toBe(true);
  });
});
