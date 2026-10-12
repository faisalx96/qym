/**
 * Why an item failed a metric (C065): the reason shown in the run page's
 * item list for a failing row of the displayed metric.
 *
 * The first source that exists wins, in this order:
 *   1. task error       the item's own task failed (item.error)
 *   2. scorer error     the metric raised (meta.status error/failed/timeout)
 *   3. reason / error   meta.reason, or meta.error without an error status
 *                       (older metrics stored verdict reasons as "error")
 *   4. explanation      meta.explanation
 *   5. label            meta.label
 *   6. none recorded    "Scored X, pass needs Y"
 * Custom metadata keys are never parsed.
 *
 * shell.js re-runs page scripts on in-app navigation: no top-level
 * const/let/class.
 */
(function () {
  'use strict';

  var ORDER = [
    { source: 'task error', detail: 'The item’s task failed (its error message)' },
    { source: 'scorer error', detail: 'The metric raised: status error, failed or timeout' },
    { source: 'reason', detail: 'meta.reason, or meta.error without an error status' },
    { source: 'explanation', detail: 'meta.explanation' },
    { source: 'label', detail: 'meta.label' },
    { source: 'no reason recorded', detail: 'The score and what a pass needs' },
  ];

  function text(value) {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    try { return JSON.stringify(value); } catch (err) { return ''; }
  }

  function scorerErrorStatus(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return '';
    var status = String(meta.status || '').trim().toLowerCase();
    return status === 'error' || status === 'failed' || status === 'timeout' ? status : '';
  }

  /**
   * @param {Object} input
   * @param {string|boolean} [input.taskError] the task's error text (true: failed, no text)
   * @param {string|boolean} [input.scorerError] a scorer error text found outside meta
   *   (a repeat row's errored pass); meta.status is checked here too
   * @param {Object} [input.meta] the metric's metadata for this row
   * @param {string} [input.score] the displayed score ("False", "42.0%")
   * @param {string} [input.need] what a pass needs ("True", "≥80%")
   * @returns {{text: string, source: string, kind: string}}
   */
  function pick(input) {
    var opts = input || {};
    var meta = opts.meta && typeof opts.meta === 'object' && !Array.isArray(opts.meta) ? opts.meta : {};
    if (opts.taskError) {
      return {
        text: text(opts.taskError === true ? '' : opts.taskError) || 'Task execution failed',
        source: 'task error',
        kind: 'task-error',
      };
    }
    var status = scorerErrorStatus(meta);
    if (status || opts.scorerError) {
      return {
        text: text(meta.error) || text(opts.scorerError === true ? '' : opts.scorerError) || 'The scorer ended with status ' + (status || 'error'),
        source: 'scorer error',
        kind: 'scorer-error',
      };
    }
    var reason = text(meta.reason);
    if (reason) return { text: reason, source: 'reason', kind: 'reason' };
    var verdict = text(meta.error);
    if (verdict) return { text: verdict, source: 'reason', kind: 'verdict-error' };
    var explanation = text(meta.explanation);
    if (explanation) return { text: explanation, source: 'explanation', kind: 'explanation' };
    var label = text(meta.label);
    if (label) return { text: label, source: 'label', kind: 'label' };
    var scored = opts.score !== undefined && opts.score !== null && opts.score !== '' ? String(opts.score) : '—';
    return {
      text: 'Scored ' + scored + (opts.need ? ', pass needs ' + opts.need : ''),
      source: 'no reason recorded',
      kind: 'none',
    };
  }

  /**
   * Whether the server may hold a better reason than the row's index form:
   * the index drops explanations and long reasons, so a row that would fall
   * through to explanation/label/none asks when its metric records them.
   */
  function needsServerReason(picked, metaKeys) {
    if (!picked || picked.kind === 'task-error' || picked.kind === 'scorer-error' || picked.kind === 'reason') return false;
    var keys = Array.isArray(metaKeys) ? metaKeys : [];
    // meta.reason outranks everything below it, including meta.error.
    if (keys.indexOf('reason') >= 0) return true;
    if (picked.kind === 'verdict-error' || picked.kind === 'explanation') return false;
    return keys.indexOf('explanation') >= 0;
  }

  window.QymItemReasons = {
    ORDER: ORDER,
    pick: pick,
    needsServerReason: needsServerReason,
  };
})();
