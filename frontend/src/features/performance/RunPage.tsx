import { useMixedPerformanceRun, isPlatformRun } from '@/api/performancePlatform';
import { PlatformRun } from './components/platform/PlatformRun';
/** One performance run, while it goes on and after it ends: header, what happened, numbers, then tabs. */
import { useState, type ReactNode } from 'react';
import { isPerformanceRunActive, isPerformanceSwitchedOff } from '@/api/performance';
import { performancePath } from '@/app/routes';
import { useDocumentTitle } from '@/features/shell/hooks';
import { fullWidth } from '@/features/shell/layout';
import { useCrumbLabel } from '@/lib/crumb-label';
import {
  Card,
  CardTitle,
  DataTable,
  EmptyState,
  ErrorState,
  Icon,
  InlineNotice,
  PageHeader,
  Skeleton,
  StaleBanner,
  StatStrip,
  TabPanel,
  Tabs,
  UserName,
  type StatStripItem,
} from '@/ui';
import { ChartsTab } from './components/run/ChartsTab';
import { LogTab, type LogMode } from './components/run/LogTab';
import { ProgressTab, levelFrameColumns } from './components/run/ProgressTab';
import { QuestionsTab } from './components/run/QuestionsTab';
import { RunHeader } from './components/run/RunHeader';
import { SetupTab } from './components/run/SetupTab';
import { StopDialog } from './components/run/StopDialog';
import { TokenDialog } from './components/run/TokenDialog';
import { useSecondsSince } from './components/run/hooks';
import { finalStrip, liveStrip } from './components/run/numbers';
import { aroundPerson, runNotice, whereLine, type RunNotice } from './components/run/words';
import { PlotCard } from './components/shared';
import styles from './components/run/run.module.css';

export type RunTab = 'progress' | 'questions' | 'log' | 'charts' | 'setup';
export type RunDialog = 'stop' | 'token';

export interface RunPageProps {
  slug: string;
  runId: string;
  /** This computer's clock, in ms. Passed in so a test or a fixed picture can hold it still. */
  now?: () => number;
  /** What is open when the page mounts. A person always starts on Progress with no dialog. */
  initial?: { tab?: RunTab; dialog?: RunDialog; logMode?: LogMode; question?: number };
}

const frame = `${fullWidth} ${styles.page}`;

const TABS = (questions?: number) => [
  { id: 'progress', label: 'Progress' },
  // An unknown count is not zero (§3.7): the loading frame shows no count.
  { id: 'questions', label: 'Questions', count: questions },
  { id: 'log', label: 'Log' },
  { id: 'charts', label: 'Charts' },
  { id: 'setup', label: 'Setup' },
];

/** The notice text, with the person it names drawn as a UserName (A8). */
function NoticeText({ notice }: { notice: RunNotice }) {
  const split = aroundPerson(notice.text, notice.person);
  if (!split) return <>{notice.text}</>;
  const [before, person, after] = split;
  return (
    <>
      {before}
      <UserName id={person.id} name={person.name} />
      {after}
    </>
  );
}

/** A bone at the height of a tag, so a skeleton line is as tall as the line it stands for. */
const bone = (width: string, label = 'Loading the run'): ReactNode => (
  <Skeleton kind="value" width={width} height="var(--badge-height)" label={label} />
);

/** A bone in a line of text (a notice, a caption): the text's own height, so the line keeps its line height. */
const textBone = (width: string, label: string): ReactNode => (
  <Skeleton kind="value" width={width} label={label} />
);

const FRAME_CELLS: StatStripItem[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((key) => ({
  key,
  label: bone('5em'),
  value: bone('3em'),
  sub: bone('7em'),
}));

/** A Breakpoint plan's usual six levels: the frame cannot know the count before the read (see the report). */
const FRAME_LEVELS = [1, 2, 3, 4, 5, 6];

/**
 * The loading frame is the loaded layout (§7): the header, one notice line, the compact strip, the five tabs and the
 * Progress tab's plot and Levels card, each drawn by the same components with skeleton values.
 */
function RunFrame() {
  return (
    <div className={frame} data-performance-block="content" data-performance-frame="" aria-busy="true">
      <PageHeader
        title="Run"
        meta={[bone('9em'), bone('5em'), bone('14em'), bone('16em'), bone('9em')]}
        actions={
          <Skeleton kind="value" width="8em" height="var(--control-height)" label="Loading the actions" />
        }
      />
      <div className={styles.body}>
        <InlineNotice tone="neutral">{textBone('min(40em, 100%)', 'Loading what happened')}</InlineNotice>
        <div data-performance-block="numbers">
          <StatStrip variant="compact-header" aria-label="The run in numbers" items={FRAME_CELLS} />
        </div>
        <Tabs fitNarrow label="Run sections" selected="progress" onSelect={() => undefined} items={TABS()}>
          <TabPanel id="progress">
            <div className={styles.stack}>
              <PlotCard title="Users over time" legend={bone('min(20em, 100%)', 'Loading the legend')}>
                <Skeleton kind="chart" height={230} label="Loading users over time" />
              </PlotCard>
              <Card
                flush
                as="section"
                aria-label="Levels"
                header={
                  <CardTitle title="Levels" description={textBone('min(30em, 100%)', 'Loading the levels')} />
                }
              >
                <DataTable
                  aria-label="Levels"
                  variant="embedded"
                  stripe="report"
                  columns={levelFrameColumns()}
                  rows={FRAME_LEVELS}
                  rowKey={(r) => r}
                  responsive="scroll"
                  fit="declared"
                  stickyHeader={false}
                  minWidth={1122}
                />
              </Card>
            </div>
          </TabPanel>
        </Tabs>
      </div>
    </div>
  );
}

export function RunPage({ slug, runId, now = Date.now, initial }: RunPageProps) {
  const query = useMixedPerformanceRun(slug, runId);
  const read = query.data;
  const [tab, setTab] = useState<RunTab>(initial?.tab ?? 'progress');
  const [dialog, setDialog] = useState<RunDialog | null>(initial?.dialog ?? null);
  const active = isPerformanceRunActive(read?.effective_status);
  const age = useSecondsSince(read?.received_at, active, now);
  useDocumentTitle(read ? `Run ${read.run.number} · Performance` : 'Run · Performance');
  useCrumbLabel(read ? `Run ${read.run.number}` : null);

  // The area is switched off on the platform: every route answers the same 404. Nothing to retry.
  if (isPerformanceSwitchedOff(query.error))
    return (
      <div className={frame} data-performance-block="content" data-performance-state="switched-off">
        <PageHeader title="Run" />
        <div className={styles.body}>
          <EmptyState
            icon={<Icon name="ban" />}
            title="Performance tests are switched off"
            body="An administrator has turned this area off for the platform. Runs and their results show again once it is turned back on."
          />
        </div>
      </div>
    );

  if (!read)
    return query.isError ? (
      <div className={frame} data-performance-block="content">
        <PageHeader title="Run" />
        <div className={styles.body}>
          <ErrorState
            error={query.error}
            title="Couldn’t load this run"
            notFoundMessage="This run is not in qym"
            parent={{ to: performancePath(slug), label: 'Performance' }}
            onRetry={() => void query.refetch()}
          />
        </div>
      </div>
    ) : (
      <RunFrame />
    );

  if (isPlatformRun(read))
    return (
      <PlatformRun
        slug={slug}
        runId={runId}
        read={read}
        stale={query.isError}
        onRetry={() => void query.refetch()}
        now={now}
      />
    );

  const { run, summary } = read;
  const done = !active;
  const line = runNotice(read);
  const where = done
    ? null
    : whereLine(read, read.seconds_since_report === null ? null : read.seconds_since_report + age);
  // The records the list holds: every question the runner sent, answered or cut off, less any qym could not store.
  const questions = Math.max(0, read.counts.questions_received - read.counts.questions_dropped);
  return (
    <div
      className={frame}
      data-performance-block="content"
      data-performance-run={run.id}
      data-performance-state={read.effective_status}
    >
      <RunHeader
        slug={slug}
        read={read}
        onStop={() => setDialog('stop')}
        onToken={() => setDialog('token')}
      />
      <div className={styles.body}>
        {query.isError ? (
          // A refresh failed after the run was shown: the last read stays, and the banner says how old it is (§3.7).
          <StaleBanner
            since={new Date(read.received_at)}
            now={new Date(now())}
            filtersApplied
            onRetry={() => void query.refetch()}
          />
        ) : null}
        {line ? (
          <InlineNotice tone={line.tone} lead={line.lead} data-testid="performance-run-notice">
            <NoticeText notice={line} />
          </InlineNotice>
        ) : null}
        {where ? (
          // Where the run is, as one line under the header (B22): no card of its own between the header and the tabs.
          <div role="group" aria-label="Where the run is" data-performance-block="status-line">
            <InlineNotice tone="info" lead={where.lead}>
              {where.text}
            </InlineNotice>
          </div>
        ) : null}
        {/* The one compact strip of page-wide numbers between the hero and the tabs (§4 Page anatomy). */}
        <div data-performance-block="numbers">
          <StatStrip
            variant="compact-header"
            aria-label="The run in numbers"
            live={!done}
            items={summary ? finalStrip(read) : liveStrip(read)}
          />
        </div>
        <Tabs
          fitNarrow
          label="Run sections"
          selected={tab}
          onSelect={(id) => setTab(id as RunTab)}
          items={TABS(questions)}
        >
          <TabPanel id={tab}>
            <div className={styles.stack} data-performance-tab={tab}>
              {tab === 'progress' ? <ProgressTab read={read} /> : null}
              {tab === 'questions' ? (
                <QuestionsTab slug={slug} runId={runId} read={read} initialOpen={initial?.question} />
              ) : null}
              {tab === 'log' ? (
                <LogTab slug={slug} runId={runId} read={read} initialMode={initial?.logMode} />
              ) : null}
              {tab === 'charts' ? <ChartsTab read={read} /> : null}
              {tab === 'setup' ? <SetupTab read={read} /> : null}
            </div>
          </TabPanel>
        </Tabs>
        <StopDialog
          slug={slug}
          runId={runId}
          read={read}
          open={dialog === 'stop'}
          onOpenChange={(open) => setDialog(open ? 'stop' : null)}
        />
        <TokenDialog
          slug={slug}
          runId={runId}
          read={read}
          open={dialog === 'token'}
          onOpenChange={(open) => setDialog(open ? 'token' : null)}
        />
      </div>
    </div>
  );
}
