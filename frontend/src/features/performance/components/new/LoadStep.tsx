/** New run, steps 2 and 3: which test, and how much load. */
import type { PerformancePlanInput, PerformancePlanLimits, PerformanceTestType } from '@/api/performance';
import { Button, Flag, NumberField, Slider, Switch } from '@/ui';
import { span } from '../../lib/format';
import type { ComputedPlan } from '../../lib/plan';
import { TESTS, levelUsers, plural } from './model';
import { OptionBox, OptionGroup } from './parts';
import styles from './newRun.module.css';

/** The shape of a test as a small drawing; its size is the drawing's own. */
function Shape({ d }: { d: string }) {
  return (
    <svg className={styles.shape} viewBox="0 0 56 22" width="56" height="22" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// ---------- step 2 ----------

export function TestStep({
  test,
  onChoose,
}: {
  test: PerformanceTestType;
  onChoose: (test: PerformanceTestType) => void;
}) {
  return (
    <OptionGroup
      label="Test"
      columns={2}
      value={test}
      onChange={(value) => onChoose(value as PerformanceTestType)}
    >
      {TESTS.map((item) => (
        <OptionBox key={item.key} value={item.key} data-performance-test={item.key}>
          <Shape d={item.shape} />
          <span className={styles.optionTitle}>{item.name}</span>
          <span>{item.line}</span>
          <span className={styles.muted}>{item.usual}</span>
        </OptionBox>
      ))}
      <OptionBox value="dashboards" isDisabled data-performance-test="dashboards">
        <Shape d="M4 5h14v12H4zM22 5h14v5H22zM22 13h14v4H22zM40 5h12v12H40z" />
        <span className={styles.optionTitle}>
          Estishraf dashboards <Flag icon="clock">Later</Flag>
        </span>
        <span>Load on the dashboard pages instead of the chat.</span>
        <span>Not available yet</span>
      </OptionBox>
    </OptionGroup>
  );
}

// ---------- step 3 ----------

/** A slider moves in fives where its lowest value allows it, else one by one. */
const usersStep = (range: [number, number]) => (range[0] % 5 === 0 ? 5 : 1);
const clamp = (value: number, [low, high]: [number, number]) => Math.min(high, Math.max(low, value));

/** Takes the recommended value: a neutral button after the sentence that names it (no text-only buttons). */
function Use({ onPress, label }: { onPress: () => void; label: string }) {
  return (
    <Button size="sm" onPress={onPress} aria-label={label}>
      Use
    </Button>
  );
}

export interface LoadStepProps {
  test: PerformanceTestType;
  plan: PerformancePlanInput;
  limits: PerformancePlanLimits;
  computed: ComputedPlan;
  /** The person set the answer timeout: it no longer follows the time limit. */
  timeoutEdited: boolean;
  onChange: (patch: Partial<PerformancePlanInput>, options?: { timeoutEdited?: boolean }) => void;
}

export function LoadStep({ test, plan, limits, computed, timeoutEdited, onChange }: LoadStepProps) {
  if (test === 'smoke') {
    return (
      <div className={styles.tight} data-performance-block="load-fixed">
        <span className={styles.strong}>Nothing to set</span>
        <p className={styles.text}>
          Smoke always runs 1 user for 3 minutes. It checks sign-in and that real answers come back.
        </p>
      </div>
    );
  }
  if (test === 'soak') {
    const users = plan.users ?? limits.users[0];
    const minutes = Math.round((plan.duration_seconds ?? limits.duration_seconds[0]) / 60);
    const range: [number, number] = [
      Math.ceil(limits.duration_seconds[0] / 60),
      Math.floor(limits.duration_seconds[1] / 60),
    ];
    return (
      <div className={styles.sliders} data-columns="2">
        <div className={styles.tight}>
          <Slider
            label="Users"
            unit=" users"
            value={clamp(users, limits.users)}
            minValue={limits.users[0]}
            maxValue={limits.users[1]}
            step={1}
            onChange={(value) => onChange({ users: value })}
          />
          <p className={styles.note}>
            {plural(users, 'user asks', 'users ask')} questions the whole time, with no steps.
          </p>
        </div>
        <div className={styles.tight}>
          <Slider
            label="Duration"
            unit=" minutes"
            value={clamp(minutes, range)}
            minValue={range[0]}
            maxValue={range[1]}
            step={range[0] % 30 === 0 ? 30 : 1}
            onChange={(value) => onChange({ duration_seconds: value * 60 })}
          />
          <p className={styles.note}>{span(minutes * 60)} in total.</p>
        </div>
      </div>
    );
  }

  const { levels } = computed;
  const max = plan.max_users ?? limits.max_users[0];
  const step = plan.step_users ?? limits.step_users[0];
  const hold = plan.hold_seconds ?? limits.hold_seconds[0];
  const limitS = plan.limit_ms / 1000;
  const recommendedHold = computed.recommended_hold_seconds ?? hold;
  const recommendedTimeout = computed.recommended_timeout_seconds;
  const timeoutRange = limits.timeout_seconds;
  const followTimeout = (limitMs: number) =>
    timeoutEdited
      ? {}
      : {
          timeout_seconds: clamp(Math.min(900, Math.max(180, Math.ceil((3 * limitMs) / 1000))), timeoutRange),
        };

  return (
    <div className={styles.stack}>
      <div className={styles.sliders}>
        <div className={styles.tight}>
          <Slider
            label="Highest number of users"
            unit=" users"
            value={clamp(max, limits.max_users)}
            minValue={limits.max_users[0]}
            maxValue={limits.max_users[1]}
            step={usersStep(limits.max_users)}
            onChange={(value) => onChange({ max_users: value })}
          />
          <p className={styles.note}>
            {levels.length
              ? `${plural(levels.length, 'level')}: ${levelUsers(levels)}`
              : 'No level would be measured.'}
          </p>
        </div>
        <div className={styles.tight}>
          <Slider
            label="Step between levels"
            unit=" users"
            value={clamp(step, limits.step_users)}
            minValue={limits.step_users[0]}
            maxValue={limits.step_users[1]}
            step={usersStep(limits.step_users)}
            onChange={(value) => onChange({ step_users: value })}
          />
          <p className={styles.note}>
            Each level adds {step} users. The first level is {step}.
          </p>
        </div>
        <div className={styles.tight}>
          <Slider
            label="Hold per level"
            unit="s"
            value={clamp(hold, limits.hold_seconds)}
            minValue={limits.hold_seconds[0]}
            maxValue={limits.hold_seconds[1]}
            step={limits.hold_seconds[0] % 30 === 0 ? 30 : 1}
            onChange={(value) => onChange({ hold_seconds: value })}
          />
          <p className={styles.note}>
            {span(hold)} per level.{' '}
            {hold === recommendedHold
              ? `That is the recommended hold for a ${limitS}s time limit.`
              : `Recommended for a ${limitS}s time limit: ${recommendedHold}s.`}
          </p>
          {hold === recommendedHold ? null : (
            <span>
              <Use
                label={`Use the recommended hold, ${recommendedHold}s`}
                onPress={() => onChange({ hold_seconds: clamp(recommendedHold, limits.hold_seconds) })}
              />
            </span>
          )}
        </div>
      </div>
      <div className={`${styles.fields} ${styles.rule}`}>
        <NumberField
          label="Time limit for 95% of answers"
          value={limitS}
          minValue={limits.limit_ms[0] / 1000}
          maxValue={limits.limit_ms[1] / 1000}
          step={10}
          onChange={(value) => {
            if (Number.isNaN(value)) return;
            const limit_ms = Math.round(value) * 1000;
            onChange({ limit_ms, ...followTimeout(limit_ms) });
          }}
          help="In seconds. A level breaks when 95% of its answers take longer than this."
        />
        <NumberField
          label="Highest error rate"
          value={plan.max_error_rate_pct}
          minValue={limits.max_error_rate_pct[0]}
          maxValue={limits.max_error_rate_pct[1]}
          onChange={(value) => {
            if (!Number.isNaN(value)) onChange({ max_error_rate_pct: value });
          }}
          help="In percent. A level also breaks when more than this share of answers fail."
        />
        <NumberField
          label="Follow-up questions"
          value={Math.round((plan.follow_up_rate ?? 0) * 100)}
          minValue={Math.round(limits.follow_up_rate[0] * 100)}
          maxValue={Math.round(limits.follow_up_rate[1] * 100)}
          step={5}
          onChange={(value) => {
            if (!Number.isNaN(value)) onChange({ follow_up_rate: value / 100 });
          }}
          help="In percent. How often a second question is asked in the same conversation."
        />
        <div className={styles.tight}>
          <NumberField
            label="Answer timeout"
            value={plan.timeout_seconds}
            minValue={timeoutRange[0]}
            maxValue={timeoutRange[1]}
            step={10}
            onChange={(value) => {
              if (!Number.isNaN(value))
                onChange({ timeout_seconds: Math.round(value) }, { timeoutEdited: true });
            }}
            help={`In seconds. Stop waiting for an answer after this long. ${recommendedTimeout}s is recommended for a ${limitS}s limit.`}
          />
          {plan.timeout_seconds === recommendedTimeout ? null : (
            <span>
              <Use
                label={`Use the recommended timeout, ${recommendedTimeout}s`}
                onPress={() =>
                  onChange(
                    { timeout_seconds: clamp(recommendedTimeout, timeoutRange) },
                    { timeoutEdited: false },
                  )
                }
              />
            </span>
          )}
        </div>
      </div>
      <div className={styles.tight}>
        <Switch
          isSelected={plan.abort_on_break ?? false}
          onChange={(value) => onChange({ abort_on_break: value })}
        >
          Stop at the first level that breaks
        </Switch>
        <p className={styles.note}>
          {plan.abort_on_break
            ? 'The run ends as soon as a level breaks a limit.'
            : `Off: every level is measured${levels.length > 1 ? `, all ${levels.length} of them, even after one breaks` : ''}.`}
        </p>
      </div>
    </div>
  );
}
