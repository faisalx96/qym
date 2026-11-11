import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Facets } from '@/api/dashboardTypes';
import { expandModelValues } from '@/lib/runs-order';
import { facetSummary, showOriginControl } from '../FilterBar';
import { buildFacetDefs } from '../FiltersPopover';
import { deleteDescription, retentionLabel } from '../RunDialogs';
import { SelectionBar } from '../SelectionBar';
import { DEFAULT_VIEW, type RunsView } from '../urlState';

/** Runs toolbar, select mode and delete copy (review group L2: C069, C224, C208, C251, C034). */

const facets = (over: Partial<Facets> = {}): Facets => ({
  tasks: [],
  models: [],
  datasets: [],
  statuses: ['COMPLETED', 'STOPPED'],
  versions: [],
  users: [],
  origins: ['local'],
  versioning: {},
  ...over,
});
const view = (over: Partial<RunsView> = {}): RunsView => ({ ...DEFAULT_VIEW, ...over }) as RunsView;

describe('the Origin control (C208)', () => {
  it('is hidden when the project has no official run', () => {
    expect(showOriginControl(view(), facets())).toBe(false);
  });
  it('shows when the project has an official run', () => {
    expect(showOriginControl(view(), facets({ origins: ['local', 'official'] }))).toBe(true);
  });
  it('stays while an Origin filter is set, so the URL parameter can be reset', () => {
    expect(showOriginControl(view({ origin: 'official' }), facets())).toBe(true);
  });
});

describe('the Status filter always offers Submitted (C034)', () => {
  it('adds it after Completed', () => {
    const status = buildFacetDefs(view(), facets(), {}).find((d) => d.id === 'statuses')!;
    expect(status.options.map((o) => o.label)).toEqual(['Completed', 'Submitted', 'Stopped']);
  });
  it('does not repeat it', () => {
    const status = buildFacetDefs(view(), facets({ statuses: ['SUBMITTED'] }), {}).find(
      (d) => d.id === 'statuses',
    )!;
    expect(status.options.map((o) => o.value)).toEqual(['SUBMITTED']);
  });
});

describe('the delete dialog names Deleted runs and its Retention (C251, C178)', () => {
  it('Off reads as kept until restored', () => {
    expect(retentionLabel(0)).toBe('Off (kept until restored)');
    expect(deleteDescription(0)).toBe(
      'Whole runs move to Deleted runs, where an admin can restore them. Retention: Off (kept until restored). Deleting a single pass is permanent.',
    );
  });
  it('a number of days', () => {
    expect(retentionLabel(1)).toBe('1 day');
    expect(deleteDescription(30)).toContain('Retention: 30 days.');
  });
  it('says nothing about Retention when the value is not known', () => {
    expect(deleteDescription(null)).not.toContain('Retention');
  });
});

describe('select mode counts runs (C251)', () => {
  const bar = (count: number) =>
    render(
      <SelectionBar
        count={count}
        cohortA={[]}
        cohortAUnits={0}
        cohortOverlap={false}
        readOnly={false}
        canSubmit
        canDelete
        onCompare={vi.fn()}
        onCohort={vi.fn()}
        onSubmit={vi.fn()}
        onDelete={vi.fn()}
        onClear={vi.fn()}
        onCancelCohort={vi.fn()}
        onDone={vi.fn()}
      />,
    );
  it('says runs, not executions', () => {
    bar(2);
    expect(screen.getByText('2 runs selected')).toBeInTheDocument();
    expect(screen.queryByText(/execution/)).toBeNull();
  });
  it('one run', () => {
    bar(1);
    expect(screen.getByText('1 run selected')).toBeInTheDocument();
  });
  it('keeps the name Cohort', () => {
    bar(2);
    expect(screen.getByRole('button', { name: 'Cohort' })).toBeInTheDocument();
  });
});

describe('model facet summary (C225)', () => {
  it('counts a model picked by name once, though it selects its plain and reasoning keys', () => {
    const models = expandModelValues(['gpt-4.1']);
    expect(models.length).toBe(2);
    const view: RunsView = { ...DEFAULT_VIEW, models };
    const facets = { models } as unknown as Facets;
    const def = buildFacetDefs(view, facets, {}).find((d) => d.id === 'models')!;
    expect(facetSummary(def, view.models)).toBe('gpt-4.1');
    const two = [...models, ...expandModelValues(['claude'])];
    expect(facetSummary(def, two)).toBe('2');
  });
});
