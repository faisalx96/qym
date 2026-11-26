/** Performance area: users over time. The plan as steps, each hold tinted by its outcome, the part already run. */
import type { PerformancePlanStage } from '@/api/performance';
import { Mark, TipBody } from '@/ui/Chart';
import { span } from '../../lib/format';
import { OUTCOME_TONE, OUTCOME_WORDS, type LevelOutcome } from '../../lib/status';
import { Plot } from './Plot';
import styles from './shared.module.css';

const usersAt = (stages: PerformancePlanStage[], baseline: number, second: number) => {
  let from = baseline;
  for (const stage of stages) {
    if (second < stage.end_s) {
      const share = Math.max(0, (second - stage.start_s) / (stage.end_s - stage.start_s));
      return from + (stage.target_users - from) * share;
    }
    from = stage.target_users;
  }
  return from;
};

export interface StepladderProps {
  stages: PerformancePlanStage[];
  /** Users at second 0. */
  baseline: number;
  /** The outcome of each level, by its number of users. A level that is absent is drawn as not measured. */
  outcomes?: Record<number, LevelOutcome>;
  /** The second the run is at; draws the "now" marker. */
  nowS?: number;
  /** The second the run ended before its plan did; draws the "ended" marker. */
  endedS?: number;
  height?: number;
  /** No axes and no marker text: the small picture of a card or a summary. */
  compact?: boolean;
}

/** A hold label's digit width and height at the small font, and its distance from the marker line, in px. */
const LABEL_CHAR = 7;
const LABEL_HEIGHT = 10;
const LABEL_GAP = 6;
/** How much higher a centred label sits when the marker line is broken around it. */
const LABEL_LIFT = 4;

/** Users over time: the plan as steps, each hold tinted by its outcome, the part already run, and "now". */
export function Stepladder({
  stages,
  baseline,
  outcomes = {},
  nowS,
  endedS,
  height = 230,
  compact = false,
}: StepladderProps) {
  const total = stages[stages.length - 1]?.end_s ?? 0;
  const top = Math.max(baseline, 1, ...stages.map((stage) => stage.target_users));
  const holds = stages.filter((stage) => stage.role === 'hold' || stage.role === 'steady');
  const m = compact ? { l: 4, r: 4, t: 18, b: 4 } : { l: 34, r: 12, t: 22, b: 24 };
  const marker = endedS ?? nowS;
  const until = marker === undefined ? undefined : Math.min(Math.max(marker, 0), total);
  return (
    <Plot
      height={height}
      label={`Users over time: ${holds.map((hold) => hold.target_users).join(', ')} users`}
    >
      {(width) => {
        if (!total) return null;
        const x = (second: number) => m.l + (second / total) * (width - m.l - m.r);
        const y = (users: number) => height - m.b - (users / (top * 1.15)) * (height - m.t - m.b);
        const points = (limit: number) => {
          const list: [number, number][] = [[0, baseline]];
          for (const stage of stages) {
            if (stage.end_s <= limit) list.push([stage.end_s, stage.target_users]);
            else {
              list.push([limit, usersAt(stages, baseline, limit)]);
              break;
            }
          }
          return list.map(([second, users]) => `${x(second).toFixed(1)},${y(users).toFixed(1)}`).join(' ');
        };
        const stepMin = total > 5400 ? 30 : total > 2400 ? 10 : total > 900 ? 5 : 1;
        const minutes = Array.from({ length: Math.floor(total / 60 / stepMin) + 1 }, (_, i) => i * stepMin);
        const mx = until === undefined ? undefined : x(until);
        // A hold's label never sits under the marker line: it moves beside the line inside its hold, or, when
        // the hold is too narrow for that, the line is broken around it.
        let cut: [number, number] | undefined;
        const labels = new Map<number, { x: number; anchor: 'start' | 'middle' | 'end'; lift?: number }>();
        for (const hold of holds) {
          const left = x(hold.start_s);
          const wide = x(hold.end_s) - left;
          const mid = left + wide / 2;
          if (mx === undefined || wide <= 18) continue;
          const half = (String(hold.target_users).length * LABEL_CHAR) / 2;
          if (Math.abs(mx - mid) >= half + LABEL_GAP) continue;
          const before = mx - LABEL_GAP - left;
          const after = left + wide - mx - LABEL_GAP;
          if (Math.max(before, after) >= half * 2) {
            labels.set(
              hold.start_s,
              after >= before ? { x: mx + LABEL_GAP, anchor: 'start' } : { x: mx - LABEL_GAP, anchor: 'end' },
            );
          } else {
            // Too narrow: the label stays centred, a little higher so it also clears the "now" dot, and the
            // line leaves a gap as tall as the label's whole box.
            const base = y(hold.target_users) - 5 - LABEL_LIFT;
            labels.set(hold.start_s, { x: mid, anchor: 'middle', lift: LABEL_LIFT });
            cut = [base - LABEL_HEIGHT - 4, base + 4];
          }
        }
        return (
          <>
            {compact
              ? null
              : [...new Set([0, Math.round(top / 2), top])].map((users) => (
                  <g key={users}>
                    <line className={styles.gridLine} x1={m.l} x2={width - m.r} y1={y(users)} y2={y(users)} />
                    <text className={styles.tick} x={m.l - 6} y={y(users) + 4} textAnchor="end">
                      {users}
                    </text>
                  </g>
                ))}
            {compact
              ? null
              : minutes.map((minute) => (
                  <text
                    key={minute}
                    className={styles.tick}
                    x={x(minute * 60)}
                    y={height - 6}
                    textAnchor={minute ? 'middle' : 'start'}
                  >
                    {minute}m
                  </text>
                ))}
            {holds.map((hold) => {
              const outcome = outcomes[hold.target_users] ?? 'waiting';
              const tone = OUTCOME_TONE[outcome];
              const left = x(hold.start_s);
              const wide = x(hold.end_s) - left;
              return (
                <g key={hold.start_s}>
                  <Mark
                    as="rect"
                    tone={tone}
                    className={styles.hold}
                    x={left}
                    y={y(hold.target_users)}
                    width={wide}
                    height={y(0) - y(hold.target_users)}
                    data-performance-level={hold.target_users}
                    data-outcome={outcome}
                    tip={
                      <TipBody
                        title={`${hold.target_users} users`}
                        rows={[
                          ['Hold', `${span(hold.start_s)} to ${span(hold.end_s)}`],
                          ['Result', OUTCOME_WORDS[outcome]],
                        ]}
                      />
                    }
                  />
                  {wide > 18 ? (
                    <text
                      className={styles.holdLabel}
                      data-tone={tone}
                      x={labels.get(hold.start_s)?.x ?? left + wide / 2}
                      y={y(hold.target_users) - 5 - (labels.get(hold.start_s)?.lift ?? 0)}
                      textAnchor={labels.get(hold.start_s)?.anchor ?? 'middle'}
                    >
                      {hold.target_users}
                    </text>
                  ) : null}
                </g>
              );
            })}
            <polyline className={styles.planLine} points={points(total)} />
            {until !== undefined ? <polyline className={styles.doneLine} points={points(until)} /> : null}
            {until !== undefined ? (
              <g data-performance-marker={endedS !== undefined ? 'ended' : 'now'}>
                {cut ? (
                  <>
                    <line className={styles.nowLine} x1={mx} x2={mx} y1={m.t - 8} y2={cut[0]} />
                    <line className={styles.nowLine} x1={mx} x2={mx} y1={cut[1]} y2={height - m.b} />
                  </>
                ) : (
                  <line className={styles.nowLine} x1={mx} x2={mx} y1={m.t - 8} y2={height - m.b} />
                )}
                {endedS === undefined ? (
                  <circle
                    className={styles.nowDot}
                    cx={x(until)}
                    cy={y(usersAt(stages, baseline, until))}
                    r={4}
                  />
                ) : null}
                {compact ? null : (
                  <text
                    className={styles.nowText}
                    x={x(until) + (x(until) > width - 140 ? -6 : 6)}
                    y={m.t - 10}
                    textAnchor={x(until) > width - 140 ? 'end' : 'start'}
                  >
                    {endedS !== undefined ? `Ended at ${span(endedS)}` : `Now ${span(nowS)}`}
                  </text>
                )}
              </g>
            ) : null}
          </>
        );
      }}
    </Plot>
  );
}
