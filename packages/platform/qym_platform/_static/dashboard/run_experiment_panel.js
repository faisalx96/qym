/*
 * Run page Experiment panel (plan §11 / §12.3, issue #26).
 *
 * Rendered only for official runs: the run detail API sends `run.experiment`
 * (null for local runs). The panel works from run_metadata alone and shows the
 * job-row enrichment (remote job id, service result, versioning, names) when the
 * API found the linked job.
 *
 * "Rerun with this config" opens the launch form with a clone prefill:
 *   /projects/{slug}/experiments?new=1&clone=<experiment_id>&job=<job_id>
 * `job` is present when the linked job row exists, so the form clones only this
 * run's combination (POST …/experiments/{id}/clone?job_id=<job_id>); without it the
 * whole experiment is cloned.
 *
 * "Promote to default preset" (#39, managers only: `panel.can_promote`) opens the official
 * defaults editor on the project settings page, prefilled from this run's config:
 *   /projects/{slug}/settings?tab=environments&env=<env_id>&promote=run&id=<run_id>
 * Only ids travel in the URL; the editor never publishes until the manager does.
 *
 * All API values are escaped before they reach innerHTML.
 */
(() => {
  'use strict';

  const BASE_LABELS = {
    official: 'Default preset',
    saved: 'Saved preset',
    best_run: 'Best run',
    blank: 'Blank',
    clone: 'Clone',
  };
  const STATUS_TONES = {
    SUCCEEDED: 'success', COMPLETED: 'success',
    RUNNING: 'info', SUBMITTED: 'info', SUBMITTING: 'info', QUEUED: 'neutral',
    FAILED: 'danger', TIMED_OUT: 'danger',
    CANCELLED: 'warning', CANCELLING: 'warning', BLOCKED: 'warning', PARTIAL: 'warning',
  };

  function esc(value) {
    return QymSafe.escapeHtml(value == null ? '' : String(value));
  }

  function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function display(value) {
    if (value == null) return '—';
    if (isObject(value)) {
      if (value.name) return value.model ? value.name + ' (' + value.model + ')' : String(value.name);
      if (isObject(value.temporary)) {
        const t = value.temporary;
        return (t.label || 'Temporary model') + (t.model ? ' (' + t.model + ')' : '');
      }
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) return JSON.stringify(value);
    return String(value);
  }

  function pointerLabel(pointer) {
    const parts = String(pointer).split('/').filter(Boolean);
    return parts.slice(-2).join('.') || String(pointer);
  }

  function rootPath() {
    return (window.__QYM_ROOT_PATH__ || '').replace(/\/$/, '');
  }

  function experimentsUrl(slug, params) {
    return rootPath() + '/projects/' + encodeURIComponent(slug) + '/experiments?' + params.toString();
  }

  /** The launch-form URL for "Rerun with this config" (null when unavailable). */
  function rerunUrl(panel, slug) {
    if (!panel || !slug || !panel.experiment_available || !panel.experiment_id) return null;
    const params = new URLSearchParams();
    params.set('new', '1');
    params.set('clone', String(panel.experiment_id));
    if (panel.job_available && panel.job_id) params.set('job', String(panel.job_id));
    return experimentsUrl(slug, params);
  }

  // Run statuses a promote accepts (completed; review may have moved them on).
  const PROMOTABLE_STATUSES = ['COMPLETED', 'SUBMITTED', 'APPROVED'];

  /** The settings-page editor link for "Promote to default preset" (null when not allowed). */
  function promoteUrl(panel, slug, runId) {
    if (!panel || !slug || !runId || !panel.can_promote || !panel.environment_id) return null;
    const params = new URLSearchParams();
    params.set('tab', 'environments');
    params.set('env', String(panel.environment_id));
    params.set('promote', 'run');
    params.set('id', String(runId));
    return rootPath() + '/projects/' + encodeURIComponent(slug) + '/settings?' + params.toString();
  }

  function experimentUrl(panel, slug) {
    if (!panel || !slug || !panel.experiment_available || !panel.experiment_id) return null;
    const params = new URLSearchParams();
    params.set('experiment', String(panel.experiment_id));
    return experimentsUrl(slug, params);
  }

  function statusBadge(status) {
    if (!status) return '—';
    const text = String(status).toUpperCase();
    const tone = STATUS_TONES[text] || 'neutral';
    return '<span class="qym-badge qym-badge--' + tone + '">' + esc(text.replace(/_/g, ' ')) + '</span>';
  }

  function baseSourceHtml(source) {
    if (!isObject(source) || !source.kind) return '—';
    const label = BASE_LABELS[source.kind] || String(source.kind);
    const ref = source.preset_version_id || source.preset_id || source.run_id || source.experiment_id || '';
    return esc(label) + (ref ? ' <span class="rxp-mono" title="' + esc(ref) + '">' + esc(String(ref).slice(0, 8)) + '</span>' : '');
  }

  function field(label, valueHtml, options) {
    const opts = options || {};
    return '<div class="rxp-field' + (opts.wide ? ' rxp-field--wide' : '') + '">' +
      '<dt class="rxp-label">' + esc(label) + '</dt>' +
      '<dd class="rxp-value' + (opts.mono ? ' rxp-mono' : '') + '"' + (opts.title ? ' title="' + esc(opts.title) + '"' : '') + '>' + valueHtml + '</dd>' +
    '</div>';
  }

  function tagList(entries, tagClass) {
    if (!entries.length) return '—';
    return '<span class="rxp-tags">' + entries.map(([key, value, title]) =>
      '<span class="qym-tag ' + tagClass + '" title="' + esc(title || key) + '">' +
        esc(key) + ' <span class="rxp-tag-value">' + esc(value) + '</span>' +
      '</span>'
    ).join('') + '</span>';
  }

  function panelHtml(panel, options) {
    const opts = options || {};
    const slug = opts.projectSlug || '';
    const rerun = opts.isExport ? null : rerunUrl(panel, slug);
    const openUrl = opts.isExport ? null : experimentUrl(panel, slug);
    const promote = opts.isExport ? null : promoteUrl(panel, slug, opts.runId);
    const promotable = PROMOTABLE_STATUSES.indexOf(String(opts.runStatus || '').toUpperCase()) >= 0;

    const experimentLabel = panel.experiment_name || (panel.experiment_id ? String(panel.experiment_id).slice(0, 8) : '—');
    const experimentHtml = openUrl
      ? '<a class="rxp-link" href="' + esc(openUrl) + '">' + esc(experimentLabel) + '</a>'
      : esc(experimentLabel);
    const environmentHtml = panel.environment_name
      ? esc(panel.environment_name)
      : (panel.environment_id ? '<span class="rxp-mono">' + esc(String(panel.environment_id).slice(0, 8)) + '</span>' : '—');
    const combo = panel.combo_index != null
      ? '#' + (Number(panel.combo_index) + 1) + (Number(panel.attempt) > 0 ? ' · retry ' + Number(panel.attempt) : '')
      : '—';

    const sweepEntries = Object.entries(panel.sweep || {}).map(([pointer, value]) => [pointerLabel(pointer), display(value), pointer]);
    const modelEntries = Object.entries(panel.slot_bindings || {})
      .filter(([, value]) => value != null)
      .map(([slot, value]) => [slot.replace(/^[^:]*:/, ''), display(value), slot]);
    const versionEntries = isObject(panel.remote_versioning)
      ? Object.entries(panel.remote_versioning).map(([key, value]) => [key, display(value), key])
      : [];

    const fields = [
      field('Experiment', experimentHtml),
      field('Environment', environmentHtml),
      field('Combination', esc(combo), { mono: true }),
      field('Base source', baseSourceHtml(panel.base_source)),
      field('Remote job id', esc(panel.remote_job_id || '—'), { mono: true, title: panel.remote_job_id || '' }),
      field('Job status', statusBadge(panel.job_status)),
      field('Schema hash', esc(panel.schema_hash ? String(panel.schema_hash).slice(0, 12) : '—'), { mono: true, title: panel.schema_hash || '' }),
      field('Versioning', tagList(versionEntries, 'qym-tag--version')),
      field('Swept params', tagList(sweepEntries, 'qym-tag--data'), { wide: true }),
      field('Models', tagList(modelEntries, 'qym-tag--data'), { wide: true }),
    ];
    if (panel.error) fields.push(field('Job error', esc(panel.error), { wide: true }));

    const note = !panel.job_available
      ? '<p class="rxp-note">The launch job is no longer available; showing the configuration stored on the run.</p>'
      : '';
    const result = panel.remote_result != null
      ? '<details class="rxp-result"' + (opts.resultOpen ? ' open' : '') + '>' +
          '<summary class="rxp-result-summary">Service result</summary>' +
          '<pre class="rxp-json">' + esc(JSON.stringify(panel.remote_result, null, 2)) + '</pre>' +
        '</details>'
      : '';

    let actions = '';
    if (!opts.isExport) {
      actions = '<div class="rxp-actions">' +
        (openUrl ? '<a class="qym-inline-action qym-inline-action--neutral" href="' + esc(openUrl) + '">Open experiment</a>' : '') +
        (rerun
          ? '<a class="qym-inline-action qym-inline-action--accent" id="rxp-rerun" href="' + esc(rerun) + '" title="Open the launch form prefilled with this run\'s configuration">Rerun with this config</a>'
          : '<button type="button" class="qym-inline-action qym-inline-action--accent" id="rxp-rerun" disabled title="The experiment no longer exists">Rerun with this config</button>') +
        (promote
          ? (promotable
            ? '<a class="qym-inline-action qym-inline-action--neutral" id="rxp-promote" href="' + esc(promote) + '" title="Open the default preset editor with this run\'s configuration, compared with the current version; nothing is published until you publish">Promote to default preset</a>'
            : '<button type="button" class="qym-inline-action qym-inline-action--neutral" id="rxp-promote" disabled title="Only completed runs can be promoted">Promote to default preset</button>')
          : '') +
      '</div>';
    }

    return '<section class="rxp-panel" aria-labelledby="rxp-title">' +
      '<div class="rxp-head">' +
        '<div class="rxp-heading">' +
          '<div class="rxp-title-row">' +
            '<h3 class="section-title rxp-title" id="rxp-title">Experiment</h3>' +
            '<span class="qym-tag qym-tag--accent">Official run</span>' +
          '</div>' +
          '<p class="rxp-desc">Launched by qym on a registered environment. Settings show this run\'s combination.</p>' +
        '</div>' +
        actions +
      '</div>' +
      note +
      '<dl class="rxp-grid">' + fields.join('') + '</dl>' +
      result +
    '</section>';
  }

  /** Render into `container`; empties it for local runs (no `run.experiment`). */
  function render(container, run, options) {
    if (!container) return;
    const panel = run && run.experiment;
    if (!isObject(panel) || panel.origin !== 'official') {
      container.innerHTML = '';
      return;
    }
    const previous = container.querySelector('details.rxp-result');
    const opts = Object.assign({}, options || {}, { resultOpen: !!(previous && previous.open) });
    if (!opts.projectSlug && run.project && run.project.slug) opts.projectSlug = run.project.slug;
    if (!opts.runId) opts.runId = run.run_id;
    if (!opts.runStatus) opts.runStatus = run.status;
    container.innerHTML = panelHtml(panel, opts);
  }

  window.QymRunExperimentPanel = { render, rerunUrl, promoteUrl, panelHtml };
})();
