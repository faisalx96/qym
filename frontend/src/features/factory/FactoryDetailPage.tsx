/**
 * /projects/:slug/factory/:factoryId — one connected dataset: hero (dataset, source version, grouping, model, last
 * analysis), the Analyze and Generate actions, a line for the running job, and the Rules / Categories / Generation /
 * Access / Settings tabs (`?tab=`). The page refetches every 3 s while a job is queued or running.
 */
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, actionErrorMessage } from '@/lib/http';
import {
  useCancelJob,
  useFactory,
  useFactoryRules,
  useStartJob,
  type FactoryDetail,
  type GenerationParams,
} from '@/api/factory';
import { APP_LOCALE, formatAgo } from '@/lib/dates';
import { useCrumbLabel } from '@/lib/crumb-label';
import { useDelayedPending } from '@/lib/pending';
import { useDocumentTitle, useProjectContext } from '@/features/shell';
import { constrained } from '@/features/shell/layout';
import {
  Button,
  ConfirmDialog,
  ErrorState,
  Icon,
  InlineNotice,
  PageHeader,
  Skeleton,
  TabPanel,
  Tabs,
  useToast,
} from '@/ui';
import { GenerateDialog } from './dialogs';
import { factoryPath, parseFactoryRoute, type FactoryTab } from './lib/route';
import { CategoriesTab } from './tabs/CategoriesTab';
import { FactoryAccessTab } from './tabs/FactoryAccessTab';
import { FactorySettingsTab } from './tabs/FactorySettingsTab';
import { GenerationTab } from './tabs/GenerationTab';
import { RulesTab } from './tabs/RulesTab';
import styles from './FactoryDetailPage.module.css';

export function jobTitle(kind: string): string {
  return kind === 'generation' ? 'Generation' : 'Analysis';
}

export function FactoryDetailPage({ factoryId }: { factoryId: string }) {
  const { slug, project, readOnly } = useProjectContext();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const route = parseFactoryRoute(factoryId, search);
  const detail = useFactory(factoryId, { liveWhileActive: true });
  const factory = detail.data;
  const showSkeleton = useDelayedPending(detail.isPending);
  useCrumbLabel(factory?.dataset?.name);
  useDocumentTitle(factory?.dataset ? `${factory.dataset.name} · Factory` : `${project.name} · Factory`);
  const forbidden = detail.error instanceof ApiError && detail.error.status === 403;

  if (showSkeleton && !factory)
    return (
      <div className={constrained}>
        <Skeleton kind="lines" rows={3} label="Loading the factory" />
      </div>
    );
  if (forbidden)
    return (
      <div className={constrained} data-testid="factory-403">
        <ErrorState
          error={detail.error}
          title="You don’t have access to this factory"
          message="Ask a project manager to add you in its Access tab."
          action={
            <Button
              variant="neutral"
              icon={<Icon name="prev" size={12} />}
              onPress={() => navigate(factoryPath(slug))}
            >
              Back to the factory
            </Button>
          }
        />
      </div>
    );
  if (detail.isError)
    return (
      <div className={constrained}>
        <ErrorState
          error={detail.error}
          title="Couldn’t load the factory"
          notFoundTitle="Factory not found"
          notFoundMessage="No connected dataset has this id. It may have been disconnected."
          onRetry={() => void detail.refetch()}
          parent={{ to: factoryPath(slug), label: 'Factory' }}
        />
      </div>
    );
  if (!factory) return null;
  return <DetailBody slug={slug} factory={factory} tab={route.tab} readOnly={readOnly} />;
}

/** The rule groups of the factory (from the unfiltered rules list) for the pickers. */
function useRuleGroups(factoryId: string): string[] {
  const all = useFactoryRules(factoryId, {});
  return (all.data?.groups ?? []).map((g) => g.value);
}

function DetailBody({
  slug,
  factory,
  tab,
  readOnly,
}: {
  slug: string;
  factory: FactoryDetail;
  tab: FactoryTab;
  readOnly: boolean;
}) {
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const toast = useToast();
  const start = useStartJob(factory.id);
  const cancel = useCancelJob(factory.id);
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const canModify = factory.permissions.can_modify && !readOnly;
  const canApprove = factory.permissions.can_approve && !readOnly;
  const job = factory.active_job;
  const busyReason = job
    ? `${jobTitle(job.kind)} is ${job.status === 'queued' ? 'queued' : 'running'}`
    : undefined;
  const version = factory.source_version;
  const noVersionReason = version ? undefined : 'The dataset has no published version to read';
  const groups = useRuleGroups(factory.id);
  const categoryWord = factory.counts.categories === 1 ? 'category' : 'categories';

  function go(next: FactoryTab) {
    const params = new URLSearchParams(search);
    if (next === 'rules') params.delete('tab');
    else params.set('tab', next);
    const qs = params.toString();
    navigate({ search: qs ? `?${qs}` : '' });
  }

  async function startGeneration(params: GenerationParams) {
    await start.mutateAsync({ kind: 'generation', params });
    toast.show('Generation started', { tone: 'success' });
    go('generation');
  }

  const tabItems = [
    { id: 'rules', label: 'Rules', count: factory.counts.rules },
    { id: 'categories', label: 'Categories', count: factory.counts.categories },
    { id: 'generation', label: 'Generation', count: factory.counts.jobs },
    { id: 'access', label: 'Access' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <div className={constrained} data-testid="factory-detail">
      <PageHeader
        title={factory.dataset?.name ?? 'Deleted dataset'}
        description={
          version
            ? `Connected dataset · ${version.version} · ${version.item_count.toLocaleString(APP_LOCALE)} items`
            : 'Connected dataset · no published version yet'
        }
        meta={[
          <span key="group">
            {factory.group_metadata_key ? `Grouped by ${factory.group_metadata_key}` : 'No grouping'}
          </span>,
          <span key="model">
            {factory.llm_connection ? factory.llm_connection.name : 'Project default model'}
          </span>,
          <span key="analyzed">
            {factory.last_analyzed_at
              ? `Analyzed ${formatAgo(factory.last_analyzed_at)}`
              : 'Not analyzed yet'}
          </span>,
        ]}
        actions={
          canModify ? (
            <>
              <Button
                variant="neutral"
                icon={<Icon name="sparkles" size={12} />}
                onPress={() => setAnalyzing(true)}
                isDisabled={Boolean(busyReason || noVersionReason)}
                disabledReason={busyReason ?? noVersionReason}
                data-testid="analyze"
              >
                Analyze rules
              </Button>
              <Button
                variant="primary"
                icon={<Icon name="factory" size={12} />}
                onPress={() => setGenerating(true)}
                isDisabled={Boolean(busyReason || noVersionReason)}
                disabledReason={busyReason ?? noVersionReason}
                data-testid="generate"
              >
                Generate data
              </Button>
            </>
          ) : null
        }
      />
      {job ? (
        <InlineNotice
          tone="info"
          lead={`${jobTitle(job.kind)} ${job.status === 'queued' ? 'queued.' : job.status === 'cancel_requested' ? 'stopping.' : 'running.'}`}
          className={styles.notice}
          data-testid="active-job"
        >
          <span className={styles.noticeText}>{String(job.progress.message ?? '')}</span>
          {canModify && job.status !== 'cancel_requested' ? (
            <Button
              variant="neutral"
              onPress={() => {
                cancel.mutate(job.id, {
                  onError: (e) => toast.show(actionErrorMessage('cancel the job', e), { tone: 'error' }),
                });
              }}
              loading={cancel.isPending}
              data-testid="cancel-job"
            >
              Cancel
            </Button>
          ) : null}
        </InlineNotice>
      ) : null}
      <Tabs label="Factory sections" items={tabItems} selected={tab} onSelect={(id) => go(id as FactoryTab)}>
        <TabPanel id="rules">
          <RulesTab factory={factory} canModify={canModify} canApprove={canApprove} groups={groups} />
        </TabPanel>
        <TabPanel id="categories">
          <CategoriesTab factory={factory} canModify={canModify} />
        </TabPanel>
        <TabPanel id="generation">
          <GenerationTab
            factory={factory}
            slug={slug}
            canModify={canModify}
            onGenerate={() => setGenerating(true)}
            busyReason={busyReason ?? noVersionReason}
          />
        </TabPanel>
        <TabPanel id="access">
          <FactoryAccessTab factory={factory} readOnly={readOnly} />
        </TabPanel>
        <TabPanel id="settings">
          <FactorySettingsTab factory={factory} slug={slug} canModify={canModify} />
        </TabPanel>
      </Tabs>
      <ConfirmDialog
        open={analyzing}
        onOpenChange={setAnalyzing}
        title={`Analyze ${factory.dataset?.name ?? 'the dataset'}?`}
        description={[
          `The agent reads ${version ? `${version.item_count.toLocaleString(APP_LOCALE)} items of ${version.version}` : 'the items'}${factory.group_metadata_key ? `, grouped by ${factory.group_metadata_key},` : ''} and proposes rules for ${factory.counts.categories} ${categoryWord}.`,
          'Existing rules stay; the agent is told not to repeat them. New rules start as proposed.',
        ]}
        confirmLabel="Analyze"
        tone="accent"
        onConfirm={async () => {
          try {
            await start.mutateAsync({ kind: 'analysis', params: {} });
            toast.show('Analysis started', { tone: 'success' });
          } catch (e) {
            toast.show(actionErrorMessage('start the analysis', e), { tone: 'error' });
          }
        }}
      />
      <GenerateDialog
        open={generating}
        onOpenChange={setGenerating}
        factory={factory}
        groups={groups}
        onStart={startGeneration}
      />
    </div>
  );
}

export default FactoryDetailPage;
