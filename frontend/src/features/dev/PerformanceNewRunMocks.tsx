/**
 * Performance mocks: New run. The mock is the real page (`features/performance/NewRunPage`) inside the gallery
 * shell, reading from a query client of its own that is filled from the fixtures: nothing is fetched. A mock
 * with a dialog opens the page with that dialog open.
 */
import { useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import {
  dsKeys,
  type Dataset,
  type DatasetItem,
  type DatasetVersion,
  type ItemsResponse,
} from '@/api/datasets';
import {
  performanceKeys,
  type PerformanceDataset,
  type PerformanceDatasetsRead,
  type PerformanceSetupTarget,
} from '@/api/performance';
import { NewRunPage, type NewRunInitial } from '@/features/performance/NewRunPage';
import { AuthContext, type AuthValue } from '@/features/shell/AuthContext';
import { RealPageShell, fixtureClient } from './PerformanceHomeMocks';
import {
  performanceAvoidWords,
  performanceDatasets,
  performanceSampleQuestions,
  performanceSetup,
} from './performanceFixtures';

export type NewRunStep = 1 | 2 | 3 | 4 | 5;
export type NewRunDialog = 'add-target' | 'upload-fields' | 'confirm-production';

const SLUG = 'demo';
/** The page's "if started now" is the moment of the setup read. */
const NOW = Date.parse(performanceSetup.server_time);

/** The person of the gallery shell, so "Started by" names someone. */
const AUTH: AuthValue = {
  me: {
    id: 'user-dev',
    email: 'dev.user@example.org',
    display_name: 'Dev User',
    role: 'MEMBER',
    auth_type: 'none',
    needs_admin_bootstrap: false,
    can_bootstrap_admin: false,
    projects: [],
    default_project: null,
  },
  isAdmin: false,
  refetch: () => undefined,
};

/** The fixtures' datasets as the list read gives them: a draft-only dataset has no published version. */
const DATASETS: PerformanceDataset[] = performanceDatasets.map((sample) => ({
  id: sample.id,
  name: sample.name,
  slug: sample.id,
  latest_published_version:
    sample.status === 'published'
      ? { id: sample.tiers.dataset_version_id, name: sample.tiers.version }
      : null,
  item_count: sample.tiers.item_count,
  tier_counts: sample.tiers.tier_counts,
  follow_ups: sample.tiers.follow_ups,
  single_kind: sample.tiers.single_kind,
  updated_by: sample.updated_by,
  updated_by_user_id: `user-${sample.updated_by.toLowerCase()}`,
  updated_at: sample.updated_at,
}));

/** The questions the Questions step reads for its samples: the sample questions of the fixtures. */
const ITEMS: ItemsResponse = {
  items: performanceSampleQuestions.map((question, index): DatasetItem => ({
    id: index + 1,
    item_id: question.id,
    index,
    input: question.question,
    expected_output: null,
    metadata: {
      tier: question.kind,
      must_not_contain: performanceAvoidWords,
      ...(question.follow_up ? { follow_up: question.follow_up } : {}),
    },
    labels: [question.kind],
    created_at: '2026-11-12T08:10:00Z',
    updated_at: '2026-11-12T08:10:00Z',
  })),
  metric_names: [],
  metric_directions: {},
  total: performanceSampleQuestions.length,
  next_offset: null,
};

/** A question file in the suite's own structure (three named lists), built from the sample questions. */
const UPLOAD_FILE = {
  name: 'questions.json',
  text: JSON.stringify({
    _instructions: { howToUse: 'Edit the three lists below.' },
    ...Object.fromEntries(
      (['simple', 'medium', 'complex'] as const).map((kind) => [
        kind,
        performanceSampleQuestions
          .filter((question) => question.kind === kind)
          .map((question) => ({
            id: question.id,
            question: question.question,
            description: 'From the question bank',
            mustNotContain: performanceAvoidWords,
            followUpQuestions: question.follow_up
              ? [{ question: question.follow_up, mustNotContain: performanceAvoidWords }]
              : [],
          })),
      ]),
    ),
  }),
};

/** What the Add a target mock has typed. */
const TARGET_FORM = { name: 'Playground 31', address: 'https://insightor.ingress.playground31.example.org' };

function newRunClient(target: PerformanceSetupTarget) {
  return fixtureClient((client) => {
    const targets = performanceSetup.targets.map((item) => (item.id === target.id ? target : item));
    client.setQueryData(performanceKeys.setup(SLUG), { ...performanceSetup, targets, received_at: NOW });
    client.setQueryData<PerformanceDatasetsRead>(performanceKeys.datasets(SLUG), { datasets: DATASETS });
    for (const sample of performanceDatasets)
      client.setQueryData(performanceKeys.datasetTiers(SLUG, sample.tiers.dataset_version_id), sample.tiers);
    // A dataset that only has a draft: the page reads its versions to name the draft.
    for (const sample of performanceDatasets)
      if (sample.status === 'draft')
        client.setQueryData(dsKeys.versions(SLUG, sample.id), {
          dataset: { id: sample.id, name: sample.name } as Dataset,
          versions: [
            {
              id: sample.tiers.dataset_version_id,
              version: sample.tiers.version,
              name: sample.tiers.version,
              status: 'draft',
              created_at: sample.updated_at,
            } as DatasetVersion,
          ],
        });
    for (const item of DATASETS)
      if (item.latest_published_version)
        client.setQueryData(
          dsKeys.items(SLUG, item.slug, item.latest_published_version.name, { limit: 200, offset: 0 }),
          ITEMS,
        );
  });
}

const DIALOG: Record<NewRunDialog, Pick<NewRunInitial, 'dialog' | 'uploadFile' | 'targetForm'>> = {
  'add-target': { dialog: 'add-target', targetForm: TARGET_FORM },
  'upload-fields': { dialog: 'upload', uploadFile: UPLOAD_FILE },
  'confirm-production': { dialog: 'start' },
};

export function PerformanceNewRunPage({
  variant,
  step,
  target,
  dialog,
}: {
  variant: string;
  step: NewRunStep;
  /** The chosen target; it replaces the fixtures' target with the same id. */
  target: PerformanceSetupTarget;
  dialog?: NewRunDialog;
}) {
  const [client] = useState(() => newRunClient(target));
  return (
    <RealPageShell variant={variant} crumbs={['New run']}>
      <QueryClientProvider client={client}>
        <AuthContext.Provider value={AUTH}>
          <NewRunPage
            slug={SLUG}
            initial={{ step, targetId: target.id, ...(dialog ? DIALOG[dialog] : {}) }}
          />
        </AuthContext.Provider>
      </QueryClientProvider>
    </RealPageShell>
  );
}
