import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  useStartPlatformRun,
  type PlatformSetup,
  type PlatformTarget,
  type PlatformTestType,
  type PlatformPlanInput,
  type PlatformBreakpointPlan,
  type PlatformSmokePlan,
} from '@/api/performancePlatform';
import { performanceRunPath } from '@/app/routes';
import {
  Button,
  Card,
  CardTitle,
  ConfirmDialog,
  Disclosure,
  InlineNotice,
  KeyValueGrid,
  NumberField,
  Select,
  StateTag,
  Stepper,
  Switch,
  TextField,
} from '@/ui';
import { StepBar, type NewRunInitial } from '../../NewRunPage';
import type { StepNumber } from '../new/model';
import { OptionGroup, OptionBox } from '../new/parts';
import { PlatformSignIn } from './SessionDialog';
import { TargetChoiceFacts } from './PlatformMarks';
import { TargetKindDialog } from './TargetKindDialog';
import { planFacts } from './PlatformSetup';
import { platformCount, platformError, PLATFORM_ERRORS } from './words';
import styles from '../new/newRun.module.css';
import platformStyles from './platform.module.css';

const STEPS = ['Target', 'Test', 'Load', 'Dashboards', 'Review'];
export function platformPlanProblems(
  plan: PlatformPlanInput,
  target: PlatformTarget,
  setup: PlatformSetup,
): string[] {
  const problems: string[] = [];
  const limits = setup.platform.limits;
  const nullable = new Set(['max_dashboards', 'timeout_seconds', 'smoke_max_duration_seconds']);
  const integer = new Set([
    'baseline_users',
    'max_users',
    'step_users',
    'hold_seconds',
    'ramp_seconds',
    'max_error_rate_pct',
    'users',
    'smoke_max_duration_seconds',
    'filters_per_dashboard',
    'max_dashboards',
    'timeout_seconds',
    'handoff_wait_seconds',
    'discovery_budget_seconds',
  ]);
  const names: Record<string, string> = {
    baseline_users: 'Baseline users',
    max_users: 'Highest users',
    step_users: 'Users added each level',
    hold_seconds: 'Each level',
    ramp_seconds: 'Time between levels',
    limit_ms: 'Dashboard open time limit',
    max_error_rate_pct: 'Request error limit',
    filter_reference_ms: 'Filter time reference',
    users: 'Users',
    smoke_max_duration_seconds: 'Maximum run length',
    pause_seconds: 'Pause between dashboards',
    filters_per_dashboard: 'Filters per dashboard',
    max_dashboards: 'Dashboard limit',
    timeout_seconds: 'Request timeout',
    handoff_wait_seconds: 'Time to replace sign-in',
    discovery_budget_seconds: 'Discovery time',
  };
  for (const [key, value] of Object.entries(plan)) {
    const range = limits[key as keyof typeof limits];
    if (value == null && Array.isArray(range) && !nullable.has(key))
      problems.push(`Enter ${names[key]?.toLowerCase() ?? 'a value'}.`);
    else if (typeof value === 'number' && Array.isArray(range)) {
      if (!Number.isFinite(value) || value < range[0] || value > range[1])
        problems.push(`${names[key] ?? 'Value'} is outside the allowed range. Check the field limits.`);
      else if (integer.has(key) && !Number.isInteger(value))
        problems.push(`${names[key] ?? 'Value'} must be a whole number.`);
    }
  }
  if ('max_users' in plan) {
    if (plan.baseline_users > plan.max_users)
      problems.push('Baseline users cannot be higher than the highest users.');
    if (target.max_users != null && plan.max_users > target.max_users)
      problems.push(`This target allows at most ${platformCount(target.max_users, 'user')}.`);
    const levels = Math.ceil(plan.max_users / plan.step_users);
    const total = 60 + levels * (plan.ramp_seconds + plan.hold_seconds) + 2 * plan.ramp_seconds;
    if (total > Math.min(target.max_duration_s ?? Infinity, limits.max_total_seconds))
      problems.push(
        'This plan is longer than the target or platform allows. Shorten the levels or use fewer users.',
      );
  } else if (
    plan.smoke_max_duration_seconds != null &&
    plan.smoke_max_duration_seconds > Math.min(target.max_duration_s ?? Infinity, limits.max_total_seconds)
  )
    problems.push('The Smoke time budget is longer than this target allows.');
  return problems;
}
export function PlatformLoadFields({
  plan,
  setup,
  onChange,
}: {
  plan: PlatformPlanInput;
  setup: PlatformSetup;
  onChange: (patch: Partial<PlatformPlanInput>) => void;
}) {
  const [advanced, setAdvanced] = useState(false);
  const field = (key: string, label: string, help?: string, scale = 1) => {
    const value = (plan as unknown as Record<string, unknown>)[key];
    const range = setup.platform.limits[key as keyof typeof setup.platform.limits];
    return (
      <NumberField
        key={key}
        label={label}
        value={typeof value === 'number' ? value / scale : NaN}
        onChange={(next) => onChange({ [key]: Number.isNaN(next) ? null : next * scale })}
        minValue={Array.isArray(range) ? range[0] / scale : undefined}
        maxValue={Array.isArray(range) ? range[1] / scale : undefined}
        help={help}
      />
    );
  };
  return (
    <div className={platformStyles.stack}>
      {'baseline_users' in plan ? (
        <>
          <div className={platformStyles.fields}>
            {field('baseline_users', 'Baseline users')}
            {field('max_users', 'Highest users')}
            {field('step_users', 'Users added each level')}
            {field('hold_seconds', 'Each level, minutes', undefined, 60)}
            {field('ramp_seconds', 'Seconds between levels')}
          </div>
          <Switch
            isSelected={plan.abort_on_break}
            onChange={(abort_on_break) => onChange({ abort_on_break })}
          >
            Stop when a level breaks
          </Switch>
        </>
      ) : (
        <>
          <p className={styles.text}>
            One user opens each runnable dashboard once, in turn. The run length is calculated after
            discovery.
          </p>
          {field(
            'smoke_max_duration_seconds',
            'Maximum run length, minutes',
            'Leave empty to calculate the time budget after discovery.',
            60,
          )}
        </>
      )}
      <div className={platformStyles.fields}>
        {field(
          'limit_ms',
          'Dashboard open p95 limit, seconds',
          'Dashboard open time includes its usable charts.',
          1000,
        )}
        {field('max_error_rate_pct', 'Errors under, %')}
        {field(
          'filter_reference_ms',
          'Filter time reference, seconds',
          'Shown for comparison; filter time does not decide the verdict.',
          1000,
        )}
      </div>
      <Disclosure title="Advanced" open={advanced} onOpenChange={setAdvanced}>
        <div className={platformStyles.fields}>
          {field('timeout_seconds', 'Request timeout, seconds', 'Leave empty for automatic selection.')}
          {field('discovery_budget_seconds', 'Discovery time, seconds')}
          {field('handoff_wait_seconds', 'Time to replace sign-in, seconds')}
        </div>
      </Disclosure>
    </div>
  );
}
export function PlatformDashboardFields({
  plan,
  onChange,
}: {
  plan: PlatformPlanInput;
  onChange: (patch: Partial<PlatformPlanInput>) => void;
}) {
  const all = plan.filters_per_dashboard === 'all';
  return (
    <div className={platformStyles.stack}>
      <p className={styles.note}>
        The list is found when the run starts. It uses the dashboards this account can see.
      </p>
      <div className={platformStyles.fields}>
        <NumberField
          label="Use up to this many dashboards"
          value={plan.max_dashboards ?? NaN}
          minValue={1}
          onChange={(value) => onChange({ max_dashboards: Number.isNaN(value) ? null : value })}
          help="Leave empty to use all dashboards."
        />
        <Select
          label="Filters per dashboard"
          value={all ? 'all' : 'number'}
          onChange={(key) => onChange({ filters_per_dashboard: key === 'all' ? 'all' : 1 })}
          items={[
            { key: 'all', label: 'All available filters' },
            { key: 'number', label: 'A set number' },
          ]}
        />
        {!all ? (
          <NumberField
            label="Number of filters"
            value={plan.filters_per_dashboard as number}
            minValue={0}
            onChange={(filters_per_dashboard) => onChange({ filters_per_dashboard })}
          />
        ) : null}
        <Select
          label="Next dashboard"
          value={plan.pick}
          onChange={(pick) => onChange({ pick: pick as 'random' | 'roundrobin' })}
          isDisabled={'users' in plan}
          items={
            'users' in plan
              ? [{ key: 'roundrobin', label: 'In turn' }]
              : [
                  { key: 'random', label: 'At random' },
                  { key: 'roundrobin', label: 'In turn' },
                ]
          }
          help={'users' in plan ? 'Smoke opens every runnable dashboard once.' : undefined}
        />
        <NumberField
          label="Pause between dashboards, seconds"
          value={plan.pause_seconds}
          minValue={0}
          onChange={(pause_seconds) => onChange({ pause_seconds })}
        />
      </div>
    </div>
  );
}
export function PlatformNewRun({
  slug,
  setup,
  target,
  initial,
  onTarget,
  onCancel,
}: {
  slug: string;
  setup: PlatformSetup;
  target: PlatformTarget;
  initial?: NewRunInitial;
  onTarget: (id: string) => void;
  onCancel: () => void;
}) {
  const navigate = useNavigate();
  const [step, setStep] = useState<StepNumber>(initial?.step ?? 1);
  const [test, setTest] = useState<PlatformTestType>(setup.platform.defaults.test_type);
  const [plans, setPlans] = useState(() => structuredClone(setup.platform.defaults));
  const [note, setNote] = useState('');
  const [dialog, setDialog] = useState<'add' | 'edit' | 'start' | null>(
    initial?.dialog === 'start' ? 'start' : initial?.dialog === 'add-target' ? 'add' : null,
  );
  const [refusal, setRefusal] = useState<string>();
  const start = useStartPlatformRun(slug);
  const plan = plans[test];
  const patch = (update: Partial<PlatformPlanInput>) =>
    setPlans((old) => ({ ...old, [test]: { ...old[test], ...update } }));
  const blocked = setup.platform.blocked ?? setup.blocked;
  const problems = platformPlanProblems(plan, target, setup);
  if (!setup.platform.supported)
    problems.unshift('The connected runner cannot run platform tests. An operator needs to update it.');
  if (blocked) problems.unshift(PLATFORM_ERRORS[blocked.code] ?? blocked.message);
  if (!target.sign_in_ready) problems.push('Save the target sign-in before starting.');
  if (!target.can_start) problems.push('Your role cannot start this run.');
  if (target.is_production && !setup.can_manage_targets)
    problems.push('Only a manager can start a run on production.');
  const go = (value: number) => setStep(Math.min(5, Math.max(1, value)) as StepNumber);
  const load =
    'max_users' in plan
      ? `${platformCount(plan.baseline_users, 'user')} at baseline, then up to ${platformCount(plan.max_users, 'user')}, adding ${platformCount(plan.step_users, 'user')} each level.`
      : 'One user opens every runnable dashboard once.';
  async function startRun() {
    setRefusal(undefined);
    try {
      const common = {
        target_id: target.id,
        target_kind: 'estishraf_platform' as const,
        note,
        confirm_target: target.is_production ? target.name : undefined,
      };
      const result = await start.mutateAsync(
        test === 'breakpoint'
          ? { ...common, test_type: 'breakpoint', plan: plan as PlatformBreakpointPlan }
          : { ...common, test_type: 'smoke', plan: plan as PlatformSmokePlan },
      );
      navigate(performanceRunPath(slug, result.id));
    } catch (error) {
      const words = platformError(error);
      setRefusal(words);
      throw new Error(words);
    }
  }
  return (
    <>
      {refusal ? <InlineNotice tone="danger">{refusal}</InlineNotice> : null}
      <Stepper
        aria-label="New run steps"
        steps={STEPS.map((label, i) => ({ id: String(i + 1), label }))}
        current={String(step)}
        onSelect={(id) => go(Number(id))}
      />
      <div className={styles.wizard} data-wide={step === 5 ? '' : undefined}>
        <Card as="section" aria-label={STEPS[step - 1]} header={<CardTitle title={STEPS[step - 1]!} />}>
          {step === 1 ? (
            <div className={platformStyles.stack}>
              <OptionGroup label="Target" value={target.id} onChange={onTarget}>
                {setup.targets.map((item) => (
                  <OptionBox key={item.id} value={item.id}>
                    <TargetChoiceFacts target={item} />
                  </OptionBox>
                ))}
              </OptionGroup>
              {setup.can_manage_targets ? (
                <div className={platformStyles.row}>
                  <Button onPress={() => setDialog('add')}>Add a target</Button>
                  <Button onPress={() => setDialog('edit')}>Edit target</Button>
                </div>
              ) : null}
              <PlatformSignIn
                key={target.id}
                slug={slug}
                target={target}
                encryptionReady={setup.encryption_ready}
              />
            </div>
          ) : null}
          {step === 2 ? (
            <OptionGroup
              label="Test"
              columns={2}
              value={test}
              onChange={(value) => setTest(value as PlatformTestType)}
            >
              <OptionBox value="smoke">
                <span className={styles.optionTitle}>Smoke</span>
                <span>
                  One user opens each runnable dashboard once. Check sign-in, charts and filters before adding
                  load.
                </span>
              </OptionBox>
              <OptionBox value="breakpoint">
                <span className={styles.optionTitle}>Breakpoint</span>
                <span>
                  Add users in levels to find the safe load and where dashboard open time gets too slow.
                </span>
              </OptionBox>
            </OptionGroup>
          ) : null}
          {step === 3 ? <PlatformLoadFields plan={plan} setup={setup} onChange={patch} /> : null}
          {step === 4 ? <PlatformDashboardFields plan={plan} onChange={patch} /> : null}
          {step === 5 ? (
            <div className={platformStyles.stack}>
              <p className={styles.text}>
                {target.name} · Estishraf platform · {test === 'smoke' ? 'Smoke' : 'Breakpoint'}. {load}
              </p>
              <div className={platformStyles.fields}>
                <div className={platformStyles.stack}>
                  <KeyValueGrid
                    columns={1}
                    items={[
                      { key: 'Target', value: target.name },
                      { key: 'Kind', value: 'Estishraf platform' },
                      { key: 'Address', value: target.base_url },
                      ...planFacts(plan).filter(
                        (item) =>
                          ![
                            'Dashboards',
                            'Filters per dashboard',
                            'Next dashboard',
                            'Pause between dashboards',
                            'Request timeout',
                            'Discovery time',
                            'Time to replace sign-in',
                          ].includes(item.key),
                      ),
                    ]}
                  />
                  <PlatformSignIn slug={slug} target={target} encryptionReady={setup.encryption_ready} />
                </div>
                <div className={platformStyles.stack}>
                  <KeyValueGrid
                    columns={1}
                    items={planFacts(plan).filter((item) =>
                      [
                        'Dashboards',
                        'Filters per dashboard',
                        'Next dashboard',
                        'Pause between dashboards',
                        'Request timeout',
                        'Discovery time',
                        'Time to replace sign-in',
                      ].includes(item.key),
                    )}
                  />
                  <InlineNotice tone="info" lead="Discovery comes first.">
                    The runner finds the list when the run starts. Charts that cannot be loaded are listed in
                    the result and report.
                  </InlineNotice>
                  <Button onPress={() => go(4)}>Edit dashboard settings</Button>
                </div>
              </div>
              <TextField label="Note" maxLength={500} value={note} onChange={setNote} />
              {problems.map((problem) => (
                <InlineNotice key={problem} tone="warning">
                  {problem}
                </InlineNotice>
              ))}
            </div>
          ) : null}
        </Card>
        {step !== 5 ? (
          <Card as="aside" header={<CardTitle title="Your run so far" />}>
            <div className={platformStyles.stack}>
              <dl className={styles.facts}>
                <dt>Target</dt>
                <dd>{target.name}</dd>
                <dt>Kind</dt>
                <dd>Estishraf platform</dd>
                <dt>Sign-in</dt>
                <dd>
                  <StateTag tone={target.sign_in_ready ? 'success' : 'warning'}>
                    {target.sign_in_ready ? 'Saved' : 'Needed'}
                  </StateTag>
                </dd>
                <dt>Test</dt>
                <dd>{test === 'smoke' ? 'Smoke' : 'Breakpoint'}</dd>
                <dt>Load</dt>
                <dd>{load}</dd>
                <dt>Dashboards</dt>
                <dd>
                  {plan.max_dashboards == null ? 'All visible dashboards' : `Up to ${plan.max_dashboards}`}
                </dd>
                <dt>Filters</dt>
                <dd>{plan.filters_per_dashboard === 'all' ? 'All available' : plan.filters_per_dashboard}</dd>
              </dl>
              <p className={styles.note}>The dashboard list is found when the run starts.</p>
            </div>
          </Card>
        ) : null}
      </div>
      <StepBar
        step={step}
        dashboardStep
        problems={problems.map((message) => ({ message }))}
        onGo={go}
        onCancel={onCancel}
        onStart={() => setDialog('start')}
      />
      <TargetKindDialog
        slug={slug}
        open={dialog === 'add' || dialog === 'edit'}
        target={dialog === 'edit' ? target : null}
        targets={setup.targets}
        maxUsersLimit={setup.platform.limits.max_users[1]}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onSaved={(saved) => onTarget(saved.id)}
      />
      <ConfirmDialog
        open={dialog === 'start'}
        onOpenChange={(open) => setDialog(open ? 'start' : null)}
        title={`Start ${test === 'smoke' ? 'Smoke' : 'Breakpoint'} on ${target.name}?`}
        description={`${load} All users share the saved sign-in. This sends real requests to ${target.base_url}.`}
        confirmLabel="Start run"
        {...(target.is_production ? { requireText: target.name } : {})}
        onConfirm={startRun}
      />
    </>
  );
}
