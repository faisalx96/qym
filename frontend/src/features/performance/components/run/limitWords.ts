/**
 * Performance run page: one limit of the result in words. The runner sends the engine's own metric name and
 * expression (`llm_response_duration`, `p(95)<4000`); the page says what they mean, rounds the measured value as
 * the rest of the page does, and never shows the expression as it came.
 */
import type { PerformanceThreshold } from '@/api/performance';
import { count, pct, secs } from '../../lib/format';

export interface LimitWords {
  /** What was allowed: "95% of answers within 4s". */
  limit: string;
  /** Where it was measured: "Whole run", "Level 50". */
  where: string;
  /** The measured value in the limit's own unit: "4.7s", "6.8%", "97.7". */
  measured: string;
}

/** `p(95)<4000`, `rate<0.1`, `avg>70`: an aggregate, a comparison and a number. */
const ENGINE =
  /^\s*(p\((\d+(?:\.\d+)?)\)|avg|med|min|max|rate|count)\s*(<=|>=|===|==|!=|<|>)\s*(-?\d+(?:\.\d+)?)\s*$/;

/** The metrics the runner reports, by meaning. The second name of each is the one the page samples use. */
const TIME = ['llm_response_duration', 'p95_ms'];
const FAILED = ['http_req_failed', 'error_pct'];
const NO_DATA = ['llm_false_negative_rate', 'no_data_pct'];
const QUALITY = ['llm_quality_score', 'quality_mean'];

const OPERATOR: Record<string, string> = {
  '<': 'below',
  '<=': 'at most',
  '>': 'above',
  '>=': 'at least',
  '==': 'equal to',
  '===': 'equal to',
  '!=': 'other than',
};

/** 4000 -> '4s', 4500 -> '4.5s'. */
const shortSecs = (ms: number) => `${Number((ms / 1000).toFixed(1))}s`;
/** 0.1 -> '10%', 0.075 -> '7.5%'. */
const shortShare = (rate: number) => `${Number((rate * 100).toFixed(1))}%`;
/** A share given as a fraction (the engine's rates) or already in percent (a name ending in `_pct`). */
const asPercent = (metric: string, value: number) => (metric.endsWith('_pct') ? value : value * 100);

/** `llm_quality_score` -> 'Quality score'. */
function metricName(metric: string): string {
  const words = metric
    .replace(/^(llm|http)_/, '')
    .replace(/_/g, ' ')
    .trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : 'Limit';
}

function whereWords(scope: string): string {
  if (/^run$/i.test(scope.trim())) return 'Whole run';
  const level = /^level[\s:_-]*(\d+)$/i.exec(scope.trim());
  return level ? `Level ${level[1]}` : scope;
}

/** An expression this page does not know, still in words: "Checks: share above 90%". */
function readable(metric: string, expression: string): string {
  const match = ENGINE.exec(expression);
  if (!match) {
    const plain = expression
      .replace(/p\((\d+(?:\.\d+)?)\)/g, 'p$1')
      .replace(/<=/g, ' at most ')
      .replace(/>=/g, ' at least ')
      .replace(/</g, ' below ')
      .replace(/>/g, ' above ')
      .replace(/={2,3}/g, ' equal to ')
      .replace(/\s+/g, ' ')
      .trim();
    return `${metricName(metric)}: ${plain}`;
  }
  const [, aggregate, percentile, operator, raw] = match;
  const value = Number(raw);
  const of = percentile
    ? `p${percentile}`
    : aggregate === 'avg'
      ? 'average'
      : aggregate === 'med'
        ? 'median'
        : aggregate === 'rate'
          ? 'share'
          : aggregate!;
  const amount = aggregate === 'rate' ? shortShare(value) : count(value);
  return `${metricName(metric)}: ${of} ${OPERATOR[operator!]} ${amount}`;
}

function limitText(item: PerformanceThreshold): string {
  const expression = item.expression ?? '';
  const match = ENGINE.exec(expression);
  // Not an engine expression: a sample already in words is kept; anything with symbols is said in words.
  if (!match)
    return /[<>=()]/.test(expression)
      ? readable(item.metric, expression)
      : expression || metricName(item.metric);
  const [, aggregate, percentile, operator, raw] = match;
  const value = Number(raw);
  const below = operator === '<' || operator === '<=';
  const fewer = operator === '<' ? 'Fewer than' : 'At most';
  if (TIME.includes(item.metric) && percentile && below)
    return `${percentile}% of answers within ${shortSecs(value)}`;
  if (FAILED.includes(item.metric) && aggregate === 'rate' && below)
    return `${fewer} ${shortShare(value)} of answers fail`;
  if (NO_DATA.includes(item.metric) && aggregate === 'rate' && below)
    return `${fewer} ${shortShare(value)} of answers say no data was available`;
  if (QUALITY.includes(item.metric) && aggregate === 'avg' && !below)
    return `Average quality of the answers ${OPERATOR[operator!]} ${count(value)} out of 100`;
  return readable(item.metric, expression);
}

function measuredText(item: PerformanceThreshold): string {
  const value = item.measured;
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  if (TIME.includes(item.metric)) return secs(value);
  if (FAILED.includes(item.metric) || NO_DATA.includes(item.metric))
    return pct(asPercent(item.metric, value));
  if (QUALITY.includes(item.metric)) return value.toFixed(1);
  if (item.metric.endsWith('_pct')) return pct(value);
  if (/^\s*rate\b/.test(item.expression ?? '')) return pct(value * 100);
  return count(Math.round(value * 10) / 10);
}

export function limitWords(item: PerformanceThreshold): LimitWords {
  return { limit: limitText(item), where: whereWords(item.scope ?? ''), measured: measuredText(item) };
}
