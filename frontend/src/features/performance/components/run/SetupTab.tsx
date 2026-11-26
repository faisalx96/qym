/** Performance run page, Setup tab: the run's frozen settings. */
import type { PerformanceRunRead } from '@/api/performance';
import { Card, CardTitle, KeyValueGrid, UserName } from '@/ui';
import { KINDS, KIND_NAME, TEST_NAME, count, secs, span } from '../../lib/format';
import styles from './run.module.css';

export function SetupTab({ read }: { read: PerformanceRunRead }) {
  const { config, run, runner } = read;
  const plan = config.plan;
  const breakpoint = config.test_type === 'breakpoint';
  const steady = plan.users ?? 1;
  return (
    <Card
      as="section"
      aria-label="Setup"
      data-performance-block="setup"
      header={<CardTitle title="Setup" description="How this run was set up. It cannot be changed." />}
    >
      <KeyValueGrid
        columns={3}
        aria-label="Setup of this run"
        items={[
          {
            key: 'test',
            label: 'Test',
            value: breakpoint
              ? 'Breakpoint: users go up in steps until a limit breaks'
              : `${TEST_NAME[config.test_type]}: ${steady} ${steady === 1 ? 'user' : 'users'}, steady`,
          },
          {
            key: 'target',
            label: 'Target',
            value: (
              <span className={styles.tight}>
                <span>{config.target.name}</span>
                <span className={styles.host}>
                  {config.target.base_url}
                  {config.target.chat_path}
                </span>
              </span>
            ),
          },
          {
            key: 'questions',
            label: 'Questions',
            value: `${config.dataset.name} ${config.dataset.version}, ${count(config.dataset.item_count)} questions`,
          },
          {
            key: 'mix',
            label: 'Mix of questions',
            value: config.dataset.single_kind
              ? 'One kind: the dataset does not name kinds'
              : KINDS.map((kind) => `${KIND_NAME[kind]} ${config.mix[kind]}%`).join(' · '),
          },
          {
            key: 'levels',
            label: 'Levels',
            value: plan.levels.length ? `${plan.levels.join(', ')} users` : 'None: the load is steady',
          },
          {
            key: 'hold',
            label: breakpoint ? 'Hold at each level' : 'Length',
            value: span(breakpoint ? plan.hold_seconds : plan.duration_seconds),
          },
          { key: 'limit', label: 'Time limit', value: `95% of answers within ${secs(plan.limit_ms, 0)}` },
          {
            key: 'errors',
            label: 'Error limit',
            value: `Fewer than ${plan.max_error_rate_pct}% of answers fail`,
          },
          {
            key: 'follow-ups',
            label: 'Follow-ups',
            value: breakpoint
              ? `After ${Math.round((plan.follow_up_rate ?? 0) * 100)}% of the answers, in the same conversation`
              : 'As the dataset has them',
          },
          {
            key: 'auto-stop',
            label: 'Stop at the first break',
            value: !breakpoint
              ? 'Does not apply: there are no levels'
              : plan.abort_on_break
                ? 'On: the run stops at the first level that breaks a limit'
                : 'Off: every level runs',
          },
          {
            key: 'timeout',
            label: 'Answer timeout',
            value: `An answer is given up after ${plan.timeout_seconds}s`,
          },
          { key: 'planned', label: 'Planned length', value: span(plan.total_seconds) },
          {
            key: 'answers',
            label: 'Answers',
            value: config.options.store_answers
              ? 'Stored with each question (first 1,000 characters)'
              : 'Not stored',
          },
          {
            key: 'by',
            label: 'Started by',
            value: <UserName id={run.requested_by_user_id} name={run.requested_by} />,
          },
          // A runner's name is a name people gave it, so sans (B15); only a bare id or value is mono.
          { key: 'runner', label: 'Runner', value: runner?.name ?? '–' },
        ]}
      />
    </Card>
  );
}
