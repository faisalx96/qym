/** New run: the summary beside steps 1 to 4, step 5 (review), and the dialog that starts the run. */
import type { ReactNode } from 'react';
import type {
  PerformanceDataset,
  PerformanceMix,
  PerformanceSetupTarget,
  PerformanceTestType,
} from '@/api/performance';
import { formatTime } from '@/lib/dates';
import { Button, Card, CardTitle, ConfirmDialog, Skeleton, StatStrip, UserName } from '@/ui';
import { TEST_NAME } from '../../lib/format';
import { stageStartUsers, type ComputedPlan } from '../../lib/plan';
import { Stepladder, TargetEnvironment } from '../shared';
import { mixWords, planWords, plural, type RunCheck, type StepNumber } from './model';
import { Checks, MixBar, SignInTag, hostOf } from './parts';
import styles from './newRun.module.css';

/** Everything the summary, the review and the Start dialog say about the run as it is set now. */
export interface RunSummary {
  target: PerformanceSetupTarget | null;
  test: PerformanceTestType;
  computed: ComputedPlan;
  dataset: PerformanceDataset | null;
  /** The mix the run will really use (a dataset without kinds is asked as one kind). */
  mix: PerformanceMix;
  checks: RunCheck[];
  /** The person who would start the run. */
  person: { id: string; name: string } | null;
  /** The moment "if started now" means, on this computer's clock (ms). */
  now: number;
}

const datasetWords = (dataset: PerformanceDataset | null) =>
  dataset
    ? `${dataset.name}${dataset.latest_published_version ? ` ${dataset.latest_published_version.name}` : ''}`
    : null;

function ends(summary: RunSummary) {
  const end = new Date(summary.now + summary.computed.total_seconds * 1000);
  const nextDay = end.toDateString() !== new Date(summary.now).toDateString();
  return { time: formatTime(end), nextDay, words: `${formatTime(end)}${nextDay ? ' tomorrow' : ''}` };
}

function Picture({ computed, height }: { computed: ComputedPlan; height: number }) {
  return (
    <Stepladder stages={computed.stages} baseline={stageStartUsers(computed.stages, 0)} height={height} />
  );
}

function TargetWords({ target }: { target: PerformanceSetupTarget }) {
  return (
    <span className={styles.tight}>
      <span className={styles.row}>
        {target.name}
        <TargetEnvironment production={target.is_production} />
      </span>
      <span className={styles.host}>{hostOf(target.base_url)}</span>
    </span>
  );
}

// ---------- the summary beside steps 1 to 4 ----------

export function SoFar({
  summary,
  step,
  reached,
}: {
  summary: RunSummary;
  step: StepNumber;
  reached: StepNumber;
}) {
  const { target, test, computed, dataset, mix, checks } = summary;
  const words = planWords(test, computed);
  const later = (at: number, value: ReactNode) =>
    reached >= at ? value : <span className={styles.muted}>Step {at}</span>;
  const none = <span className={styles.muted}>Not chosen</span>;
  return (
    <Card
      as="aside"
      aria-label="Your run so far"
      header={<CardTitle title="Your run so far" />}
      data-performance-block="so-far"
    >
      <div className={styles.stack}>
        {step >= 3 ? <Picture computed={computed} height={140} /> : null}
        <dl className={styles.facts}>
          <dt>Target</dt>
          <dd>{target ? target.name : none}</dd>
          <dt>Sign-in</dt>
          <dd>{target ? <SignInTag target={target} /> : none}</dd>
          <dt>Test</dt>
          <dd>{later(2, TEST_NAME[test])}</dd>
          <dt>Load</dt>
          <dd>{later(3, words.load)}</dd>
          <dt>Length</dt>
          <dd>{later(3, `${words.length}, ends about ${ends(summary).words}`)}</dd>
          <dt>Answers</dt>
          <dd>{later(3, words.answers)}</dd>
          <dt>Questions</dt>
          <dd>
            {later(4, dataset ? `${datasetWords(dataset)}, ${plural(dataset.item_count, 'question')}` : none)}
          </dd>
          <dt>Mix</dt>
          <dd>{later(4, dataset ? mixWords(mix) : none)}</dd>
        </dl>
        {step >= 3 ? (
          <div className={`${styles.stack} ${styles.rule}`}>
            <span className={styles.label}>Checks</span>
            <Checks items={checks} />
          </div>
        ) : null}
      </div>
    </Card>
  );
}

/**
 * The summary while the settings are read: the same card and facts as on step 1, a Skeleton bone where the target
 * and its sign-in will be, and the steps that are not reached yet as they will read.
 */
export function SoFarFrame() {
  const bone = (width: string, height?: string) => (
    <Skeleton kind="value" width={width} height={height} label="Reading the targets" />
  );
  const later = (at: number) => <span className={styles.muted}>Step {at}</span>;
  return (
    <Card
      as="aside"
      aria-label="Your run so far"
      header={<CardTitle title="Your run so far" />}
      data-performance-block="so-far"
    >
      <div className={styles.stack}>
        <dl className={styles.facts}>
          <dt>Target</dt>
          <dd>{bone('8em')}</dd>
          <dt>Sign-in</dt>
          <dd>{bone('7em', 'var(--badge-height)')}</dd>
          <dt>Test</dt>
          <dd>{later(2)}</dd>
          <dt>Load</dt>
          <dd>{later(3)}</dd>
          <dt>Length</dt>
          <dd>{later(3)}</dd>
          <dt>Answers</dt>
          <dd>{later(3)}</dd>
          <dt>Questions</dt>
          <dd>{later(4)}</dd>
          <dt>Mix</dt>
          <dd>{later(4)}</dd>
        </dl>
      </div>
    </Card>
  );
}

// ---------- step 5 ----------

export function ReviewStep({ summary, onGo }: { summary: RunSummary; onGo: (step: StepNumber) => void }) {
  const { target, test, computed, dataset, mix, checks, person, now } = summary;
  const words = planWords(test, computed);
  const end = ends(summary);
  const breakpoint = test === 'breakpoint';
  const token = target?.tokens.find((item) => item.name === 'refresh_token');
  const none = <span className={styles.muted}>Not chosen</span>;
  const rows: [string, ReactNode, StepNumber | null][] = [
    ['Target', target ? <TargetWords key="target" target={target} /> : none, 1],
    [
      'Sign-in',
      target ? (
        <span key="sign-in" className={styles.row}>
          <SignInTag target={target} />
          {token ? (
            <span>
              {token.hint ? (
                <>
                  Refresh token ends in <span className={styles.number}>{token.hint}</span>
                </>
              ) : (
                'Refresh token saved'
              )}
            </span>
          ) : null}
        </span>
      ) : (
        none
      ),
      null,
    ],
    ['Test', TEST_NAME[test], 2],
    ['Load', words.load, 3],
    ['Limits', words.limits, null],
    ['Also', words.also, null],
    ['Questions', dataset ? `${datasetWords(dataset)}, ${plural(dataset.item_count, 'question')}` : none, 4],
    [
      'Mix',
      dataset ? (
        <span key="mix" className={styles.tight}>
          <MixBar mix={mix} unit="%" />
          <span>{mixWords(mix)}</span>
        </span>
      ) : (
        none
      ),
      null,
    ],
    ['Started by', person ? <UserName key="by" id={person.id} name={person.name} /> : 'You', null],
  ];
  return (
    <div className={styles.stack}>
      <Picture computed={computed} height={220} />
      <StatStrip
        aria-label="The plan in numbers"
        items={[
          breakpoint
            ? { key: 'levels', label: 'Levels', value: computed.levels.length, sub: words.levelsShort }
            : { key: 'levels', label: 'Users', value: computed.levels[0] ?? 0, sub: words.levelsShort },
          {
            key: 'length',
            label: 'Length',
            value: words.length,
            sub: !breakpoint
              ? 'fixed length'
              : !computed.levels.length
                ? 'nothing is measured'
                : computed.plan.abort_on_break
                  ? 'shorter if a level breaks'
                  : 'every level is measured',
          },
          {
            key: 'ends',
            label: 'Ends at',
            value: end.time,
            sub: `${end.nextDay ? 'tomorrow, ' : ''}if started now, ${formatTime(now)}`,
          },
          {
            key: 'answers',
            label: 'Answers',
            value: words.answers,
            sub: breakpoint ? 'expected, all levels together' : 'expected',
          },
        ]}
      />
      <div className={`${styles.review} ${styles.rule}`}>
        <div className={styles.stack} data-performance-block="settings">
          <span className={styles.label}>Settings</span>
          <dl className={styles.settings}>
            {rows.map(([key, value, step]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{value}</dd>
                <dd>
                  {step ? (
                    <Button onPress={() => onGo(step)} aria-label={`Change ${key.toLowerCase()}`}>
                      Change
                    </Button>
                  ) : null}
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <div className={styles.stack}>
          <span className={styles.label}>Checks</span>
          <Checks items={checks} />
        </div>
      </div>
    </div>
  );
}

// ---------- the Start dialog ----------

function PlanFacts({ summary }: { summary: RunSummary }) {
  const { target, test, computed, dataset, mix, person } = summary;
  const words = planWords(test, computed);
  return (
    <dl className={styles.facts} data-performance-block="plan-facts">
      <dt>Test</dt>
      <dd>{TEST_NAME[test]}</dd>
      <dt>Target</dt>
      <dd>{target ? <TargetWords target={target} /> : null}</dd>
      <dt>Levels</dt>
      <dd>{words.levels}</dd>
      <dt>Length</dt>
      <dd>
        {words.length}, ends about {ends(summary).words}
      </dd>
      <dt>Questions</dt>
      <dd>
        {datasetWords(dataset)}
        {dataset ? `, ${mixWords(mix)}` : null}
      </dd>
      <dt>Started by</dt>
      <dd>{person ? <UserName id={person.id} name={person.name} /> : 'You'}</dd>
    </dl>
  );
}

/**
 * The last question before a run starts. A production target also asks for its name, typed. `onStart`
 * rejects with the reason in words when the start is refused; the dialog then stays open and shows it.
 */
export function StartDialog({
  open,
  onOpenChange,
  summary,
  onStart,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: RunSummary;
  onStart: () => Promise<void>;
}) {
  const { target } = summary;
  // Rendered only while open, so a reason shown last time is gone when it opens again.
  if (!target || !open) return null;
  const production = target.is_production;
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title={production ? 'Start this run on production?' : 'Start this run?'}
      description={
        production
          ? 'The run starts at once and sends real load to production. You can stop it at any time from the run page.'
          : `The run starts at once and sends load to ${target.name}. You can stop it at any time from the run page.`
      }
      note={<PlanFacts summary={summary} />}
      requireText={production ? target.name : undefined}
      inputLabel={production ? `Type the name of the target, ${target.name}, to start` : undefined}
      mismatchMessage="That is not the name of the target."
      confirmLabel={production ? 'Start on production' : 'Start run'}
      onConfirm={onStart}
    />
  );
}
