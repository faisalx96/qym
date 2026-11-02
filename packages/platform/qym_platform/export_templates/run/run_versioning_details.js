/*
 * Run page "Versioning details" panel (migration 0084).
 *
 * The run detail API sends `run.versioning_details`: the free-form JSON object
 * the run's creator supplied (EvaluatorConfig.versioning_details, the CLI's
 * --versioning-detail) merged with the launching experiment's keys. One
 * key/value row per key, sorted by key; objects and arrays show as compact JSON.
 * Empty (and hidden by CSS) when the run has none.
 *
 * All values are escaped before they reach innerHTML.
 */
(() => {
  'use strict';

  function esc(value) {
    return QymSafe.escapeHtml(value == null ? '' : String(value));
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function display(value) {
    if (value == null) return '';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }

  function rows(details) {
    return Object.keys(details)
      .filter((key) => details[key] != null)
      .sort((a, b) => a.localeCompare(b))
      .map((key) => [key, display(details[key])]);
  }

  function panelHtml(details) {
    const entries = rows(details);
    if (!entries.length) return '';
    return '<section class="rvd-panel" aria-labelledby="rvd-title">' +
      '<h3 class="section-title rvd-title" id="rvd-title">Versioning details</h3>' +
      '<p class="rvd-desc">Keys set by whoever created this run, or by the experiment that launched it.</p>' +
      '<dl class="rvd-list">' + entries.map(([key, value]) =>
        '<div class="rvd-row">' +
          '<dt class="rvd-key" title="' + esc(key) + '">' + esc(key) + '</dt>' +
          '<dd class="rvd-value"' + QymSafe.textDirAttrs(value) + '>' + esc(value) + '</dd>' +
        '</div>'
      ).join('') + '</dl>' +
    '</section>';
  }

  /** Render into `container`; empties it when the run has no versioning details. */
  function render(container, run) {
    if (!container) return;
    const details = run && run.versioning_details;
    container.innerHTML = isObject(details) ? panelHtml(details) : '';
  }

  window.QymRunVersioningDetails = { render, panelHtml, rows };
})();
