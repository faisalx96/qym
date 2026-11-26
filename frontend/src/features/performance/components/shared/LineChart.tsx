/** Performance area: the two small charts over named points (levels, runs): lines, and one bar per level. */
import { EmptyState } from '@/ui';
import { Mark, TipBody } from '@/ui/Chart';
import { Plot } from './Plot';
import styles from './shared.module.css';

/** What an empty chart says, centred in the plot height (§3.5: an empty chart card keeps the plot height). */
export interface ChartEmpty {
  title: string;
  body: string;
}

const NO_VALUES: ChartEmpty = { title: 'No values yet', body: 'A point is drawn once a level has answers.' };

/** Half the 24px hit area every mark keeps (§3.5 "Hit areas are at least 24px"), whatever its drawn size. */
const HIT = 12;

/** The plot's own height with one compact EmptyState centred in it, so the card does not change height. */
function EmptyPlot({ height, empty }: { height: number; empty: ChartEmpty }) {
  return (
    <div className={styles.emptyPlot} style={{ blockSize: height }} data-performance-chart-empty="">
      <EmptyState compact title={empty.title} body={empty.body} />
    </div>
  );
}

export interface LineSeries {
  name: string;
  tone?: 'success' | 'danger' | 'info' | 'warning';
  series?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  dash?: boolean;
  values: (number | null)[];
}

export interface ChartLimit {
  value: number;
  label: string;
}

/** Lines over a few named points (levels, runs), with an optional limit line. */
export function LineChart({
  label,
  xs,
  series,
  yMax,
  unit = '',
  limit,
  xTitle,
  height = 220,
  empty = NO_VALUES,
  formatY = Math.round,
}: {
  label: string;
  xs: string[];
  series: LineSeries[];
  yMax: number;
  unit?: string;
  formatY?: (value: number) => string | number;
  limit?: ChartLimit;
  xTitle?: string;
  height?: number;
  /** Shown instead of bare axes when no series has a value. */
  empty?: ChartEmpty;
}) {
  const m = { l: 44, r: 16, t: 16, b: xTitle ? 38 : 26 };
  if (series.every((line) => line.values.every((value) => value === null)))
    return <EmptyPlot height={height} empty={empty} />;
  return (
    <Plot height={height} label={label}>
      {(width) => {
        const x = (index: number) =>
          m.l + (xs.length === 1 ? 0.5 : index / (xs.length - 1)) * (width - m.l - m.r);
        const y = (value: number) => height - m.b - (value / yMax) * (height - m.t - m.b);
        return (
          <>
            {[0, 1, 2, 3, 4].map((step) => {
              const value = (yMax / 4) * step;
              return (
                <g key={step}>
                  <line className={styles.gridLine} x1={m.l} x2={width - m.r} y1={y(value)} y2={y(value)} />
                  <text className={styles.tick} x={m.l - 6} y={y(value) + 4} textAnchor="end">
                    {formatY(value)}
                    {unit}
                  </text>
                </g>
              );
            })}
            {xs.map((name, index) => (
              <text
                key={name}
                className={styles.tick}
                x={x(index)}
                y={height - m.b + 16}
                textAnchor={
                  xs.length === 1
                    ? 'middle'
                    : index === 0
                      ? 'start'
                      : index === xs.length - 1
                        ? 'end'
                        : 'middle'
                }
              >
                {name}
              </text>
            ))}
            {xTitle ? (
              <text className={styles.tick} x={width - m.r} y={height - 4} textAnchor="end">
                {xTitle}
              </text>
            ) : null}
            {limit ? (
              <g data-performance-limit={limit.value}>
                <line
                  className={styles.limitLine}
                  x1={m.l}
                  x2={width - m.r}
                  y1={y(limit.value)}
                  y2={y(limit.value)}
                />
                <text className={styles.limitText} x={width - m.r} y={y(limit.value) - 5} textAnchor="end">
                  {limit.label}
                </text>
              </g>
            ) : null}
            {series.map((line) => {
              let path = '';
              let pen = false;
              line.values.forEach((value, index) => {
                if (value === null) {
                  pen = false;
                  return;
                }
                path += `${pen ? 'L' : 'M'}${x(index).toFixed(1)} ${y(value).toFixed(1)}`;
                pen = true;
              });
              return (
                <g key={line.name} data-tone={line.tone} data-series={line.series}>
                  <path className={styles.seriesLine} d={path} data-dash={line.dash ? '' : undefined} />
                  {line.values.map((value, index) =>
                    value === null ? null : (
                      // The 7px dot is what shows; the transparent 24px circle under it takes the pointer.
                      <Mark
                        key={xs[index]}
                        as="g"
                        tip={
                          <TipBody
                            title={`${line.name} at ${xs[index]}`}
                            rows={[[line.name, `${value}${unit}`]]}
                          />
                        }
                      >
                        <circle className={styles.hit} cx={x(index)} cy={y(value)} r={HIT} />
                        <circle className={styles.seriesDot} cx={x(index)} cy={y(value)} r={3.5} />
                      </Mark>
                    ),
                  )}
                </g>
              );
            })}
          </>
        );
      }}
    </Plot>
  );
}

/** Share of failed answers per level, one bar each, with the error limit. */
export function ErrorBars({
  xs,
  values,
  yMax,
  limit,
  height = 210,
  empty = NO_VALUES,
}: {
  xs: string[];
  values: (number | null)[];
  yMax: number;
  limit: ChartLimit;
  height?: number;
  /** Shown instead of bare axes when no level has a value. */
  empty?: ChartEmpty;
}) {
  const m = { l: 44, r: 16, t: 16, b: 38 };
  if (values.every((value) => value === null)) return <EmptyPlot height={height} empty={empty} />;
  return (
    <Plot height={height} label="Errors by level">
      {(width) => {
        const band = (width - m.l - m.r) / Math.max(1, xs.length);
        const y = (value: number) => height - m.b - (value / yMax) * (height - m.t - m.b);
        return (
          <>
            {[0, 1, 2, 3].map((step) => {
              const value = (yMax / 3) * step;
              return (
                <g key={step}>
                  <line className={styles.gridLine} x1={m.l} x2={width - m.r} y1={y(value)} y2={y(value)} />
                  <text className={styles.tick} x={m.l - 6} y={y(value) + 4} textAnchor="end">
                    {Math.round(value)}%
                  </text>
                </g>
              );
            })}
            {xs.map((name, index) => {
              const value = values[index] ?? null;
              const center = m.l + band * (index + 0.5);
              const barWidth = Math.min(44, band - 8);
              const top = Math.min(y(value ?? 0), y(0) - 3);
              // A short bar keeps a 24px hit area: a transparent box at least 24 x 24 around it, ending on the axis.
              const hitWidth = Math.max(2 * HIT, barWidth);
              const hitTop = Math.min(top, y(0) - 2 * HIT);
              return (
                <g key={name}>
                  {value === null ? null : (
                    <>
                      <Mark
                        as="g"
                        tone="danger"
                        tip={
                          <TipBody
                            title={`${name} users`}
                            rows={[['Answers that failed', `${value.toFixed(1)}%`]]}
                          />
                        }
                      >
                        <rect
                          className={styles.hit}
                          x={center - hitWidth / 2}
                          y={hitTop}
                          width={hitWidth}
                          height={y(0) - hitTop}
                        />
                        <rect
                          className={styles.bar}
                          x={center - barWidth / 2}
                          y={top}
                          width={barWidth}
                          height={Math.max(3, y(0) - y(value))}
                        />
                      </Mark>
                      <text className={styles.tick} x={center} y={top - 5} textAnchor="middle">
                        {value.toFixed(1)}%
                      </text>
                    </>
                  )}
                  <text className={styles.tick} x={center} y={height - m.b + 16} textAnchor="middle">
                    {name}
                  </text>
                </g>
              );
            })}
            <text className={styles.tick} x={width - m.r} y={height - 4} textAnchor="end">
              users
            </text>
            <line
              className={styles.limitLine}
              x1={m.l}
              x2={width - m.r}
              y1={y(limit.value)}
              y2={y(limit.value)}
            />
            <text className={styles.limitText} x={width - m.r} y={y(limit.value) - 5} textAnchor="end">
              {limit.label}
            </text>
          </>
        );
      }}
    </Plot>
  );
}
