/*
 * "Start from best run" in the launch form (plan §10.2 / §10.3, issue #38).
 *
 * experiment_launch.js creates one picker per form through its best-run hook:
 *
 *   window.QymLaunchBestRun.create(api) → picker
 *     picker.render(selectedRunId) → node: the scope prompt (dataset, version and one
 *                                   select per versioning_metadata key, then
 *                                   "Find best runs"), and once retrieved the metric
 *                                   selector, "include errored runs", the top-5
 *                                   table and the empty/other-version notes
 *     picker.load(envId, runId)   → Promise<{ runId, base } | { runId, error }
 *                                   | { runId: '', pending: true }>
 *                                   (runId '' takes the top-ranked run; pending
 *                                   until the user retrieves a scope)
 *     picker.info(base)           → base-status fields for st.baseInfo
 *     picker.header(info)         → "run abc12345 · accuracy 0.84 · agent v1.12 / kb 381"
 *     picker.status(info)         → nodes: drift warning and temporary-model prompts
 *
 * api: { el, tag, request, errorMessage, envPath(id, suffix),
 *        target() → { envId, ... }, onPick(runId), reuseTemporary(prompt), rerender() }
 *
 * Scope (plan §10.2): nothing is retrieved until the user chooses what to rank on and
 * clicks "Find best runs". Each of dataset, version and versioning left on "Any" is not
 * constrained, so leaving all of them ranks every run of the environment (global).
 *
 * APIs:
 *   GET /v1/projects/{pid}/eval-environments/{eid}/best-runs/scope
 *   GET /v1/projects/{pid}/eval-environments/{eid}/best-runs?dataset_id=&dataset_version_id=&versioning=key%3Dvalue&metric=&exclude_errored=
 *   GET /v1/projects/{pid}/eval-environments/{eid}/best-runs/{run_id}/base?metric=
 *
 * The base endpoint re-maps the run's qym_config onto the current schema, unbinds
 * temporary models (prompts) and connections that are gone (warnings), and reports
 * agent/KB drift against the environment's latest job. Nothing here holds a key.
 *
 * Security: nodes are built with api.el()/textContent only; no server string is
 * parsed as HTML.
 */
(function () {
  'use strict';
  if (window.QymLaunchBestRun) return;

  const LIMIT = 5;
  const REASONS = {
    custom_dataset: 'Runs on a custom dataset string are never ranked. Pick a project dataset to see best runs.',
    unknown_dataset_version: 'That dataset version or alias does not exist.',
    no_metric: 'No metric to rank by yet.',
    no_runs_on_version: 'No official run on this dataset version yet.',
    no_runs_in_scope: 'No official run matches this scope.',
    no_runs_for_metric: 'No official run in this scope has this metric.',
    all_excluded: 'Every run in this scope errored on more than 20% of its items. Include errored runs to see them.',
  };

  function shortId(id) {
    return String(id || '').slice(0, 8);
  }

  function formatScore(value) {
    if (typeof value !== 'number' || !isFinite(value)) return '—';
    return String(Number(value.toFixed(Math.abs(value) >= 100 ? 1 : 3)));
  }

  function formatAge(seconds) {
    if (typeof seconds !== 'number') return '—';
    if (seconds < 3600) return Math.max(1, Math.round(seconds / 60)) + 'm ago';
    if (seconds < 86400) return Math.round(seconds / 3600) + 'h ago';
    return Math.round(seconds / 86400) + 'd ago';
  }

  const VERSION_LABELS = { agent_version: 'agent', kb_version: 'kb' };

  /** "agent v1.12 / kb 381" (other keys follow as "key value"). */
  function versionText(versioning) {
    if (!versioning || typeof versioning !== 'object') return '';
    const keys = Object.keys(versioning).filter((k) => versioning[k] != null && typeof versioning[k] !== 'object');
    keys.sort((a, b) => (VERSION_LABELS[a] ? 0 : 1) - (VERSION_LABELS[b] ? 0 : 1) || (a < b ? -1 : 1));
    return keys.map((k) => (VERSION_LABELS[k] || k) + ' ' + String(versioning[k])).join(' / ');
  }

  /** "kb_version" → "KB version": short words read as acronyms. */
  function keyWords(key) {
    const words = String(key).replace(/[_-]+/g, ' ').trim().split(/\s+/).filter(Boolean)
      .map((word) => (word.length <= 2 ? word.toUpperCase() : word.toLowerCase()));
    return words.length ? words.join(' ') : String(key);
  }

  function runCount(n) {
    return n + ' run' + (n === 1 ? '' : 's');
  }

  function sweepText(params) {
    const sweep = params && params.sweep;
    if (!sweep || typeof sweep !== 'object') return '';
    return Object.keys(sweep).map((pointer) => {
      const key = String(pointer).split('/').pop();
      const value = sweep[pointer];
      const shown = value && typeof value === 'object'
        ? (value.name || value.model || (value.temporary && (value.temporary.label || value.temporary.model)) || 'object')
        : String(value);
      return key + '=' + shown;
    }).join(' ');
  }

  function create(api) {
    const el = api.el;
    const st = {
      key: '',
      promise: null,
      loading: false,
      error: '',
      data: null,
      metric: '', // '' = the environment's default metric
      includeErrored: false,
      waiting: false, // a re-render is queued for the list in flight
      // Scope prompt (§10.2): what the selects show, and what was retrieved.
      scopeEnv: '',
      scopePromise: null,
      options: null, // GET …/best-runs/scope
      optionsError: '',
      draft: { datasetId: '', versionId: '', versioning: {} }, // '' / {} = Any
      applied: null, // { envId, datasetId, versionId, versioning } after "Find best runs"
    };

    function appliedFor(envId) {
      return envId && st.applied && st.applied.envId === envId ? st.applied : null;
    }

    /** What the scope prompt offers on this environment (datasets, versions, versioning). */
    function fetchScope(envId) {
      if (!envId) return Promise.resolve(null);
      if (st.scopeEnv === envId && st.scopePromise) return st.scopePromise;
      st.scopeEnv = envId;
      st.options = null;
      st.optionsError = '';
      st.draft = { datasetId: '', versionId: '', versioning: {} };
      st.scopePromise = api.request(api.envPath(envId, '/best-runs/scope')).then((res) => {
        if (st.scopeEnv !== envId) return st.options;
        if (!res.ok) st.optionsError = api.errorMessage(res.data, 'Failed to load what can be ranked');
        else st.options = res.data || null;
        api.rerender();
        return st.options;
      });
      return st.scopePromise;
    }

    function query(applied) {
      const q = new URLSearchParams();
      if (applied.datasetId) q.set('dataset_id', applied.datasetId);
      if (applied.versionId) q.set('dataset_version_id', applied.versionId);
      Object.keys(applied.versioning).sort().forEach((key) => {
        q.append('versioning', key + '=' + applied.versioning[key]);
      });
      if (st.metric) q.set('metric', st.metric);
      if (st.includeErrored) q.set('exclude_errored', 'false');
      q.set('limit', String(LIMIT));
      return q.toString();
    }

    /** The ranked list for the retrieved scope (cached by key); none before "Find". */
    function fetchList(force) {
      const target = api.target();
      const applied = appliedFor(target.envId);
      if (!applied) {
        st.key = '';
        st.data = null;
        st.error = '';
        st.loading = false;
        st.promise = null;
        return Promise.resolve(null);
      }
      const key = JSON.stringify([applied, st.metric, st.includeErrored]);
      if (!force && key === st.key && st.promise) return st.promise;
      st.key = key;
      st.loading = true;
      st.error = '';
      st.promise = api.request(api.envPath(target.envId, '/best-runs?' + query(applied))).then((res) => {
        if (key !== st.key) return st.data;
        st.loading = false;
        if (!res.ok) {
          st.data = null;
          st.error = api.errorMessage(res.data, 'Failed to load the best runs');
        } else {
          st.data = res.data || null;
        }
        return st.data;
      });
      return st.promise;
    }

    function emptyMessage(target, data) {
      if (!target.envId) return 'Pick an environment first.';
      if (st.error) return st.error;
      return (data && REASONS[data.reason]) || 'No official run to start from.';
    }

    async function load(envId, runId) {
      const target = api.target();
      if (!appliedFor(envId)) {
        fetchScope(envId);
        return { runId: '', pending: true };
      }
      const data = await fetchList(false);
      let id = runId || '';
      if (!id) {
        const top = data && data.runs && data.runs[0];
        if (!top) return { runId: '', error: emptyMessage(target, data) };
        id = top.run_id;
      }
      const metric = st.metric || (data && data.metric) || '';
      const res = await api.request(api.envPath(envId, '/best-runs/' + encodeURIComponent(id) + '/base'
        + (metric ? '?metric=' + encodeURIComponent(metric) : '')));
      if (!res.ok) return { runId: id, error: api.errorMessage(res.data, 'Failed to load that run') };
      return { runId: id, base: res.data || {} };
    }

    /** Retrieve the draft scope; the launch form then loads its top-ranked run. */
    function find() {
      const envId = api.target().envId;
      if (!envId) return;
      st.applied = {
        envId: envId,
        datasetId: st.draft.datasetId,
        versionId: st.draft.datasetId ? st.draft.versionId : '',
        versioning: Object.assign({}, st.draft.versioning),
      };
      st.metric = '';
      api.onPick('');
    }

    /** Base-status fields (the launch form's st.baseInfo). */
    function info(base) {
      const remap = base.remap || {};
      return {
        runId: base.run ? base.run.id : '',
        bestRun: base,
        summary: remap.summary || null,
        dropped: remap.dropped || [],
        errors: remap.errors || [],
        warnings: base.warnings || [],
      };
    }

    function listed(runId) {
      return st.data && st.data.runs ? st.data.runs.find((r) => r.run_id === runId) || null : null;
    }

    /** "run abc12345 · accuracy 0.84 · agent v1.12 / kb 381" (§10.3). */
    function header(baseInfo) {
      const base = baseInfo && baseInfo.bestRun;
      if (!base || !base.run) return '';
      const row = listed(base.run.id);
      const score = row ? { metric: row.metric, score: row.score } : base.score;
      const parts = ['run ' + shortId(base.run.id)];
      if (score && score.metric) parts.push(score.metric + ' ' + formatScore(score.score));
      const versions = versionText(base.versioning);
      if (versions) parts.push(versions);
      return parts.join(' · ');
    }

    function drifted(baseInfo) {
      const base = baseInfo && baseInfo.bestRun;
      return !!(base && base.drift && base.drift.status === 'changed');
    }

    function status(baseInfo) {
      const base = baseInfo && baseInfo.bestRun;
      if (!base) return [];
      const nodes = [];
      const drift = base.drift || {};
      if (drift.status === 'changed') {
        nodes.push(el('div', { className: 'xl-callout xl-callout--warning', role: 'note', 'data-xlb-drift': '1' }, [el('div', null, [
          el('strong', { text: 'Agent or KB versions changed since this run' }),
          el('ul', { className: 'xl-callout-list' }, (drift.changes || []).map((c) => el('li', null, [
            (VERSION_LABELS[c.key] || c.key) + ': ',
            el('span', { className: 'xl-mono', text: c.run == null ? 'none' : String(c.run) }),
            ' in this run, ',
            el('span', { className: 'xl-mono', text: c.latest == null ? 'none' : String(c.latest) }),
            ' now',
          ]))),
          el('div', { className: 'xl-hint', text: 'Launching reproduces the configuration, not the agent or knowledge base it ran against, so scores may differ.' }),
        ])]));
      } else if (drift.status === 'unknown' && base.versioning) {
        nodes.push(el('div', { className: 'xl-hint', 'data-xlb-drift-unknown': '1', text: 'The environment\'s current agent and KB versions are not known yet, so drift since this run cannot be checked.' }));
      }
      const prompts = base.prompts || [];
      if (prompts.length) {
        nodes.push(el('div', { className: 'xl-callout xl-callout--warning', role: 'note', 'data-xlb-prompts': '1' }, [el('div', { className: 'xlb-prompts' }, [
          el('strong', { text: 'Temporary models were left unbound' }),
          el('div', { className: 'xl-hint', text: 'Their API keys are never stored. Pick a project model under Models, or use the temporary model again and enter its key.' }),
          el('ul', { className: 'xl-callout-list' }, prompts.map((p) => el('li', { className: 'xlb-prompt' }, [
            el('span', { className: 'xl-mono', text: p.slot_key }),
            ': ' + (p.label || p.model || 'temporary model') + (p.model && p.label && p.label !== p.model ? ' (' + p.model + ')' : '') + ' ',
            el('button', {
              type: 'button', className: 'xl-link-btn', 'data-xlb-reuse': p.slot_key,
              text: 'Use it again',
              onClick: () => api.reuseTemporary(p),
            }),
          ]))),
        ])]));
      }
      return nodes;
    }

    function metricSelect(data) {
      const metrics = (data && data.metrics) || [];
      const current = st.metric || '';
      const defaultLabel = data && data.metric && !st.metric ? 'Default · ' + data.metric : 'Default metric';
      const options = [el('option', { value: '', selected: !current, text: defaultLabel })].concat(metrics.map((m) => el('option', {
        value: m.name, selected: m.name === current, text: m.name + ' · ' + m.run_count + ' run' + (m.run_count === 1 ? '' : 's'),
      })));
      if (current && !metrics.some((m) => m.name === current)) options.push(el('option', { value: current, selected: true, text: current }));
      return el('select', {
        className: 'qym-control qym-select', 'aria-label': 'Rank by metric', 'data-xlb-metric': '1',
        onChange: (e) => { st.metric = e.target.value; refresh(); },
      }, options);
    }

    function refresh() {
      fetchList(true);
      api.rerender(); // shows "Loading…" and re-renders once the list is in
    }

    function table(data, selectedRunId) {
      const k = data.k;
      const rows = (data.runs || []).map((r) => {
        const selected = r.run_id === selectedRunId;
        const versions = versionText(r.remote_versioning);
        const dataset = r.dataset
          ? r.dataset.name + (r.dataset_version ? ' ' + r.dataset_version.version : '')
          : 'Custom dataset';
        return el('tr', { className: selected ? 'xlb-selected' : null, 'data-xlb-run': r.run_id }, [
          el('td', { className: 'xl-mono xlb-num', text: String(r.rank) }),
          el('td', { className: 'xl-mono', title: r.run_id, text: shortId(r.run_id) }),
          el('td', { className: 'xlb-dataset', title: dataset, text: dataset }),
          el('td', { className: 'xl-mono xlb-num', text: formatScore(r.score) }),
          el('td', { className: 'xl-mono xlb-num', text: r.pass_at_k_value == null ? '—' : formatScore(r.pass_at_k_value) }),
          el('td', { className: 'xl-mono xlb-num', title: r.error_item_count ? r.error_item_count + ' errored' : null, text: String(r.item_count) + (r.error_item_count ? ' (' + r.error_item_count + ' err)' : '') }),
          el('td', { className: 'xl-mono', text: versions || '—' }),
          el('td', { className: 'xl-mono xlb-params', title: sweepText(r.params) || null, text: sweepText(r.params) || '—' }),
          el('td', { className: 'xlb-age', text: formatAge(r.age_seconds) }),
          el('td', { className: 'xlb-action' }, selected
            ? api.tag('Current base', 'success')
            : el('button', {
              type: 'button', className: 'qym-inline-action qym-inline-action--neutral', 'data-xlb-use': r.run_id,
              'aria-label': 'Start from run ' + shortId(r.run_id), text: 'Use',
              onClick: () => api.onPick(r.run_id),
            })),
        ]);
      });
      const heads = ['#', 'Run', 'Dataset', data.metric || 'Score', k ? 'pass@' + k : 'pass@k', 'Items', 'Versions', 'Swept', 'Age', ''];
      return el('div', { className: 'xl-table-wrap' }, [el('table', { className: 'xlb-table', 'data-xlb-table': '1' }, [
        el('thead', null, [el('tr', null, heads.map((h, i) => el('th', { className: i === 0 || (i >= 3 && i <= 5) ? 'xlb-num' : null, scope: 'col', text: h })))]),
        el('tbody', null, rows),
      ])]);
    }

    function sameScope(a, b) {
      return !!a && !!b && JSON.stringify([a.datasetId, a.versionId, a.versioning])
        === JSON.stringify([b.datasetId, b.datasetId ? b.versionId : '', b.versioning]);
    }

    function scopeSelect(label, attr, value, options, onChange, disabled) {
      return el('select', {
        className: 'qym-control qym-select', 'aria-label': label, [attr]: '1', disabled: !!disabled,
        onChange: (e) => { onChange(e.target.value); api.rerender(); },
      }, options.map((o) => el('option', { value: o.value, selected: o.value === value, text: o.text })));
    }

    /** Dataset, version and versioning, asked before anything is retrieved (§10.2). */
    function scopePrompt(target) {
      const options = st.options;
      if (st.optionsError) return [el('div', { className: 'xl-callout xl-callout--error', role: 'alert', text: st.optionsError })];
      if (!options) return [el('div', { className: 'xl-hint', text: 'Loading datasets, versions and versioning…' })];
      const datasets = options.datasets || [];
      const draft = st.draft;
      const dataset = datasets.find((d) => d.id === draft.datasetId) || null;
      if (!dataset) { draft.datasetId = ''; draft.versionId = ''; }
      const controls = [
        el('span', { className: 'xl-hint', text: 'Rank runs on' }),
        scopeSelect('Dataset', 'data-xlb-scope-dataset', draft.datasetId,
          [{ value: '', text: 'Any dataset' }].concat(datasets.map((d) => ({ value: d.id, text: d.name + ' · ' + runCount(d.run_count) }))),
          (value) => { draft.datasetId = value; draft.versionId = ''; }),
        scopeSelect('Dataset version', 'data-xlb-scope-version', dataset ? draft.versionId : '',
          [{ value: '', text: 'Any version' }].concat((dataset ? dataset.versions : []).map((v) => ({ value: v.id, text: v.version + ' · ' + runCount(v.run_count) }))),
          (value) => { draft.versionId = value; }, !dataset),
      ];
      const versioning = options.versioning || {};
      Object.keys(versioning).sort().forEach((key) => {
        const words = keyWords(key);
        controls.push(scopeSelect(words.charAt(0).toUpperCase() + words.slice(1), 'data-xlb-scope-versioning', draft.versioning[key] || '',
          [{ value: '', text: 'Any ' + words }].concat(versioning[key].map((v) => ({ value: v.value, text: v.value + ' · ' + runCount(v.run_count) }))),
          (value) => { if (value) draft.versioning[key] = value; else delete draft.versioning[key]; }));
      });
      const applied = appliedFor(target.envId);
      const empty = !options.total_runs;
      controls.push(el('button', {
        type: 'button', className: 'qym-inline-action qym-inline-action--accent', 'data-xlb-find': '1',
        disabled: empty || sameScope(applied, draft),
        text: applied ? 'Update best runs' : 'Find best runs',
        onClick: find,
      }));
      const nodes = [el('div', { className: 'xl-row xlb-scope', 'data-xlb-scope': '1' }, controls)];
      if (empty) {
        nodes.push(el('div', { className: 'xl-hint', 'data-xlb-empty': '1', text: 'No official run of this environment has a score yet.' }));
      } else if (!applied) {
        nodes.push(el('div', { className: 'xl-hint', 'data-xlb-scope-hint': '1', text: 'Choose a dataset, a version and versioning values, then Find best runs. Anything left on Any is not filtered, so leaving everything on Any ranks every run of this environment.' }));
      }
      return nodes;
    }

    function scopeSummary(data) {
      const scope = (data && data.scope) || {};
      if (scope.global) return 'Every run of this environment';
      const parts = [];
      if (scope.dataset) parts.push(scope.dataset.name + (scope.dataset_version ? ' ' + scope.dataset_version.version : ' · any version'));
      else parts.push('Any dataset');
      Object.keys(scope.versioning || {}).sort().forEach((key) => {
        parts.push(keyWords(key) + ' ' + scope.versioning[key].join(' or '));
      });
      return parts.join(' · ');
    }

    function render(selectedRunId) {
      const target = api.target();
      fetchScope(target.envId);
      const promise = fetchList(false);
      if (st.loading && !st.waiting) {
        st.waiting = true;
        promise.then(() => { st.waiting = false; api.rerender(); });
      }
      const children = scopePrompt(target);
      if (!appliedFor(target.envId)) return el('div', { className: 'xlb-picker', 'data-xlb-picker': '1' }, children);
      const data = st.data;
      const controls = [
        el('span', { className: 'xl-hint', text: 'Rank by' }),
        metricSelect(data),
        el('label', { className: 'xl-hint xlb-toggle' }, [
          el('input', {
            type: 'checkbox', 'data-xlb-errored': '1', checked: st.includeErrored,
            onChange: (e) => { st.includeErrored = !!e.target.checked; refresh(); },
          }),
          ' Include runs with over 20% errored items',
        ]),
      ];
      if (data && data.scope) {
        controls.push(el('span', { className: 'xl-spacer' }));
        controls.push(api.tag(scopeSummary(data), data.scope.global ? 'info' : 'version', 'The scope these runs were ranked in'));
      }
      children.push(el('div', { className: 'xl-row' }, controls));
      if (data && data.scope && !data.scope.dataset_version) {
        children.push(el('div', { className: 'xl-hint', 'data-xlb-mixed': '1', text: 'These runs may span datasets or versions, whose scores are not strictly comparable. Pick a version to compare like with like.' }));
      }
      if (st.loading) {
        children.push(el('div', { className: 'xl-hint', text: 'Loading the best runs…' }));
      } else if (data && data.runs && data.runs.length) {
        children.push(table(data, selectedRunId));
        if (data.excluded_errored_count) {
          children.push(el('div', { className: 'xl-hint', text: data.excluded_errored_count + ' run' + (data.excluded_errored_count === 1 ? ' is' : 's are') + ' hidden for erroring on over 20% of items.' }));
        }
      } else {
        const note = [el('span', { text: emptyMessage(target, data) })];
        const other = data && data.latest_version_with_runs;
        if (other) {
          note.push(' ');
          note.push(el('button', {
            type: 'button', className: 'xl-link-btn', 'data-xlb-other-version': other.version,
            text: 'Use ' + other.version + ' (' + runCount(other.run_count) + ')',
            onClick: () => { st.draft.versionId = other.id; find(); },
          }));
        }
        children.push(el('div', { className: 'xl-hint', 'data-xlb-empty': '1' }, note));
      }
      return el('div', { className: 'xlb-picker', 'data-xlb-picker': '1' }, children);
    }

    return { render, load, info, header, status, drifted, refresh };
  }

  window.QymLaunchBestRun = { create, versionText, formatScore };
})();
