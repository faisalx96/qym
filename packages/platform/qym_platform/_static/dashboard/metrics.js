/**
 * Shared metrics calculation utilities for قيِّم Dashboard
 *
 * This module provides consistent metric calculations across:
 * - Compare view
 * - Models view
 * - Aggregate publish
 *
 * IMPORTANT: Error handling is centralized here (getRowScore). Task and
 * scorer errors count as 0, except for lower-is-better metrics, which leave
 * them out of the mean (0 is their best value) and never count them as a
 * pass. A repeat row judges task errors per pass, and an item never received
 * is left out. Same rule as services/run_means.py.
 */

/**
 * Check if a row represents an error/failed item
 * @param {Object} row - Row data from snapshot
 * @returns {boolean} True if the row is an error
 */
function isTaskErrorRow(row) {
  if (!row) return false;
  const status = String(row.status || '').toLowerCase();
  return status === 'error' || status === 'failed';
}

/**
 * Check whether one metric metadata object represents an execution error.
 * Metric exceptions keep a numeric score of 0 for aggregation, so metadata is
 * the signal that distinguishes an exception from an ordinary judged failure.
 * Same rule as services/run_means.py (is_metric_error).
 */
function isMetricErrorMeta(meta) {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return false;
  // A metric label such as "failed" can be an ordinary judge verdict, and a
  // task exception creates zero-filled pass scores labelled "error". Only the
  // explicit execution status the SDK sets for a raised metric is
  // authoritative; meta.error alone is a verdict reason ("Empty output").
  const status = String(meta.status || '').trim().toLowerCase();
  return status === 'error' || status === 'failed' || status === 'timeout';
}

/**
 * Display key for one metric metadata field. Older metrics (and the SDK guide
 * before the "reason" key) stored verdict reasons such as "Empty output" under
 * "error"; without an execution status that field reads as the "reason".
 */
function metricMetaDisplayKey(key, meta) {
  if (key !== 'error' || isMetricErrorMeta(meta)) return key;
  const hasReason = meta && typeof meta === 'object'
    && meta.reason !== undefined && meta.reason !== null && meta.reason !== '';
  return hasReason ? key : 'reason';
}

/**
 * Metadata keys the platform adds beside a scorer's own: a reviewer's edit
 * flags, and the task_error flag of an "error"-labeled pass
 * (isTaskErrorPass). They are not metric fields and are not shown as judge
 * output.
 */
const INTERNAL_META_KEYS = new Set(['modified', 'original_score', 'task_error']);
function isInternalMetaKey(key) {
  return INTERNAL_META_KEYS.has(key);
}

/**
 * Check current and per-pass metric metadata for a metric execution error.
 */
function hasMetricError(row, metricName = null) {
  if (!row) return false;
  const aggregateMeta = row.metric_meta && typeof row.metric_meta === 'object'
    ? row.metric_meta
    : {};
  const passMeta = row.pass_metric_meta && typeof row.pass_metric_meta === 'object'
    ? row.pass_metric_meta
    : {};
  const metricNames = metricName === null
    ? Array.from(new Set([...Object.keys(aggregateMeta), ...Object.keys(passMeta)]))
    : [metricName];

  return metricNames.some(name => {
    const perPass = passMeta[name];
    if (Array.isArray(perPass) && perPass.some(isMetricErrorMeta)) return true;
    return isMetricErrorMeta(aggregateMeta[name]);
  });
}

/**
 * A repeat run's item row over all its passes. Rows scoped to one pass (run
 * page ?pass=N, Compare pass columns, group-analysis pass rows) set
 * __pass_scope. The row status is only the outcome of the pass that arrived
 * last, so a repeat row's task errors are judged per pass (its pass
 * metadata and attempts), never by its status: the same passes give the same
 * mean whichever of them failed last. Same rule as services/run_means.py.
 */
function isRepeatAggregateRow(row) {
  return !!row && row.__pass_scope !== true
    && !!row.pass_scores && typeof row.pass_scores === 'object' && !Array.isArray(row.pass_scores);
}

/**
 * An item whose task failed as a whole: a classic row, or a row scoped to
 * one pass. A repeat row's value already holds its failed passes.
 */
function isItemTaskError(row) {
  return isTaskErrorRow(row) && !isRepeatAggregateRow(row);
}

/**
 * An item of a completed run whose outcome never reached the platform (the
 * server's row state "not_received", services/run_means.py
 * item_not_received): neither a success nor an error, and left out of every
 * mean.
 */
function isNotReceivedRow(row) {
  return !!row && String(row.status || '').toLowerCase() === 'not_received';
}

/** Whether a row's task failed: the item, or any pass of a repeat row. */
function hasTaskError(row) {
  if (!isRepeatAggregateRow(row)) return isTaskErrorRow(row);
  const attempts = Array.isArray(row.pass_attempts) ? row.pass_attempts : [];
  if (attempts.some(attempt => !!attempt && isTaskErrorRow(attempt))) return true;
  const metas = row.pass_metric_meta && typeof row.pass_metric_meta === 'object' ? row.pass_metric_meta : {};
  return Object.keys(metas).some(name => Array.isArray(metas[name])
    && metas[name].some((_, index) => isTaskErrorPass(row, name, index)));
}

function isErrorRow(row) {
  return hasTaskError(row) || hasMetricError(row);
}

/** Parse one stored metric value (number, boolean, "80%", "true", ...). */
function parseScoreValue(metricValue) {
  if (metricValue === undefined || metricValue === null) return null;
  if (typeof metricValue === 'number') {
    return Number.isFinite(metricValue) ? metricValue : null;
  }
  if (typeof metricValue === 'boolean') {
    return metricValue ? 1 : 0;
  }

  const raw = String(metricValue).trim();
  if (!raw) return null;

  const lowered = raw.toLowerCase();
  if (lowered === 'n/a' || lowered === 'na' || lowered === 'none' || lowered === 'null') {
    return null;
  }
  if (raw === '✓' || lowered === 'true' || lowered === 'yes' || lowered === 'y') {
    return 1;
  }
  if (raw === '✗' || lowered === 'false' || lowered === 'no' || lowered === 'n') {
    return 0;
  }

  if (raw.endsWith('%')) {
    const pct = parseFloat(raw.slice(0, -1).trim());
    if (!isNaN(pct)) return pct / 100;
  }

  const score = parseFloat(raw);
  if (isNaN(score)) return null;
  return score;
}

/**
 * Validate a manual score edit by the metric's spec type before it is sent.
 * Same rules and messages as services/score_edits.py on the server, which
 * rejects anything else with a 422.
 * @param {*} raw - Input value (usually the editor's text)
 * @param {Object|null} spec - Run metric spec (score_type); none = any number
 * @param {{reduced?: boolean}} [options] - reduced: a repeat-run item value
 *   (the mean over passes), so a boolean is a rate and a count may be fractional
 * @returns {{ok: true, value: number}|{ok: false, message: string}}
 */
// var, not const: shell.js re-runs this classic script on every in-app
// navigation, and a second top-level const/let declaration throws.
var SCORE_EDIT_HINTS = {
  boolean: 'Enter true or false (1 or 0).',
  percentage: 'Enter a value from 0 to 1, or 0% to 100%.',
  count: 'Enter a whole number, 0 or more.',
  number: 'Enter a number.',
  legacy: 'Enter a number.',
};

function parseMetricScoreInput(raw, spec, options = {}) {
  let scoreType = spec && spec.score_type;
  if (options && options.reduced) scoreType = { boolean: 'percentage', count: 'number' }[scoreType] || scoreType;
  const kind = Object.prototype.hasOwnProperty.call(SCORE_EDIT_HINTS, scoreType) ? scoreType : 'legacy';
  const hint = SCORE_EDIT_HINTS[kind];
  const fail = message => ({ ok: false, message });
  const booleanWords = kind === 'boolean' || kind === 'legacy';
  let number;
  if (typeof raw === 'boolean') {
    return booleanWords ? { ok: true, value: raw ? 1 : 0 } : fail(hint);
  }
  if (typeof raw === 'number') {
    number = raw;
  } else if (typeof raw === 'string') {
    let text = raw.trim();
    if (!text) return fail('Enter a score. ' + hint);
    const lowered = text.toLowerCase();
    if (booleanWords && (lowered === 'true' || lowered === 'yes')) return { ok: true, value: 1 };
    if (booleanWords && (lowered === 'false' || lowered === 'no')) return { ok: true, value: 0 };
    const percent = text.endsWith('%');
    if (percent) {
      if (kind !== 'percentage' && kind !== 'legacy') return fail(hint);
      text = text.slice(0, -1).trim();
    }
    if (/^[+-]?[0-9]+,[0-9]+$/.test(text)) return fail('Use a dot for decimals (0.7, not 0,7).');
    if (!/^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)([eE][+-]?[0-9]+)?$/.test(text)) return fail(hint);
    number = Number(text) / (percent ? 100 : 1);
  } else {
    return fail(hint);
  }
  if (!Number.isFinite(number)) return fail(hint);
  if (kind === 'boolean' && number !== 0 && number !== 1) return fail(hint);
  if (kind === 'percentage' && !(number >= 0 && number <= 1)) return fail(hint);
  if (kind === 'count' && (number < 0 || !Number.isInteger(number))) return fail(hint);
  return { ok: true, value: number };
}

/**
 * Whether a metric leaves errors out of its mean instead of counting 0.
 * 0 is the best value of a lower-is-better metric, so counting an error as 0
 * would reward it. Same rule as services/run_means.py (errors_left_out).
 */
function errorsLeftOut(direction) {
  return direction === 'minimize';
}

/**
 * A repeat-run pass whose task failed. Ingest stores 0 with the label
 * "error" for its metrics and marks them "task_error"; the row's pass
 * attempt is an error. The run payload sends task_error, true or false, with
 * every "error"-labeled pass, classified by services/run_means.py
 * (is_task_error_pass) before the index dropped the explanation and long
 * metadata. Only rows without the flag fall back to the metadata left.
 */
function isTaskErrorPass(row, metricName, passIndex) {
  const meta = row?.pass_metric_meta?.[metricName]?.[passIndex];
  if (isMetricErrorMeta(meta)) return false;
  if (meta && typeof meta === 'object') {
    // A reviewer's score replaces what the failed task left behind.
    if (String(meta.modified || '').toLowerCase() === 'true') return false;
    if (String(meta.label || '').trim().toLowerCase() === 'error') {
      // The server's verdict, made before compaction dropped the evidence.
      if (typeof meta.task_error === 'boolean') return meta.task_error;
      // Unmarked (older) rows: ingest's zero-fill carried only the "error"
      // label. A scorer's own "error" label comes with its metadata; then
      // the pass attempt decides.
      const others = Object.keys(meta).filter(key => key !== 'label' && key !== 'status'
        && meta[key] !== null && meta[key] !== undefined && meta[key] !== '');
      if (others.length === 0) return true;
    }
  }
  const attempt = Array.isArray(row?.pass_attempts) ? row.pass_attempts[passIndex] : null;
  return !!attempt && isTaskErrorRow(attempt);
}

/**
 * A repeat item a reviewer scored as a whole (an edit without a pass): it
 * keeps that value in every mean instead of being re-derived from its
 * passes. Same rule as services/run_means.py (is_item_edit).
 */
function isItemEdit(meta) {
  return !!meta && typeof meta === 'object' && String(meta.item_edit || '').toLowerCase() === 'true';
}

/**
 * A row scoped to one pass (run page ?pass=N, Compare pass columns) whose
 * task failed but whose metric a reviewer then scored: the reviewer's score
 * stands, as on the server (/passes). Scoped rows set __pass_scope.
 */
function isReviewedPassSlice(row, metricName) {
  if (!row || row.__pass_scope !== true || metricName === null || metricName === undefined) return false;
  const meta = row.metric_meta && typeof row.metric_meta === 'object' ? row.metric_meta[metricName] : null;
  return !!meta && typeof meta === 'object' && String(meta.modified || '').toLowerCase() === 'true';
}

/**
 * A repeat row's passes for one metric: value, scorer error, task error.
 * Null for rows without per-pass data. Rows scoped to one pass keep the
 * run's pass_scores but carry no pass_metric_meta; every errored pass has
 * metadata (a status or the "error" label), so those rows are not re-read.
 */
function repeatPassOutcomes(row, metricName) {
  const scores = row?.pass_scores?.[metricName];
  if (!Array.isArray(scores)) return null;
  if (!row.pass_metric_meta || typeof row.pass_metric_meta !== 'object') return null;
  const metas = row.pass_metric_meta[metricName];
  return scores.map((raw, index) => {
    const scorerError = isMetricErrorMeta(Array.isArray(metas) ? metas[index] : null);
    return {
      value: parseScoreValue(raw),
      scorerError,
      taskError: !scorerError && isTaskErrorPass(row, metricName, index),
    };
  });
}

/**
 * Get the score for a row: the SINGLE SOURCE OF TRUTH for how errors enter a
 * metric's mean. Same rule as services/run_means.py.
 * - Higher is better, or no declared direction: a task error, or a scorer
 *   error, counts as 0 (C015).
 * - Lower is better (``direction`` "minimize"): errors are left out (score
 *   null, isError true). A repeat row with errored passes is the mean over
 *   its passes without an error (null when none is left).
 * A repeat row judges task errors per pass (isRepeatAggregateRow): its value
 * counts a failed pass as 0 already, whichever pass arrived last. An item
 * never received has no score and no error (isNotReceivedRow).
 * @param {Object} row - Row data from snapshot
 * @param {number} metricIdx - Index of the metric in metric_values array
 * @param {string|null} metricName - Metric key used to find exception metadata
 * @param {'maximize'|'minimize'|null} [direction] - The metric's declared
 *   direction (metricDirection)
 * @returns {{score: number|null, isError: boolean}} Score and error flag
 */
function getRowScore(row, metricIdx, metricName = null, direction = null) {
  if (!row || isNotReceivedRow(row)) return { score: null, isError: false };
  const leftOut = errorsLeftOut(direction);

  // A task error invalidates every metric. A metric error invalidates only
  // that metric; sibling metrics on the same item retain their real scores.
  if (isItemTaskError(row) && !isReviewedPassSlice(row, metricName)) {
    return { score: leftOut ? null : 0, isError: true };
  }
  // A repeat item scored as a whole by a reviewer: that value, errored
  // passes or not.
  if (metricName !== null && isItemEdit(row?.metric_meta?.[metricName])) {
    return { score: parseScoreValue((row.metric_values || [])[metricIdx]), isError: false };
  }
  if (leftOut && metricName !== null) {
    const passes = repeatPassOutcomes(row, metricName);
    if (passes && passes.some(pass => pass.scorerError || pass.taskError)) {
      let sum = 0;
      let count = 0;
      passes.forEach(pass => {
        if (pass.scorerError || pass.taskError || pass.value === null) return;
        sum += pass.value;
        count++;
      });
      return { score: count ? sum / count : null, isError: true };
    }
    if (hasMetricError(row, metricName)) return { score: null, isError: true };
  }
  const metricError = metricName !== null && hasMetricError(row, metricName);

  const metricValues = row?.metric_values || [];
  const metricValue = metricValues[metricIdx];
  const score = parseScoreValue(metricValue);
  if (score === null) {
    return metricError
      ? { score: 0, isError: true }
      : { score: null, isError: false };
  }

  return { score, isError: metricError };
}

/**
 * Task and scorer errors a row holds for one metric: once per item, or per
 * errored pass for a repeat row (the unit of the runs list, "across all
 * passes").
 * @returns {{task: number, scorer: number}}
 */
function rowMetricErrorCounts(row, metricName) {
  if (isNotReceivedRow(row)) return { task: 0, scorer: 0 };
  const passes = repeatPassOutcomes(row, metricName);
  if (passes) {
    const task = passes.filter(pass => pass.taskError).length;
    const scorer = passes.filter(pass => pass.scorerError).length;
    if (task || scorer || isRepeatAggregateRow(row)) return { task, scorer };
  }
  // A repeat row without this metric's passes (the Models payload ships
  // only errored passes a verdict needs): its status is the pass that
  // arrived last, one failed pass when it is an error.
  if (isRepeatAggregateRow(row)) {
    return { task: isTaskErrorRow(row) ? 1 : 0, scorer: hasMetricError(row, metricName) ? 1 : 0 };
  }
  if (isTaskErrorRow(row)) return isReviewedPassSlice(row, metricName) ? { task: 0, scorer: 0 } : { task: 1, scorer: 0 };
  return { task: 0, scorer: hasMetricError(row, metricName) ? 1 : 0 };
}

/**
 * Pass/fail verdict for a row outcome ({score, isError} from getRowScore):
 * true, false, or null without a declared direction. An errored item never
 * passes when lower is better; when higher is better it fails through its 0.
 */
function rowMetricPasses(outcome, threshold, direction, isBoolean = false) {
  if (direction !== 'maximize' && direction !== 'minimize') return null;
  if (outcome && outcome.isError && errorsLeftOut(direction)) return false;
  return metricPasses(outcome ? outcome.score : null, threshold, direction, isBoolean);
}

/** How a metric's errors enter its mean, for notes and tooltips. */
function metricErrorRuleLabel(direction) {
  return errorsLeftOut(direction) ? 'not counted in the mean' : 'counted as 0%';
}

/**
 * A row's metric value with scorer errors left out, and how many scorer
 * errors it held. Same rule as services/run_means.py (the published "mean
 * without scorer errors"):
 * - a classic row with a scorer error is left out (score null, errors 1);
 * - a repeat row is re-reduced over its passes that did not error, and
 *   ``errors`` counts the errored passes; a row whose every pass errored is
 *   left out;
 * - a task error is not a scorer error: it keeps its 0 (errors 0).
 * A lower-is-better metric leaves every error out of its mean already, so
 * its value is getRowScore's.
 */
function scoreWithoutMetricErrors(row, metricIdx, metricName, direction = null) {
  if (errorsLeftOut(direction)) {
    const { score } = getRowScore(row, metricIdx, metricName, direction);
    return { score, errors: rowMetricErrorCounts(row, metricName).scorer };
  }
  const { score, isError } = getRowScore(row, metricIdx, metricName);
  if (score === null) return { score: null, errors: 0 };
  if (!isError || isItemTaskError(row)) return { score, errors: 0 };
  const passScores = row?.pass_scores?.[metricName];
  const passMeta = row?.pass_metric_meta?.[metricName];
  if (Array.isArray(passScores) && Array.isArray(passMeta) && passMeta.some(isMetricErrorMeta)) {
    let sum = 0;
    let count = 0;
    let errors = 0;
    passScores.forEach((raw, index) => {
      if (isMetricErrorMeta(passMeta[index])) {
        errors++;
        return;
      }
      const value = parseScoreValue(raw);
      if (value !== null) {
        sum += value;
        count++;
      }
    });
    return { score: count ? sum / count : null, errors };
  }
  return { score: null, errors: 1 };
}

/** Index rows using the same first-match identity semantics as Array.find. */
function indexRowsById(rows, getItemId) {
  const index = new Map();
  for (const row of rows || []) {
    const id = getItemId(row);
    // Array.find uses strict equality: NaN never matches, and duplicates use
    // the first row. Keep both rules when indexing arbitrary item identities.
    if (id === id && !index.has(id)) index.set(id, row);
  }
  return index;
}

/**
 * Calculate aggregate metrics from item-level data across K runs
 *
 * @param {Object} options - Calculation options
 * @param {Array} options.runsData - Array of run data objects with snapshot.rows
 * @param {string} options.metricName - Name of the metric to calculate
 * @param {number} options.threshold - Threshold for "passing" (0-1)
 * @param {Function} options.getMetricIndex - Function to get metric index from run data
 * @param {Function} [options.getItemId] - Optional function to get item ID from row (defaults to index)
 * @param {boolean} [options.trackDistribution] - If true, track correctDistribution array
 * @param {'maximize'|'minimize'|null} [options.direction] - Declared direction
 *   (metricDirection). Pass/fail and Max@K follow it; null (no direction)
 *   yields no passes. Omitted = maximize, for older callers.
 * @param {boolean} [options.isBoolean] - Boolean metric (pass on True/False)
 * @returns {Object} Calculated metrics
 */
function calculateItemLevelMetrics(options) {
  const { runsData, metricName, threshold, getMetricIndex, getItemId, trackDistribution } = options;
  const direction = options.direction === undefined ? 'maximize' : options.direction;
  const isBoolean = options.isBoolean === undefined ? Number(threshold) >= 0.9999 : !!options.isBoolean;
  const passes = outcome => rowMetricPasses(outcome, threshold, direction, isBoolean) === true;

  const K = runsData?.length || 0;

  const result = {
    passAtK: 0,
    passHatK: 0,
    maxAtK: 0,
    consistency: null,
    reliability: null,
    avgScore: 0,
    avgLatency: 0,
    medianLatency: 0,
    totalItems: 0,
    failedCount: 0,
    K: K,
    totalScoreSum: 0,
    totalScoreCount: 0,
    totalLatencySum: 0,
    totalLatencyCount: 0,
    correctDistribution: trackDistribution ? new Array(K + 1).fill(0) : null,
    minScore: 0,
    stddevScore: 0
  };

  if (!runsData || runsData.length === 0) {
    return result;
  }

  // Get max items across all runs
  const maxItems = Math.max(...runsData.map(r => (r?.snapshot?.rows || []).length));

  if (maxItems === 0) {
    return result;
  }

  let passAtKCount = 0;
  let passHatKCount = 0;
  let totalConsistencySum = 0;  // Sum of per-item consistency scores
  let totalReliabilitySum = 0;  // Sum of per-item reliability (pass_count / K) for items with at least one pass
  let maxScoreSum = 0;
  let itemsWithBest = 0;  // Items with a score to take the best of (Max@K)
  let totalScoreSum = 0;
  let totalScoreCount = 0;
  let totalLatencySum = 0;
  let totalLatencyCount = 0;
  let latencySamples = [];
  let allScores = [];  // collect all individual scores for min/stddev
  let itemsWithData = 0;
  let itemsWithMultipleRuns = 0;  // Only count items with K > 1 for consistency
  let itemsWithAtLeastOnePass = 0;  // Items where at least one run passed (for reliability)
  let failedCount = 0;  // Total number of failed attempts across all items and runs

  // Build item map for matching by ID if available
  const itemIds = new Set();
  const rowIndexes = new Map();
  const rowId = getItemId || (row => String(row.index));
  for (const runData of runsData) {
    const rows = runData?.snapshot?.rows || [];
    rowIndexes.set(runData, indexRowsById(rows, rowId));
    for (const row of rows) {
      const itemId = getItemId ? getItemId(row) : String(row.index);
      itemIds.add(itemId);
    }
  }

  // Process each unique item
  for (const itemId of itemIds) {
    // One outcome per run: its score (null when an error is left out of the
    // mean) and whether it errored.
    const outcomes = [];

    // Get score for this item from each run
    for (const runData of runsData) {
      const row = rowIndexes.get(runData).get(itemId);

      if (!row) continue;

      const metricIdx = getMetricIndex(runData);
      if (metricIdx < 0) continue;

      // Centralized error rule: 0, or left out when lower is better.
      const outcome = getRowScore(row, metricIdx, metricName, direction);
      const { score, isError } = outcome;

      if (score !== null || isError) outcomes.push(outcome);
      // Errors in the unit of the runs list and run page: each errored pass
      // of a repeat row, else once per item.
      const errors = rowMetricErrorCounts(row, metricName);
      failedCount += errors.task + errors.scorer;
      if (score !== null) {
        totalScoreSum += score;
        totalScoreCount++;
        allScores.push(score);
      }

      // Collect latency
      const latency = row?.latency_ms;
      if (latency && latency > 0) {
        totalLatencySum += latency;
        totalLatencyCount++;
        latencySamples.push(latency);
      }
    }

    if (outcomes.length === 0) continue;
    itemsWithData++;

    // Calculate item-level stats: the best score follows the direction; an
    // errored run is a failure and has no score to be the best.
    const scores = outcomes.map(outcome => outcome.score).filter(score => score !== null);
    const numCorrect = outcomes.filter(passes).length;

    // Track distribution if requested
    if (trackDistribution && result.correctDistribution) {
      result.correctDistribution[numCorrect]++;
    }

    // Max@K: track the best score for this item
    if (scores.length) {
      maxScoreSum += direction === 'minimize' ? Math.min(...scores) : Math.max(...scores);
      itemsWithBest++;
    }

    // Pass@K: at least one run passed for this item
    if (numCorrect > 0) passAtKCount++;

    // Pass^K: ALL runs passed for this item
    const allCorrectItem = numCorrect === outcomes.length && outcomes.length > 0;
    if (allCorrectItem) passHatKCount++;

    // Consistency: binary agreement (do runs agree on pass/fail?)
    // Formula: 2 * max(passCount, failCount) / K - 1
    // Range: 0% (50/50 split) to 100% (all agree)
    const numScores = outcomes.length;
    if (numScores > 1) {
      const numFail = numScores - numCorrect;
      const maxAgreement = Math.max(numCorrect, numFail);
      const itemConsistency = (2 * maxAgreement / numScores) - 1;
      totalConsistencySum += itemConsistency;
      itemsWithMultipleRuns++;

      // Reliability: when it CAN answer correctly, how often does it?
      // Formula: pass_count / K, but ONLY for items where pass_count > 0
      if (numCorrect > 0) {
        const itemReliability = numCorrect / numScores;
        totalReliabilitySum += itemReliability;
        itemsWithAtLeastOnePass++;
      }
    }
  }

  // Calculate final stats
  result.totalItems = itemsWithData;
  result.failedCount = failedCount;
  result.passAtK = itemsWithData > 0 ? passAtKCount / itemsWithData : 0;
  result.passHatK = itemsWithData > 0 ? passHatKCount / itemsWithData : 0;
  result.maxAtK = itemsWithBest > 0 ? maxScoreSum / itemsWithBest : 0;
  // Consistency = average of per-item binary agreement scores (requires K > 1)
  result.consistency = itemsWithMultipleRuns > 0 ? totalConsistencySum / itemsWithMultipleRuns : null;
  // Reliability = average pass rate for items that CAN be solved (requires K > 1)
  result.reliability = itemsWithAtLeastOnePass > 0 ? totalReliabilitySum / itemsWithAtLeastOnePass : null;
  result.avgScore = totalScoreCount > 0 ? totalScoreSum / totalScoreCount : 0;
  result.avgLatency = totalLatencyCount > 0 ? totalLatencySum / totalLatencyCount : 0;
  result.medianLatency = latencySamples.length > 0 ? calculateMedian(latencySamples) : 0;
  result.totalScoreSum = totalScoreSum;
  result.totalScoreCount = totalScoreCount;
  result.totalLatencySum = totalLatencySum;
  result.totalLatencyCount = totalLatencyCount;
  result.minScore = allScores.length > 0 ? Math.min(...allScores) : 0;
  if (allScores.length > 1) {
    const mean = totalScoreSum / allScores.length;
    const sqDiffSum = allScores.reduce((sum, s) => sum + (s - mean) * (s - mean), 0);
    result.stddevScore = Math.sqrt(sqDiffSum / allScores.length);
  } else {
    result.stddevScore = 0;
  }

  return result;
}

function calculateMedian(values) {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const sorted = [...values]
    .map(value => Number(value))
    .filter(value => Number.isFinite(value))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return 0;

  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Calculate strict grouped item outcomes for two K-run model groups.
 *
 * Only items present with a score or an error in all selected runs are
 * eligible. Errors follow getRowScore(): they count as 0 and fail when higher
 * is better; when lower is better they are left out of averages and always
 * fail.
 *
 * @param {Object} options
 * @param {Array} options.runsData
 * @param {Array<string>} options.leftRunIds
 * @param {Array<string>} options.rightRunIds
 * @param {number} options.threshold
 * @param {string} options.metricName
 * @param {Function} options.getMetricIndex
 * @param {Function} options.getItemId
 * @param {Function} options.getRunId
 * @returns {Object}
 */
function calculateGroupedOutcomeBuckets(options) {
  const grouped = calculateGroupedCohortComparison(options);
  return {
    eligibleItems: grouped.eligibleItems || 0,
    leftRunCount: grouped.leftRunCount || 0,
    rightRunCount: grouped.rightRunCount || 0,
    buckets: grouped.buckets || {
      a_sweeps_b: { count: 0, percentage: 0, itemIds: [] },
      b_sweeps_a: { count: 0, percentage: 0, itemIds: [] },
      both_pass: { count: 0, percentage: 0, itemIds: [] },
      both_fail: { count: 0, percentage: 0, itemIds: [] },
    },
  };
}

/**
 * Calculate grouped cohort comparison stats for two K-run groups.
 *
 * Only items present with a score or an error in every selected run are
 * eligible. Errors follow getRowScore(): they count as 0 and fail when higher
 * is better; when lower is better they are left out of averages and always
 * fail (an errored pass of a repeat run too).
 *
 * @param {Object} options
 * @param {Array} options.runsData
 * @param {Array<string>} options.leftRunIds
 * @param {Array<string>} options.rightRunIds
 * @param {number} options.threshold
 * @param {Function} options.getMetricIndex
 * @param {Function} options.getItemId
 * @param {Function} options.getRunId
 * @param {'maximize'|'minimize'|null} [options.direction] - Declared direction;
 *   passes follow it (omitted = maximize, for older callers)
 * @param {boolean} [options.isBoolean]
 * @returns {Object}
 */
function calculateGroupedCohortComparison(options) {
  const {
    runsData,
    leftRunIds,
    rightRunIds,
    threshold,
    getMetricIndex,
    getItemId,
    getRunId,
    metricName,
  } = options || {};
  const direction = options?.direction === undefined ? 'maximize' : options.direction;
  const isBoolean = options?.isBoolean === undefined ? Number(threshold) >= 0.9999 : !!options.isBoolean;
  const passesAt = value => metricPasses(value, threshold, direction, isBoolean) === true;
  const leftOut = errorsLeftOut(direction);

  const bucketKeys = ['a_sweeps_b', 'b_sweeps_a', 'both_pass', 'both_fail'];
  const result = {
    eligibleItems: 0,
    leftRunCount: Array.isArray(leftRunIds) ? leftRunIds.length : 0,
    rightRunCount: Array.isArray(rightRunIds) ? rightRunIds.length : 0,
    k: Array.isArray(leftRunIds) ? leftRunIds.length : 0,
    left: {
      passAtK: 0,
      passHatK: 0,
      avgAtK: null,
      consistency: null,
      reliability: null,
      avgAttempts: 0,
    },
    right: {
      passAtK: 0,
      passHatK: 0,
      avgAtK: null,
      consistency: null,
      reliability: null,
      avgAttempts: 0,
    },
    deltas: {
      passAtK: 0,
      passHatK: 0,
      avgAtK: null,
      consistency: 0,
      reliability: 0,
    },
    summary: {
      improvedCount: 0,
      regressedCount: 0,
      unchangedCount: 0,
      avgAttemptsDelta: 0,
    },
    items: [],
    buckets: bucketKeys.reduce((acc, key) => {
      acc[key] = { count: 0, percentage: 0, itemIds: [] };
      return acc;
    }, {}),
  };

  if (!Array.isArray(runsData) || !runsData.length) return result;
  if (!Array.isArray(leftRunIds) || !leftRunIds.length) return result;
  if (!Array.isArray(rightRunIds) || !rightRunIds.length) return result;
  if (typeof getMetricIndex !== 'function' || typeof getItemId !== 'function' || typeof getRunId !== 'function') {
    return result;
  }

  const runMap = new Map();
  runsData.forEach((runData) => {
    const runId = getRunId(runData);
    if (runId !== undefined && runId !== null && !runMap.has(runId)) {
      runMap.set(runId, runData);
    }
  });

  const leftRuns = leftRunIds.map(runId => runMap.get(runId)).filter(Boolean);
  const rightRuns = rightRunIds.map(runId => runMap.get(runId)).filter(Boolean);
  if (leftRuns.length !== leftRunIds.length || rightRuns.length !== rightRunIds.length) {
    return result;
  }

  // Cohort size counts passes, not runs: a samples=9 repeat run contributes
  // nine entries per item once its per-pass scores are exploded below.
  const sideSampleCount = runs => runs.reduce(
    (sum, runData) => sum + Math.max(1, Number(runData?.run?.samples || 1)), 0,
  );
  result.leftRunCount = sideSampleCount(leftRuns);
  result.rightRunCount = sideSampleCount(rightRuns);
  result.k = result.leftRunCount;

  const selectedRuns = [...leftRuns, ...rightRuns];
  const itemIds = new Set();
  const rowIndexes = new Map();
  selectedRuns.forEach((runData) => {
    const rows = runData?.snapshot?.rows || [];
    rowIndexes.set(runData, indexRowsById(rows, getItemId));
    rows.forEach((row) => {
      const itemId = getItemId(row);
      if (itemId !== undefined && itemId !== null && itemId !== '') itemIds.add(itemId);
    });
  });

  function makeAggregateState() {
    return {
      passAtKCount: 0,
      passHatKCount: 0,
      totalConsistencySum: 0,
      itemsWithMultipleRuns: 0,
      totalReliabilitySum: 0,
      itemsWithAtLeastOnePass: 0,
      totalScoreSum: 0,
      totalScoreCount: 0,
      totalAttemptsSum: 0,
      totalAttemptsCount: 0,
    };
  }

  function finalizeAggregateState(agg) {
    return {
      passAtK: result.eligibleItems > 0 ? agg.passAtKCount / result.eligibleItems : 0,
      passHatK: result.eligibleItems > 0 ? agg.passHatKCount / result.eligibleItems : 0,
      // No score on this side (every entry errored on a lower-is-better
      // metric): no average, not 0, and so no average delta.
      avgAtK: agg.totalScoreCount > 0 ? agg.totalScoreSum / agg.totalScoreCount : null,
      consistency: agg.itemsWithMultipleRuns > 0 ? agg.totalConsistencySum / agg.itemsWithMultipleRuns : null,
      reliability: agg.itemsWithAtLeastOnePass > 0 ? agg.totalReliabilitySum / agg.itemsWithAtLeastOnePass : null,
      avgAttempts: agg.totalAttemptsCount > 0 ? agg.totalAttemptsSum / agg.totalAttemptsCount : 0,
    };
  }

  // ``scores`` holds the values that enter averages; ``passes`` holds one
  // verdict per entry (run, or pass of a repeat run), errored entries
  // included. When lower is better an errored entry has no score and fails.
  function collectGroupValues(groupRuns, itemId) {
    const scores = [];
    const passes = [];
    const attempts = [];
    const rowList = [];
    for (const runData of groupRuns) {
      const row = rowIndexes.get(runData).get(itemId);
      if (!row) return null;
      const metricIdx = getMetricIndex(runData);
      if (metricIdx < 0) return null;
      const attempt = Math.max(1, Number(row?.retry_count || 0) + 1);
      // Repeat runs carry per-pass scores; each pass joins the cohort as its
      // own entry so pass@k / noise math sees all of them, not the reduced
      // mean. Falls back to the single reduced score when unavailable.
      const perPass = metricName && row?.pass_scores ? row.pass_scores[metricName] : null;
      const passOutcomes = leftOut && Array.isArray(perPass)
        ? (repeatPassOutcomes(row, metricName)
          || perPass.map(raw => ({ value: parseScoreValue(raw), scorerError: false, taskError: false })))
        : null;
      if (passOutcomes && passOutcomes.some(pass => pass.value !== null || pass.scorerError || pass.taskError)) {
        passOutcomes.forEach((pass) => {
          if (pass.scorerError || pass.taskError) {
            passes.push(false);
          } else if (pass.value !== null) {
            scores.push(pass.value);
            passes.push(passesAt(pass.value));
          } else {
            return;
          }
          attempts.push(attempt);
        });
        rowList.push(row);
        continue;
      }
      const cleanPasses = Array.isArray(perPass)
        ? perPass.map(Number).filter(value => Number.isFinite(value))
        : [];
      if (cleanPasses.length) {
        cleanPasses.forEach((value) => {
          scores.push(value);
          passes.push(passesAt(value));
          attempts.push(attempt);
        });
        rowList.push(row);
        continue;
      }
      const outcome = getRowScore(row, metricIdx, metricName, direction);
      if (outcome.score === null && !outcome.isError) return null;
      if (outcome.score !== null) scores.push(outcome.score);
      passes.push(rowMetricPasses(outcome, threshold, direction, isBoolean) === true);
      attempts.push(attempt);
      rowList.push(row);
    }
    return { scores, passes, attempts, rows: rowList };
  }

  function updateAggregateState(agg, groupValues) {
    const numCorrect = groupValues.passes.filter(Boolean).length;
    const numScores = groupValues.passes.length;

    agg.totalScoreSum += groupValues.scores.reduce((sum, score) => sum + score, 0);
    agg.totalScoreCount += groupValues.scores.length;
    agg.totalAttemptsSum += groupValues.attempts.reduce((sum, attempt) => sum + attempt, 0);
    agg.totalAttemptsCount += groupValues.attempts.length;

    if (numCorrect > 0) agg.passAtKCount += 1;
    if (numCorrect === numScores && numScores > 0) agg.passHatKCount += 1;
    if (numScores > 1) {
      const numFail = numScores - numCorrect;
      const maxAgreement = Math.max(numCorrect, numFail);
      agg.totalConsistencySum += (2 * maxAgreement / numScores) - 1;
      agg.itemsWithMultipleRuns += 1;
      if (numCorrect > 0) {
        agg.totalReliabilitySum += numCorrect / numScores;
        agg.itemsWithAtLeastOnePass += 1;
      }
    }
  }

  const leftAgg = makeAggregateState();
  const rightAgg = makeAggregateState();
  let totalAttemptsDelta = 0;

  itemIds.forEach((itemId) => {
    const leftValues = collectGroupValues(leftRuns, itemId);
    if (!leftValues || leftValues.passes.length < leftRuns.length) return;
    const rightValues = collectGroupValues(rightRuns, itemId);
    if (!rightValues || rightValues.passes.length < rightRuns.length) return;

    result.eligibleItems += 1;
    updateAggregateState(leftAgg, leftValues);
    updateAggregateState(rightAgg, rightValues);

    const leftPassCount = leftValues.passes.filter(Boolean).length;
    const rightPassCount = rightValues.passes.filter(Boolean).length;
    const move = rightPassCount - leftPassCount;

    if (move > 0) result.summary.improvedCount += 1;
    else if (move < 0) result.summary.regressedCount += 1;
    else result.summary.unchangedCount += 1;

    const leftAvgAttempts = leftValues.attempts.length
      ? leftValues.attempts.reduce((sum, attempt) => sum + attempt, 0) / leftValues.attempts.length
      : 0;
    const rightAvgAttempts = rightValues.attempts.length
      ? rightValues.attempts.reduce((sum, attempt) => sum + attempt, 0) / rightValues.attempts.length
      : 0;
    totalAttemptsDelta += rightAvgAttempts - leftAvgAttempts;

    const representativeRow = leftValues.rows.find(Boolean) || rightValues.rows.find(Boolean) || null;
    result.items.push({
      itemId,
      rawItemId: representativeRow?.item_id || '',
      metadata: representativeRow?.item_metadata || {},
      leftScores: [...leftValues.scores],
      rightScores: [...rightValues.scores],
      leftPasses: leftValues.passes,
      rightPasses: rightValues.passes,
      leftAttempts: [...leftValues.attempts],
      rightAttempts: [...rightValues.attempts],
      leftPassCount,
      rightPassCount,
      leftAvgAttempts,
      rightAvgAttempts,
      move,
      bucketKey: null,
    });

    const leftAllPass = leftValues.passes.every(Boolean);
    const leftAllFail = leftValues.passes.every(value => !value);
    const rightAllPass = rightValues.passes.every(Boolean);
    const rightAllFail = rightValues.passes.every(value => !value);

    let bucketKey = null;
    if (leftAllPass && rightAllFail) bucketKey = 'a_sweeps_b';
    else if (leftAllFail && rightAllPass) bucketKey = 'b_sweeps_a';
    else if (leftAllPass && rightAllPass) bucketKey = 'both_pass';
    else if (leftAllFail && rightAllFail) bucketKey = 'both_fail';

    if (!bucketKey) return;
    result.items[result.items.length - 1].bucketKey = bucketKey;
    result.buckets[bucketKey].count += 1;
    result.buckets[bucketKey].itemIds.push(itemId);
  });

  bucketKeys.forEach((key) => {
    result.buckets[key].percentage = result.eligibleItems > 0
      ? result.buckets[key].count / result.eligibleItems
      : 0;
  });

  result.left = finalizeAggregateState(leftAgg);
  result.right = finalizeAggregateState(rightAgg);
  result.deltas = {
    passAtK: result.right.passAtK - result.left.passAtK,
    passHatK: result.right.passHatK - result.left.passHatK,
    avgAtK: result.left.avgAtK === null || result.right.avgAtK === null
      ? null
      : result.right.avgAtK - result.left.avgAtK,
    consistency: (result.right.consistency ?? 0) - (result.left.consistency ?? 0),
    reliability: (result.right.reliability ?? 0) - (result.left.reliability ?? 0),
  };
  result.summary.avgAttemptsDelta = result.eligibleItems > 0 ? totalAttemptsDelta / result.eligibleItems : 0;
  result.items.sort((a, b) => {
    if (b.move !== a.move) return b.move - a.move;
    if (b.rightPassCount !== a.rightPassCount) return b.rightPassCount - a.rightPassCount;
    if (a.leftPassCount !== b.leftPassCount) return a.leftPassCount - b.leftPassCount;
    return String(a.itemId || a.rawItemId).localeCompare(String(b.itemId || b.rawItemId));
  });

  return result;
}

/**
 * Format a decimal as a percentage string
 * @param {number} value - Value between 0 and 1
 * @param {number} [decimals=1] - Number of decimal places
 * @returns {string} Formatted percentage
 */
function formatPercent(value, decimals = 1) {
  if (value === undefined || value === null || isNaN(value)) return '—';
  return (value * 100).toFixed(decimals) + '%';
}

/**
 * Format latency in human-readable form
 * @param {number} ms - Latency in milliseconds
 * @returns {string} Formatted latency string
 */
function formatLatency(ms) {
  if (!ms || ms <= 0) return '—';
  if (ms >= 60000) {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
  } else if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  } else {
    return `${ms.toFixed(0)}ms`;
  }
}

/**
 * Get CSS class for score coloring
 * @param {number} score - Score between 0 and 1
 * @returns {string} CSS class name
 */
function getScoreColorClass(score) {
  if (score >= 0.9) return 'score-5';
  if (score >= 0.75) return 'score-4';
  if (score >= 0.6) return 'score-3';
  if (score >= 0.4) return 'score-2';
  return 'score-1';
}

/**
 * Generate tooltip definitions for aggregate metrics
 * @param {number} K - Number of runs
 * @param {boolean} isBoolean - Whether metric is boolean (0/1)
 * @param {number} threshold - Threshold percentage (0-100)
 * @param {'maximize'|'minimize'|null} [direction='maximize'] - Declared
 *   direction (metricDirection). Lower is better passes at or below the
 *   threshold, and a boolean's best score is 0%. Same wording as the Models
 *   and Compare tooltips.
 * @returns {Object} Tooltip definitions
 */
function getMetricTooltips(K, isBoolean, threshold, direction = 'maximize') {
  const lowerIsBetter = direction === 'minimize';
  const passRule = lowerIsBetter ? `≤${threshold}%` : `≥${threshold}%`;
  const perfectScore = lowerIsBetter ? 'the best score (0%)' : 'a perfect score (100%)';

  return {
    passAtK: isBoolean
      ? `Percentage of items where at least one of the ${K} runs achieved ${perfectScore}.`
      : `Percentage of items where at least one of the ${K} runs scored ${passRule}.`,
    passHatK: isBoolean
      ? `Percentage of items where all ${K} runs achieved ${perfectScore}.`
      : `Percentage of items where all ${K} runs scored ${passRule}.`,
    maxAtK: `Average of the best score across all ${K} runs for each item${lowerIsBetter ? ' (the lowest, since lower is better)' : ''}.`,
    consistency: `Measures how often runs agree on pass/fail across ${K} runs. 100% = all runs agree, 0% = 50/50 split.`,
    reliability: `When an item CAN be solved, how often is it? Only includes items with at least one passing run.`,
    failedCount: lowerIsBetter
      ? `Item evaluations that returned a task or scorer error, across all passes of the selected runs. Lower is better for this metric, so errors are left out of its scores and count as fails.`
      : `Item evaluations that returned a task or scorer error, across all passes of the selected runs. Errors are scored as 0%.`,
    avgScore: `The mean score across all items and all runs.`,
    avgLatency: `The mean response time across all items and all runs.`,
    medianLatency: `The median response time across all items and all runs. Less sensitive to outliers than the mean.`
  };
}

/**
 * Detect the type of a metric from its actual values across rows.
 *
 * Types:
 *   'boolean'  — all values are exactly 0 or 1  (display as %)
 *   'score'    — all values in [0, 1] range      (display as %)
 *   'numeric'  — any value > 1 or < 0            (display as raw number)
 *
 * @param {Array} rows  - Snapshot rows
 * @param {number} metricIdx - Index in metric_values
 * @returns {'boolean'|'score'|'numeric'}
 */
function detectMetricType(rows, metricIdx) {
  let hasNonBinary = false;
  let hasOutOfRange = false;
  let count = 0;

  for (const row of rows) {
    const { score } = getRowScore(row, metricIdx);
    if (score === null) continue;
    count++;
    if (score !== 0 && score !== 1) hasNonBinary = true;
    if (score > 1 || score < 0) { hasOutOfRange = true; break; }
  }

  if (count === 0) return 'score';
  if (hasOutOfRange) return 'numeric';
  if (!hasNonBinary) return 'boolean';
  return 'score';
}

/**
 * Detect metric type from a pre-computed average value.
 * Used when only summary data is available (e.g. dashboard list).
 * @param {number} avgValue
 * @returns {'score'|'numeric'}
 */
function detectMetricTypeFromAvg(avgValue) {
  if (avgValue === null || avgValue === undefined || isNaN(avgValue)) return 'score';
  if (avgValue > 1 || avgValue < 0) return 'numeric';
  return 'score';
}

/** Map an authoritative API metric spec to the dashboard's presentation type. */
function metricTypeFromSpec(spec, fallbackValue) {
  const scoreType = spec && spec.score_type;
  if (scoreType === 'boolean') return 'boolean';
  if (scoreType === 'percentage') return 'score';
  if (scoreType === 'count' || scoreType === 'number') return 'numeric';
  return detectMetricTypeFromAvg(fallbackValue);
}

/** Format a single, unreduced metric observation. */
function formatMetricObservation(value, metricType, spec) {
  if (value === undefined || value === null || isNaN(value)) return '\u2014';
  if (metricType === 'boolean') return Number(value) === 1 ? 'True' : 'False';
  const precision = spec && Number.isInteger(spec.precision) ? spec.precision : undefined;
  const formatted = formatMetricValue(value, metricType, precision);
  return spec && spec.unit && metricType === 'numeric' ? `${formatted} ${spec.unit}` : formatted;
}

/**
 * Format a metric value according to its type.
 * @param {number} value
 * @param {'boolean'|'score'|'numeric'} metricType
 * @param {number} [decimals=1]
 * @returns {string}
 */
function formatMetricValue(value, metricType, decimals) {
  if (value === undefined || value === null || isNaN(value)) return '\u2014';
  if (metricType === 'numeric') {
    return formatNumericValue(value);
  }
  return formatPercent(value, decimals);
}

function pickAdaptiveDecimals(value, peerValues, formatWithDecimals, defaultDecimals = 1, maxDecimals = 3) {
  const peers = Array.isArray(peerValues)
    ? peerValues.filter(peer => peer !== undefined && peer !== null && !isNaN(peer) && peer !== value)
    : [];
  if (peers.length === 0) return defaultDecimals;

  for (let decimals = defaultDecimals; decimals <= maxDecimals; decimals++) {
    const formatted = formatWithDecimals(value, decimals);
    const hasCollision = peers.some(peer => formatWithDecimals(peer, decimals) === formatted);
    if (!hasCollision) return decimals;
  }

  return maxDecimals;
}

function formatMetricValueSmart(value, metricType, peerValues, defaultDecimals = 1, maxDecimals = 3) {
  if (value === undefined || value === null || isNaN(value)) return '\u2014';
  if (metricType === 'numeric') {
    const decimals = pickAdaptiveDecimals(
      value,
      peerValues,
      (candidate, precision) => formatNumericValue(candidate, precision),
      Number.isInteger(value) ? 0 : defaultDecimals,
      maxDecimals,
    );
    return formatNumericValue(value, decimals);
  }

  const decimals = pickAdaptiveDecimals(
    value,
    peerValues,
    (candidate, precision) => formatPercent(candidate, precision),
    defaultDecimals,
    maxDecimals,
  );
  return formatPercent(value, decimals);
}

/**
 * Format a raw numeric value with appropriate precision and abbreviation.
 * @param {number} value
 * @returns {string}
 */
function formatNumericValue(value, decimals = 1) {
  if (value === undefined || value === null || isNaN(value)) return '\u2014';
  const abs = Math.abs(value);
  if (abs >= 1000000) return (value / 1000000).toFixed(1) + 'M';
  if (abs >= 10000) return (value / 1000).toFixed(1) + 'K';
  if (abs >= 1000) return value.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (Number.isInteger(value)) return value.toString();
  return value.toFixed(decimals);
}

/* ── Metric semantics: direction and default metric (C008) ─────────────────
 * One definition for every page. A metric's direction comes from its run
 * spec. A metric that declares none is shown neutrally: no good/bad colors,
 * no pass/fail verdict, no best/winner and no improved/regressed label.
 */

/**
 * The direction a metric's run spec declares.
 * Schema 1 specs (SDKs before 2026-09) sent "maximize" as a default for plain
 * callables (score_type "legacy"); that default is not a declaration. Schema 2
 * specs send no direction unless one is declared.
 * Same rule as services/metric_semantics.py (declared_direction).
 * @param {Object|null} spec
 * @returns {'maximize'|'minimize'|null}
 */
function metricDirection(spec) {
  if (!spec || typeof spec !== 'object') return null;
  const direction = String(spec.direction || '').trim().toLowerCase();
  if (direction === 'minimize') return 'minimize';
  if (direction !== 'maximize') return null;
  const schemaVersion = Number(spec.schema_version) || 1;
  return spec.score_type === 'legacy' && schemaVersion < 2 ? null : 'maximize';
}

/** Short explanation of a direction, for titles and hints. */
function metricDirectionLabel(direction) {
  if (direction === 'maximize') return 'Higher is better';
  if (direction === 'minimize') return 'Lower is better';
  return 'No direction declared: shown without good/bad colors or verdicts';
}

/**
 * The metric views open on: the declared primary metric, else the first
 * metric by spec position (run.metrics order), never alphabetical order.
 * @param {string[]} metricNames - Names in spec position order
 * @param {Object} specs - metric name -> run spec
 */
function defaultMetricName(metricNames, specs) {
  const names = Array.isArray(metricNames) ? metricNames.filter(Boolean) : [];
  const declared = names.find(name => specs && specs[name] && specs[name].primary === true);
  return declared || names[0] || null;
}

/** Merge metric name lists keeping first-seen (spec position) order. */
function mergeMetricNames(lists) {
  const merged = [];
  const seen = new Set();
  for (const list of lists || []) {
    for (const name of Array.isArray(list) ? list : []) {
      if (name && !seen.has(name)) { seen.add(name); merged.push(name); }
    }
  }
  return merged;
}

/**
 * Compare two values by direction: > 0 when ``a`` is better, < 0 when worse,
 * 0 when equal, not comparable, or the direction is not declared.
 */
function compareMetricValues(a, b, direction) {
  const x = Number(a), y = Number(b);
  if (a === null || a === undefined || b === null || b === undefined) return 0;
  if (!Number.isFinite(x) || !Number.isFinite(y) || x === y) return 0;
  if (direction === 'maximize') return x > y ? 1 : -1;
  if (direction === 'minimize') return x < y ? 1 : -1;
  return 0;
}

/** Indexes holding the best finite value; [] when the direction is not declared. */
function bestMetricIndexes(values, direction) {
  if (direction !== 'maximize' && direction !== 'minimize') return [];
  let best = null;
  (values || []).forEach(value => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return;
    if (best === null || compareMetricValues(value, best, direction) > 0) best = Number(value);
  });
  if (best === null) return [];
  const indexes = [];
  (values || []).forEach((value, index) => {
    if (value !== null && value !== undefined && Number(value) === best) indexes.push(index);
  });
  return indexes;
}

/**
 * Default pass threshold: the spec's, else 80% (maximize) or 20% (minimize).
 * ``direction`` overrides the spec's when the caller resolved it already.
 */
function defaultPassThreshold(spec, direction) {
  const declared = spec && spec.pass_threshold;
  if (declared !== null && declared !== undefined && Number.isFinite(Number(declared))) return Number(declared);
  const resolved = direction === undefined ? metricDirection(spec) : direction;
  return resolved === 'minimize' ? 0.2 : 0.8;
}

/**
 * Pass/fail verdict for one value: true, false, or null when the metric
 * declares no direction. Booleans pass on True (maximize) or False
 * (minimize); a reduced repeat-run boolean passes only when every pass did.
 */
function metricPasses(value, threshold, direction, isBoolean = false) {
  if (direction !== 'maximize' && direction !== 'minimize') return null;
  if (value === null || value === undefined) return null;
  const v = Number(value);
  if (!Number.isFinite(v)) return null;
  if (isBoolean) return direction === 'minimize' ? v <= 0.0001 : v >= 0.9999;
  const t = Number(threshold);
  return direction === 'minimize' ? v <= t : v >= t;
}

/** "≥ 80%" / "≤ 20%" for pass-threshold labels. */
function passThresholdLabel(threshold, direction) {
  const pct = Math.round(Number(threshold) * 100);
  return (direction === 'minimize' ? '≤' : '≥') + pct + '%';
}

/**
 * Verdict for a change beyond noise: 'improved', 'regressed', 'within_noise',
 * or 'changed' when the metric declares no direction (no better/worse).
 */
function metricDeltaVerdict(delta, noise, direction) {
  const d = Number(delta);
  const n = Math.max(0, Number(noise) || 0);
  if (!Number.isFinite(d) || Math.abs(d) <= n) return 'within_noise';
  if (direction === 'maximize') return d > 0 ? 'improved' : 'regressed';
  if (direction === 'minimize') return d < 0 ? 'improved' : 'regressed';
  return 'changed';
}

/**
 * Get CSS color class for a metric value, respecting its type and direction.
 * Numeric metrics get no color class (they have no intrinsic good/bad scale),
 * and neither do metrics that declare no direction. Lower-is-better scores
 * use the ramp inverted, so a low error rate reads as good.
 * @param {number} value
 * @param {'boolean'|'score'|'numeric'} metricType
 * @param {'maximize'|'minimize'|null} direction
 * @returns {string}
 */
function getMetricColorClass(value, metricType, direction) {
  if (metricType === 'numeric') return '';
  if (direction === 'maximize') return getScoreColorClass(value);
  if (direction === 'minimize') return getScoreColorClass(1 - Number(value));
  return '';
}

// Export for use in other modules (if using ES modules)
if (typeof window !== 'undefined') {
  window.QymMetrics = {
    // Core error handling - USE THESE for consistent error treatment
    isTaskErrorRow,
    isRepeatAggregateRow,
    isItemTaskError,
    isNotReceivedRow,
    hasTaskError,
    isMetricErrorMeta,
    metricMetaDisplayKey,
    isInternalMetaKey,
    hasMetricError,
    isErrorRow,
    errorsLeftOut,
    isTaskErrorPass,
    isItemEdit,
    isReviewedPassSlice,
    repeatPassOutcomes,
    getRowScore,
    rowMetricErrorCounts,
    rowMetricPasses,
    metricErrorRuleLabel,
    scoreWithoutMetricErrors,
    parseScoreValue,
    parseMetricScoreInput,
    indexRowsById,
    // Metrics calculation
    calculateItemLevelMetrics,
    calculateGroupedOutcomeBuckets,
    calculateGroupedCohortComparison,
    calculateMedian,
    // Type detection
    detectMetricType,
    detectMetricTypeFromAvg,
    metricTypeFromSpec,
    // Formatting utilities
    formatPercent,
    formatMetricValue,
    formatMetricObservation,
    formatMetricValueSmart,
    formatNumericValue,
    formatLatency,
    getScoreColorClass,
    getMetricColorClass,
    // Metric semantics (direction, default metric)
    metricDirection,
    metricDirectionLabel,
    defaultMetricName,
    mergeMetricNames,
    compareMetricValues,
    bestMetricIndexes,
    defaultPassThreshold,
    metricPasses,
    passThresholdLabel,
    metricDeltaVerdict,
    getMetricTooltips
  };
}
