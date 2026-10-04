/*
 * Advanced panel of the new-experiment launch form (plan §8.4, issue #24).
 *
 * Mounted by experiment_launch.js into its [data-xl-advanced] host:
 *
 *   window.QymLaunchAdvanced.mount(host, api)
 *     → { decorateSpec, localErrors, onSpecChange, reveal, roleTableSummary, open, teardown }
 *
 * `api` is the launch form's advancedApi(): its state (st) and helpers. There is
 * one source of truth: env_overrides stay in st.values, bindings in st.bindings,
 * the dataset in st.dataset*, linked groups in st.links. This module only owns
 * what the main form has no control for: evaluator.config inputs, custom
 * run_metadata, and the extra evaluator keys only reachable from Raw JSON
 * (top-level report_k, a dataset_version next to a custom dataset string).
 *
 * Sweeps (#34): with api.sweeps (experiment_launch_sweeps.js), {"sweep": [...]}
 * values round-trip: Raw JSON sweeps of settings, role cells, evaluation inputs
 * and model slots become chips and multi-selects, and "links" becomes st.links.
 * Without it (a form mounted with `sweeps: false`) sweeps are refused here.
 *
 * Three separate cards (no tabs; they are unrelated). In the launch form they sit
 * inside, and follow, the "Advanced configuration" disclosure, and Role overrides
 * goes to the form's [data-xl-advanced-slot="roles"] under Environment overrides:
 *   1. Evaluation inputs: the static EvaluatorRequestConfig descriptor from
 *      GET /v1/projects/{pid}/experiments/evaluator-config (D5), a run_metadata
 *      key/value editor (qym_* reserved) and the platform-owned fields, read-only.
 *   2. Role overrides: the complete per-role table (rows = schema roles), with
 *      "Overridden only" and search. The Settings form shows a summary instead.
 *   3. Raw JSON: a CodeMirror editor over the §8.1 document built by
 *      api.buildSpec(). Edits are validated on blur and flow back into the form;
 *      form edits flow into the editor while it is not being edited.
 *
 * Security: every node is built with api.el()/textContent, never parsed HTML. The
 * document only ever holds {"$secret": ref} for temporary-model keys: the keys
 * stay in the launch form's st.secrets, are never read here, and a literal key
 * typed into the JSON is refused (never applied, stored or sent). Error
 * messages never echo values.
 */
(function () {
  'use strict';
  if (window.QymLaunchAdvanced) return;

  const SCRIPT_SRC = document.currentScript && document.currentScript.src;
  const DOCUMENT_KEYS = ['schema_hash', 'evaluator', 'slot_bindings', 'env_overrides', 'links', 'base_source'];
  const EVALUATOR_KEYS = ['dataset', 'dataset_version', 'config', 'report_k', 'model'];
  const TEMPORARY_KEYS = ['label', 'model', 'base_url', 'api_key'];
  const CONNECTION_KEYS = ['connection_id', 'name', 'model'];
  const PLACEHOLDER_PREFIX = '{{qym:';
  const JSON_POINTER = '#advanced-json';
  const METADATA_POINTER = '/evaluator/config/run_metadata';
  const SWEEP_MESSAGE = 'Sweeps are not available in this form';
  const DATASET_SWEEP_MESSAGE = 'The dataset cannot be swept in this form';
  // Three unrelated parts, one card each (no tabs): role overrides are env_overrides
  // and sit under the form's Environment overrides; evaluation inputs and the raw
  // document come after.
  const SECTIONS = [
    { id: 'roles', label: 'Role overrides', description: 'Per-role LLM settings of the environment schema (env_overrides), one row per role.' },
    { id: 'inputs', label: 'Evaluation inputs', description: 'evaluator.config inputs, custom run_metadata and the fields the platform sets.' },
    { id: 'json', label: 'Raw JSON', description: 'The whole launch document. Edits apply when the editor loses focus and flow back into the form.' },
  ];

  // CodeMirror 6 (vendored bundle, see trace_viewer.js). Loaded through
  // Function so this classic script stays ES2017-parseable.
  let cmPromise = null;
  function loadCodeMirror() {
    if (cmPromise) return cmPromise;
    const url = SCRIPT_SRC ? new URL('codemirror-bundle.js', SCRIPT_SRC).href : '/static/codemirror-bundle.js';
    let load;
    try {
      load = new Function('u', 'return import(u);'); // eslint-disable-line no-new-func
    } catch (_) {
      load = null;
    }
    cmPromise = load ? load(url).catch(() => null) : Promise.resolve(null);
    return cmPromise;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  function isSweep(value) {
    return isPlainObject(value) && Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, 'sweep');
  }
  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }
  function sameJson(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function isReservedKey(key) {
    return String(key).toLowerCase().indexOf('qym_') === 0;
  }

  /** Display text for a run_metadata value; parseMetadataValue() reads it back. */
  function metadataText(value) {
    if (typeof value === 'string') {
      try {
        JSON.parse(value);
        return JSON.stringify(value); // "123" stays a string, not a number
      } catch (_) {
        return value;
      }
    }
    return JSON.stringify(value);
  }
  function parseMetadataValue(raw) {
    try { return JSON.parse(raw); } catch (_) { return raw; }
  }

  /** Scalar type check against a descriptor entry; null when valid. */
  function typeProblem(entry, value) {
    const type = entry.type;
    if (type === 'integer') return typeof value === 'number' && Number.isInteger(value) ? null : 'Must be a whole number';
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value) ? null : 'Must be a number';
    if (type === 'boolean') return typeof value === 'boolean' ? null : 'Must be true or false';
    if (type === 'string') return typeof value === 'string' ? null : 'Must be a string';
    if (type === 'enum') {
      return (entry.enum || []).some((v) => sameJson(v, value)) ? null : 'Must be one of the listed values';
    }
    return null;
  }

  function placeholderPointers(value, pointer, escSeg, out) {
    if (typeof value === 'string') {
      if (value.indexOf(PLACEHOLDER_PREFIX) >= 0) out.push(pointer);
    } else if (Array.isArray(value)) {
      value.forEach((child, i) => placeholderPointers(child, pointer + '/' + i, escSeg, out));
    } else if (isPlainObject(value)) {
      Object.keys(value).forEach((key) => {
        const child = pointer + '/' + escSeg(key);
        if (key.indexOf(PLACEHOLDER_PREFIX) >= 0) out.push(child);
        else placeholderPointers(value[key], child, escSeg, out);
      });
    }
    return out;
  }

  function mount(host, api) {
    const el = api.el;
    const st = api.state;
    const has = api.has;

    const adv = {
      active: true,
      open: false, // the cards are shown (always, unless a host disclosure is closed)
      panel: null, // loaded /experiments/evaluator-config payload
      panelError: '',
      config: {}, // evaluator.config field → value (user fields only)
      invalid: {}, // evaluator.config field → { message, raw }
      meta: [], // [{ id, key, raw }] custom run_metadata rows
      nextMetaId: 1,
      extra: {}, // { report_k, dataset_version } only reachable from Raw JSON
      roleSearch: '',
      overriddenOnly: false,
      summaries: [], // role summary nodes rendered into the Settings form
      frame: null,
    };
    const json = {
      view: null, // CodeMirror EditorView
      textarea: null, // fallback editor
      loading: false,
      dirty: false,
      focused: false,
      external: false,
      synced: '',
      errors: [],
    };
    const nodes = {};
    // Inside the launch form's "Advanced configuration" disclosure the panel is a
    // plain card that follows that disclosure, so there is one collapsible only.
    const nested = host.parentElement ? host.parentElement.closest('details') : null;

    // ── Descriptor ─────────────────────────────────────────────────────────
    async function loadPanel() {
      const res = await api.request(api.projectPath('/experiments/evaluator-config'));
      if (!adv.active) return;
      if (res.ok && res.data && res.data.descriptor) {
        adv.panel = res.data;
        adv.panelError = '';
      } else {
        adv.panelError = (res.data && typeof res.data.detail === 'string' && res.data.detail) || 'Failed to load the evaluation inputs';
      }
      if (adv.open) renderInputs();
    }

    function configEntry(name) {
      const fields = adv.panel && adv.panel.descriptor && adv.panel.descriptor.fields;
      return (fields && fields['/' + name]) || null;
    }
    function platformOwnedConfig() {
      return (adv.panel && adv.panel.platform_owned && adv.panel.platform_owned.config) || ['run_name', 'live_mode', 'model', 'models', 'model_full'];
    }
    function platformOwnedEvaluator() {
      return (adv.panel && adv.panel.platform_owned && adv.panel.platform_owned.evaluator) || ['model'];
    }
    function reservedPrefix() {
      return (adv.panel && adv.panel.reserved_metadata_prefix) || 'qym_';
    }
    function pickerAlias() {
      return st.datasetMode === 'project' && typeof st.datasetRef === 'string' && st.datasetRef.indexOf('a:') === 0;
    }

    // ── Spec contribution ──────────────────────────────────────────────────
    function metadataState() {
      const values = {};
      const errors = [];
      const rowErrors = {};
      const seen = {};
      adv.meta.forEach((row) => {
        const key = row.key.trim();
        let message = '';
        if (!key && !row.raw.trim()) return;
        if (!key) message = 'Enter a key';
        else if (isReservedKey(key)) message = 'Keys starting with ' + reservedPrefix() + ' are reserved for the platform';
        else if (has(seen, key)) message = 'Duplicate key';
        else if (key.indexOf(PLACEHOLDER_PREFIX) >= 0 || row.raw.indexOf(PLACEHOLDER_PREFIX) >= 0) message = PLACEHOLDER_PREFIX + ' is reserved for platform placeholders';
        if (message) {
          rowErrors[row.id] = message;
          errors.push({ pointer: key ? METADATA_POINTER + '/' + api.escSeg(key) : METADATA_POINTER, message: 'run_metadata: ' + message });
          return;
        }
        seen[key] = true;
        values[key] = parseMetadataValue(row.raw);
      });
      return { values, errors, rowErrors };
    }

    function decorateSpec(spec) {
      const evaluator = spec.evaluator || (spec.evaluator = {});
      const config = {};
      Object.keys(adv.config).forEach((name) => {
        if (!has(adv.invalid, name)) config[name] = clone(adv.config[name]);
      });
      const meta = metadataState().values;
      if (Object.keys(meta).length) config.run_metadata = meta;
      // Panel edits win over the base's evaluator inputs (#31 st.evaluatorExtra);
      // the Dataset section's dataset_alias wins over both.
      if (Object.keys(config).length) {
        const current = evaluator.config || {};
        const merged = Object.assign({}, current, config);
        if (has(current, 'dataset_alias')) merged.dataset_alias = current.dataset_alias;
        evaluator.config = merged;
      }
      if (adv.extra.report_k != null) evaluator.report_k = adv.extra.report_k;
      if (adv.extra.dataset_version != null && evaluator.dataset_version == null) evaluator.dataset_version = adv.extra.dataset_version;
      return spec;
    }

    function localErrors() {
      const errors = [];
      Object.keys(adv.invalid).forEach((name) => errors.push({ pointer: '/evaluator/config/' + name, message: name + ': ' + adv.invalid[name].message }));
      metadataState().errors.forEach((e) => errors.push(e));
      if (json.errors.length) {
        errors.push({
          pointer: JSON_POINTER,
          message: 'Raw JSON not applied: ' + json.errors[0].message + (json.errors.length > 1 ? ' (+' + (json.errors.length - 1) + ' more)' : ''),
        });
      }
      return errors;
    }

    // ── Roles ──────────────────────────────────────────────────────────────
    function roleTables(model) {
      return Object.keys(model.fields).map((p) => model.fields[p]).filter((entry) => entry.kind === 'role_table');
    }
    function rowOverridden(row) {
      const prefix = row.pointer + '/';
      return Object.keys(st.values).some((p) => p.indexOf(prefix) === 0) || Object.keys(st.invalid).some((p) => p.indexOf(prefix) === 0);
    }
    function overriddenRoleCount(model) {
      let count = 0;
      roleTables(model || api.union()).forEach((table) => (table.rows || []).forEach((row) => { if (rowOverridden(row)) count += 1; }));
      return count;
    }
    function summaryText(table) {
      const rows = table.rows || [];
      const count = rows.filter(rowOverridden).length;
      return count + ' of ' + rows.length + ' roles overridden. Roles are edited under Role overrides.';
    }

    function roleTableSummary(model, table) {
      const text = el('span', { className: 'xl-hint', text: summaryText(table) });
      text._xaTable = table;
      adv.summaries = adv.summaries.filter((node) => node.isConnected);
      adv.summaries.push(text);
      scheduleRefresh(); // the Settings form re-rendered: endpoints or roles may have changed
      return el('div', { className: 'xl-object', 'data-xl-container': '1', 'data-xa-role-summary': '1' }, [
        el('div', { className: 'xl-object-title' }, [el('span', { text: 'Roles' }), api.tag(String((table.rows || []).length), 'count')]),
        el('div', { className: 'xl-row' }, [
          text,
          el('span', { className: 'xl-spacer' }),
          el('button', { type: 'button', className: 'qym-inline-action qym-inline-action--neutral', 'data-xa-edit-roles': '1', text: 'Edit role overrides', onClick: () => open('roles', true) }),
        ]),
      ]);
    }

    function applyRoleFilters() {
      const panel = nodes.panels && nodes.panels.roles;
      if (!panel) return;
      const query = adv.roleSearch.trim().toLowerCase();
      let visible = 0;
      panel.querySelectorAll('[data-xa-row]').forEach((tr) => {
        const text = tr.getAttribute('data-xa-search') || '';
        const show = (!query || text.indexOf(query) >= 0) && (!adv.overriddenOnly || rowOverridden(tr._xaRow));
        tr.hidden = !show;
        if (show) visible += 1;
      });
      panel.querySelectorAll('[data-xa-table]').forEach((block) => {
        block.hidden = !block.querySelector('[data-xa-row]:not([hidden])');
      });
      const empty = panel.querySelector('[data-xa-roles-empty]');
      if (empty) empty.hidden = visible > 0;
    }

    function renderRoles() {
      const panel = nodes.panels.roles;
      const children = [];
      const loading = !st.selected.length || st.selected.some((id) => !st.envData[id] || st.envData[id].loading);
      const model = loading ? null : api.union();
      const tables = model ? roleTables(model) : [];
      if (!st.selected.length) children.push(el('div', { className: 'xl-hint', text: 'Pick an environment to see its roles.' }));
      else if (loading) children.push(el('div', { className: 'xl-hint', text: 'Loading roles…' }));
      else if (!tables.length) children.push(el('div', { className: 'xl-hint', text: 'The selected environments have no role overrides.' }));
      else {
        children.push(el('div', { className: 'xl-toolbar' }, [
          el('input', {
            className: 'qym-control qym-search xl-grow', type: 'search', placeholder: 'Search roles', 'aria-label': 'Search roles',
            value: adv.roleSearch, 'data-xa-role-search': '1',
            onInput: (e) => { adv.roleSearch = e.target.value; applyRoleFilters(); },
          }),
          el('label', { className: 'xl-check' }, [
            el('input', { type: 'checkbox', checked: adv.overriddenOnly, 'data-xa-overridden-only': '1', onChange: (e) => { adv.overriddenOnly = e.target.checked; applyRoleFilters(); } }),
            'Overridden only',
          ]),
          el('button', {
            type: 'button', className: 'xl-link-btn', text: 'Reset roles',
            onClick: () => {
              tables.forEach((table) => (table.rows || []).forEach((row) => {
                const prefix = row.pointer + '/';
                Object.keys(st.values).forEach((p) => { if (p.indexOf(prefix) === 0) delete st.values[p]; });
                Object.keys(st.invalid).forEach((p) => { if (p.indexOf(prefix) === 0) delete st.invalid[p]; });
              }));
              renderRoles();
              api.updateChangedCount();
              api.schedulePreview();
            },
          }),
        ]));
        children.push(el('div', { className: 'xl-hint', text: 'Rows are the roles in the environment schema; an empty cell keeps the service default. "All roles" sets a column on every role shown. Endpoints list the endpoint slots and entries defined in this form.' }));
        const bound = api.boundPointers();
        tables.forEach((table) => children.push(renderRoleTable(model, table, bound)));
        children.push(el('div', { className: 'xl-empty', 'data-xa-roles-empty': '1', hidden: true, text: 'No roles match.' }));
      }
      panel.replaceChildren.apply(panel, children);
      applyRoleFilters();
    }

    function renderRoleTable(model, table, bound) {
      const cols = api.roleColumns(model, table);
      const head = el('tr', null, [el('th', { text: table.row_param || 'role' })].concat(cols.map((c) => el('th', { className: 'xl-mono', text: c.label }))));
      const trs = {}; // row key → tr
      const rows = (table.rows || []).map((row) => {
        const cells = [el('td', { className: 'xl-role-name', title: row.description || null, text: row.key })];
        cols.forEach((col) => {
          const pointer = api.childPointer(table.pointer, row.pointer, col.template);
          const entry = model.fields[col.template];
          const td = el('td');
          const control = api.leafControl(entry, pointer, model.fields, bound[pointer], row.key + ' · ' + col.label);
          control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', () => {
            api.onLeafInput(entry, pointer, control, td);
            updateCounts();
          });
          api.fillCell(td, control, entry, pointer, bound[pointer], row.key + ' · ' + col.label);
          api.markChanged(td, pointer);
          cells.push(td);
        });
        const tr = el('tr', { 'data-xa-row': row.key, 'data-xl-pointer': '/env_overrides' + row.pointer }, cells);
        tr.setAttribute('data-xa-search', [row.key, row.label || '', row.description || ''].join(' ').toLowerCase());
        tr._xaRow = row;
        trs[row.key] = tr;
        return tr;
      });
      // "All roles": a column value written to every role the search and filter show.
      const allRow = api.roleAllRow(model, table, cols, bound, (row) => !trs[row.key].hidden, () => { renderRoles(); updateCounts(); });
      return el('div', { className: 'xa-role-block', 'data-xa-table': table.pointer }, [
        el('div', { className: 'xl-table-wrap xa-role-wrap' }, [el('table', { className: 'xl-role-table' }, [el('thead', null, [head]), el('tbody', null, [allRow].concat(rows))])]),
      ]);
    }

    // ── Evaluation inputs ──────────────────────────────────────────────────
    function boundsHint(entry) {
      const b = entry.bounds || {};
      const range = [];
      if (b.minimum != null) range.push('≥ ' + b.minimum);
      if (b.exclusiveMinimum != null) range.push('> ' + b.exclusiveMinimum);
      if (b.maximum != null) range.push('≤ ' + b.maximum);
      return range.length ? 'Range ' + range.join(', ') + '.' : '';
    }

    function formatDefault(entry) {
      if (!entry.has_default) return 'Service default';
      return 'Default: ' + (typeof entry.default === 'string' ? entry.default : JSON.stringify(entry.default));
    }

    function parseConfigInput(entry, raw) {
      const text = String(raw);
      if (entry.type === 'boolean') return text === '' ? { unset: true } : { value: text === 'true' };
      if (entry.type === 'integer' || entry.type === 'number') {
        const trimmed = text.trim();
        if (!trimmed) return { unset: true };
        const num = Number(trimmed);
        if (!Number.isFinite(num)) return { error: 'Enter a number' };
        if (entry.type === 'integer' && !Number.isInteger(num)) return { error: 'Enter a whole number' };
        return { value: num };
      }
      return text === '' ? { unset: true } : { value: text };
    }

    function markConfigField(wrapper, name) {
      wrapper.classList.toggle('xl-field--changed', has(adv.config, name) || has(adv.invalid, name));
      wrapper.classList.toggle('xl-field--error', has(adv.invalid, name));
    }

    /** Sweeps (#34) of an evaluation input: adv.config[name] = {"sweep": [...]}. */
    function configTarget(name) {
      return {
        get: () => adv.config[name],
        set: (value) => {
          delete adv.invalid[name];
          if (value === undefined) delete adv.config[name];
          else adv.config[name] = value;
        },
      };
    }

    function configField(name) {
      const entry = configEntry(name);
      if (!entry) return null;
      const pointer = '/evaluator/config/' + name;
      const locked = name === 'dataset_alias' && pickerAlias();
      const wrapper = el('div', { className: 'xl-field', 'data-xa-field': name });
      const id = 'xa-f-' + name;
      const common = { id, 'data-xl-pointer': pointer, 'aria-label': entry.label || name, disabled: locked, title: locked ? 'Set by the dataset picker' : null };
      const sweepable = !!api.sweeps && !locked && name !== 'dataset_alias' && name !== 'dataset_version';
      const target = configTarget(name);
      let control;
      if (sweepable && isSweep(adv.config[name])) {
        control = api.sweeps.editor({
          entry, pointer, label: entry.label || name, get: target.get, set: target.set,
          onChange: () => { markConfigField(wrapper, name); updateCounts(); api.schedulePreview(); },
        });
      } else if (entry.type === 'boolean') {
        const current = has(adv.config, name) ? adv.config[name] : undefined;
        control = el('select', Object.assign({ className: 'qym-control qym-select xl-wide' }, common), [
          el('option', { value: '', text: entry.has_default ? 'Default (' + JSON.stringify(entry.default) + ')' : 'Service default' }),
          el('option', { value: 'true', selected: current === true, text: 'true' }),
          el('option', { value: 'false', selected: current === false, text: 'false' }),
        ]);
      } else {
        const numeric = entry.type === 'integer' || entry.type === 'number';
        control = el('input', Object.assign({
          className: 'qym-control qym-input xl-wide' + (numeric || /^git_|^dataset_/.test(name) ? ' xl-mono' : ''),
          type: 'text', inputmode: numeric ? 'decimal' : null, spellcheck: 'false',
          placeholder: locked ? 'Set by the dataset picker' : formatDefault(entry),
        }, common));
        control.value = has(adv.invalid, name) ? adv.invalid[name].raw : has(adv.config, name) && !locked ? String(adv.config[name]) : '';
      }
      const error = el('div', { className: 'xl-error-text', role: 'alert', text: has(adv.invalid, name) ? adv.invalid[name].message : '' });
      if (!control.hasAttribute('data-xs-sweep')) control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', () => {
        const parsed = parseConfigInput(entry, control.value);
        delete adv.invalid[name];
        if (parsed.unset) delete adv.config[name];
        else if (parsed.error) { delete adv.config[name]; adv.invalid[name] = { message: parsed.error, raw: control.value }; }
        else adv.config[name] = parsed.value;
        error.textContent = has(adv.invalid, name) ? adv.invalid[name].message : '';
        markConfigField(wrapper, name);
        updateCounts();
        api.schedulePreview();
      });
      const reset = el('button', {
        type: 'button', className: 'xl-link-btn xl-reset', text: 'Reset',
        onClick: () => {
          const swept = isSweep(adv.config[name]);
          delete adv.config[name];
          delete adv.invalid[name];
          if (swept) { renderInputs(); updateCounts(); api.schedulePreview(); return; }
          control.value = '';
          error.textContent = '';
          markConfigField(wrapper, name);
          updateCounts();
          api.schedulePreview();
        },
      });
      wrapper.appendChild(el('div', { className: 'xl-field-head' }, [
        el('span', { className: 'xl-dot', 'aria-hidden': 'true' }),
        el('label', { className: 'xl-field-label', for: id, text: entry.label || name }),
        el('span', { className: 'xl-field-name', text: name }),
        el('span', { className: 'xl-spacer' }),
        sweepable && !isSweep(adv.config[name]) ? api.sweeps.toggle({ entry, label: entry.label || name, get: target.get, set: target.set }) : null,
        reset,
      ]));
      wrapper.appendChild(control);
      const hint = boundsHint(entry);
      if (hint) wrapper.appendChild(el('div', { className: 'xl-hint', text: hint }));
      wrapper.appendChild(error);
      markConfigField(wrapper, name);
      return wrapper;
    }

    function updateMetadataErrors() {
      const state = metadataState();
      (nodes.metaRows || []).forEach((item) => {
        const message = state.rowErrors[item.row.id] || '';
        item.error.textContent = message;
        item.node.classList.toggle('xa-meta-row--error', !!message);
        const key = item.row.key.trim();
        item.keyInput.setAttribute('data-xl-pointer', key ? METADATA_POINTER + '/' + api.escSeg(key) : METADATA_POINTER);
      });
    }

    function metadataEditor() {
      nodes.metaRows = [];
      const list = el('div', { className: 'xa-meta-list' });
      adv.meta.forEach((row) => {
        const keyInput = el('input', {
          className: 'qym-control qym-input xl-mono', type: 'text', maxlength: '200', placeholder: 'key', 'aria-label': 'run_metadata key', value: row.key, spellcheck: 'false',
          onInput: (e) => { row.key = e.target.value; updateMetadataErrors(); updateCounts(); api.schedulePreview(); },
        });
        const valueInput = el('input', {
          className: 'qym-control qym-input xl-mono', type: 'text', maxlength: '5000', placeholder: 'value (text or JSON)', 'aria-label': 'run_metadata value', value: row.raw, spellcheck: 'false',
          onInput: (e) => { row.raw = e.target.value; updateMetadataErrors(); api.schedulePreview(); },
        });
        const error = el('div', { className: 'xl-error-text xa-meta-error', role: 'alert' });
        const node = el('div', { className: 'xa-meta-row', 'data-xa-meta-row': String(row.id) }, [
          keyInput,
          valueInput,
          el('button', {
            type: 'button', className: 'xl-link-btn', text: 'Remove', 'aria-label': 'Remove run_metadata key',
            onClick: () => { adv.meta = adv.meta.filter((r) => r !== row); renderInputs(); updateCounts(); api.schedulePreview(); },
          }),
          error,
        ]);
        nodes.metaRows.push({ row, node, error, keyInput });
        list.appendChild(node);
      });
      if (!adv.meta.length) list.appendChild(el('div', { className: 'xl-hint', text: 'No custom keys.' }));
      const platformKeys = (adv.panel && adv.panel.platform_metadata_keys) || ['qym_launch', 'qym_config'];
      const block = el('div', { className: 'xl-object', 'data-xl-pointer': METADATA_POINTER }, [
        el('div', { className: 'xl-object-title' }, [el('span', { text: 'Run metadata' }), el('span', { className: 'xl-field-name', text: 'run_metadata' })]),
        el('div', { className: 'xl-hint', text: 'Custom keys stored with each run. Values are read as JSON when they parse (numbers, true, objects), otherwise as text.' }),
        list,
        el('div', { className: 'xl-row' }, [
          el('button', {
            type: 'button', className: 'qym-inline-action qym-inline-action--neutral', 'data-xa-add-meta': '1', text: '+ Add key',
            onClick: () => { adv.meta.push({ id: adv.nextMetaId++, key: '', raw: '' }); renderInputs(); const rows = nodes.metaRows; if (rows.length) rows[rows.length - 1].keyInput.focus(); },
          }),
          el('span', { className: 'xl-hint' }, ['Set by the platform, read-only: '].concat(platformKeys.map((k) => api.tag(k, 'data')))),
        ]),
      ]);
      updateMetadataErrors();
      return block;
    }

    function platformOwnedBlock() {
      const jobs = (st.preview && st.preview.jobs) || [];
      const runName = jobs.length && jobs[0].run_name ? jobs[0].run_name : (st.name.trim() || 'the experiment name') + ' · swept values';
      const primary = api.unionSlots().find((slot) => slot.slot_key === 'endpoint:primary');
      const model = primary && st.bindings[primary.slot_key] ? api.bindingSummary(primary.slot_key) : 'Not sent (the worker\'s MODEL)';
      const rows = [
        ['run_name', runName, 'Generated per job'],
        ['live_mode', 'platform', 'Always platform'],
        ['model / models', model, 'From the primary model slot'],
        ['model_full', 'Not sent', 'Owned by the platform'],
        ['run_metadata.qym_*', 'qym_launch, qym_config', 'Written at launch'],
      ];
      return el('dl', { className: 'xa-owned', 'data-xa-owned': '1' }, [].concat.apply([], rows.map(([name, value, note]) => [
        el('dt', { className: 'xl-mono', text: name }),
        el('dd', null, [el('span', { className: 'xa-owned-value', text: value }), el('span', { className: 'xl-hint', text: ' · ' + note })]),
      ])));
    }

    function renderOwned() {
      const node = nodes.owned;
      if (node) node.replaceChildren(platformOwnedBlock());
    }

    function renderInputs() {
      const panel = nodes.panels.inputs;
      const children = [];
      if (adv.panelError) children.push(el('div', { className: 'xl-callout xl-callout--error', role: 'alert', text: adv.panelError }));
      if (!adv.panel && !adv.panelError) children.push(el('div', { className: 'xl-hint', text: 'Loading evaluation inputs…' }));
      if (adv.panel) {
        const fields = (adv.panel.fields || []).map(configField).filter(Boolean);
        children.push(el('div', { className: 'xl-object' }, [
          el('div', { className: 'xl-object-title' }, [el('span', { text: 'Evaluator config' }), el('span', { className: 'xl-field-name', text: 'evaluator.config' })]),
          el('div', { className: 'xl-hint', text: 'Sent as evaluator.config (EvaluatorRequestConfig). Empty fields keep the service default.' }),
          el('div', { className: 'xl-fields' }, fields),
        ]));
        children.push(metadataEditor());
      }
      const extras = [];
      if (adv.extra.report_k != null) extras.push('evaluator.report_k = ' + adv.extra.report_k);
      if (adv.extra.dataset_version != null) extras.push('evaluator.dataset_version = ' + adv.extra.dataset_version);
      if (extras.length) {
        children.push(el('div', { className: 'xl-callout', role: 'note' }, [
          el('div', null, [el('div', { text: 'Also sent, set from Raw JSON:' }), el('div', { className: 'xl-mono', text: extras.join('; ') })]),
          el('button', { type: 'button', className: 'xl-link-btn', text: 'Remove', onClick: () => { adv.extra = {}; renderInputs(); api.schedulePreview(); } }),
        ]));
      }
      nodes.owned = el('div');
      children.push(el('div', { className: 'xl-object' }, [
        el('div', { className: 'xl-object-title' }, [el('span', { text: 'Set by the platform' }), api.tag('read-only', null)]),
        el('div', { className: 'xl-hint', text: 'These EvaluatorRequestConfig fields are filled at launch and cannot be overridden.' }),
        nodes.owned,
      ]));
      panel.replaceChildren.apply(panel, children);
      renderOwned();
    }

    // ── Raw JSON ───────────────────────────────────────────────────────────
    function currentText() {
      return JSON.stringify(api.buildSpec(), null, 2);
    }

    function editorText() {
      if (json.view) return json.view.state.doc.toString();
      if (json.textarea) return json.textarea.value;
      return json.synced;
    }

    function setEditorText(text) {
      json.synced = text;
      if (json.view) {
        if (json.view.state.doc.toString() === text) return;
        json.external = true;
        json.view.dispatch({ changes: { from: 0, to: json.view.state.doc.length, insert: text } });
        json.external = false;
      } else if (json.textarea && json.textarea.value !== text) {
        json.textarea.value = text;
      }
    }

    function syncJson(force) {
      if (!force && (json.dirty || json.focused)) return;
      json.dirty = false;
      setEditorText(currentText());
      renderJsonStatus();
    }

    function renderJsonStatus() {
      const node = nodes.jsonStatus;
      if (!node) return;
      const children = [];
      if (json.errors.length) {
        children.push(el('div', { className: 'xl-error-text', role: 'alert', text: 'Not applied: fix these and leave the editor to apply.' }));
        children.push(el('ul', { className: 'xa-json-errors', 'data-xa-json-errors': '1' }, json.errors.map((e) => el('li', null, [
          e.pointer ? el('span', { className: 'xl-mono xa-json-pointer', text: e.pointer }) : null,
          el('span', { text: (e.pointer ? ' ' : '') + e.message }),
        ]))));
      } else {
        children.push(el('span', { className: 'xl-hint', text: json.dirty ? 'Unapplied edits: they apply when you leave the editor.' : 'In sync with the form.' }));
      }
      node.replaceChildren.apply(node, children);
    }

    function onEditorBlur() {
      json.focused = false;
      applyJson();
    }

    function mountEditor() {
      const holder = nodes.editor;
      if (!holder || json.view || json.textarea || json.loading) return;
      json.loading = true;
      holder.replaceChildren(el('div', { className: 'xl-hint', text: 'Loading editor…' }));
      loadCodeMirror().then((cm) => {
        json.loading = false;
        if (!adv.active || !nodes.editor) return;
        holder.replaceChildren();
        const text = currentText();
        json.synced = text;
        if (cm && cm.view && cm.state) {
          const tags = cm.highlight && cm.highlight.tags;
          const extensions = [
            cm.view.lineNumbers(),
            cm.commands.history(),
            cm.view.drawSelection(),
            cm.view.EditorView.lineWrapping,
            cm.language.bracketMatching(),
            cm.langJson.json(),
            cm.view.keymap.of([].concat(cm.commands.defaultKeymap, cm.commands.historyKeymap)),
            cm.view.EditorView.contentAttributes.of({ 'aria-label': 'Raw JSON config document' }),
            cm.view.EditorView.updateListener.of((update) => {
              if (update.docChanged && !json.external) { json.dirty = true; renderJsonStatus(); }
            }),
            cm.view.EditorView.theme({
              '&': { fontSize: 'var(--font-base)', backgroundColor: 'var(--bg-void)', color: 'var(--text-secondary)' },
              '&.cm-focused': { outline: 'none' },
              '.cm-scroller': { fontFamily: 'var(--font-mono)' },
              '.cm-gutters': { backgroundColor: 'var(--bg-void)', color: 'var(--text-muted)', border: 'none' },
              '.cm-content': { caretColor: 'var(--accent-primary)' },
              '.cm-cursor': { borderLeftColor: 'var(--accent-primary)' },
            }, { dark: true }),
          ];
          if (tags && cm.language.HighlightStyle) {
            extensions.push(cm.language.syntaxHighlighting(cm.language.HighlightStyle.define([
              { tag: tags.propertyName, color: 'var(--accent-secondary)' },
              { tag: tags.string, color: 'var(--accent-primary)' },
              { tag: tags.number, color: 'var(--accent-tertiary-soft)' },
              { tag: tags.bool, color: 'var(--accent-secondary)' },
              { tag: tags.null, color: 'var(--text-muted)' },
              { tag: tags.punctuation, color: 'var(--text-muted)' },
            ])));
          }
          json.view = new cm.view.EditorView({ state: cm.state.EditorState.create({ doc: text, extensions }), parent: holder });
          json.view.contentDOM.addEventListener('focus', () => { json.focused = true; });
          json.view.contentDOM.addEventListener('blur', onEditorBlur);
        } else {
          json.textarea = el('textarea', { className: 'xl-textarea xa-json-text', spellcheck: 'false', 'aria-label': 'Raw JSON config document' });
          json.textarea.value = text;
          json.textarea.addEventListener('focus', () => { json.focused = true; });
          json.textarea.addEventListener('input', () => { json.dirty = true; renderJsonStatus(); });
          json.textarea.addEventListener('blur', onEditorBlur);
          holder.appendChild(json.textarea);
        }
        renderJsonStatus();
      });
    }

    function renderJson() {
      const panel = nodes.panels.json;
      if (!nodes.editor) {
        nodes.editor = el('div', { className: 'xa-json-editor', 'data-xl-pointer': JSON_POINTER, tabindex: '-1' });
        nodes.jsonStatus = el('div', { className: 'xa-json-status', 'data-xa-json-status': '1', role: 'status' });
        panel.replaceChildren(
          el('div', { className: 'xl-hint', text: 'The config document (plan §8.1) the form sends. Edits are validated and applied when you leave the editor, and form edits show up here. Keys never appear: temporary models show {"$secret": ref} and project models their connection_id.' }),
          nodes.editor,
          el('div', { className: 'xl-toolbar' }, [
            nodes.jsonStatus,
            el('span', { className: 'xl-spacer' }),
            el('button', { type: 'button', className: 'qym-inline-action qym-inline-action--neutral', 'data-xa-json-revert': '1', text: 'Revert to form', onClick: () => { json.errors = []; syncJson(true); api.renderPreview(); } }),
            el('button', { type: 'button', className: 'qym-inline-action qym-inline-action--accent', 'data-xa-json-apply': '1', text: 'Apply', onClick: () => applyJson(true) }),
          ])
        );
      }
      mountEditor();
      syncJson(false);
    }

    // ── JSON → form ────────────────────────────────────────────────────────
    /** Descriptor template for a concrete env_overrides pointer (literal segments win). */
    function matchTemplate(fields, pointer) {
      const segs = api.splitPointer(pointer);
      let best = null;
      let bestScore = -1;
      Object.keys(fields).forEach((template) => {
        const ts = api.splitPointer(template);
        if (ts.length !== segs.length) return;
        let score = 0;
        for (let i = 0; i < ts.length; i += 1) {
          if (ts[i] === segs[i]) score += 1;
          else if (!/^\{.+\}$/.test(ts[i])) return;
        }
        if (score > bestScore) { best = template; bestScore = score; }
      });
      return best;
    }

    function roleRowProblem(model, template, pointer) {
      let problem = null;
      roleTables(model).forEach((table) => {
        if (template.indexOf(table.pointer + '/') !== 0) return;
        const depth = api.splitPointer(table.pointer).length;
        const key = api.splitPointer(pointer)[depth - 1];
        if (!(table.rows || []).some((row) => row.key === key)) problem = 'Unknown role for the selected environments';
      });
      return problem;
    }

    /** Problems of a {"sweep": [...]} value (#34), mapped to error pointers. */
    function sweepErrors(entry, value, pointer, errors) {
      if (!api.sweeps) { errors.push({ pointer, message: SWEEP_MESSAGE }); return false; }
      const problems = api.sweeps.checkValues(entry, value);
      problems.forEach((p) => errors.push({ pointer: p.index == null ? pointer : pointer + '/sweep/' + p.index, message: p.message }));
      return !problems.length;
    }

    function flattenOverrides(value, pointer, model, out, errors) {
      const docPointer = '/env_overrides' + pointer;
      if (value === null) return; // unset: inherit
      const template = pointer ? matchTemplate(model.fields, pointer) : null;
      const entry = template ? model.fields[template] : null;
      if (pointer && !entry) { errors.push({ pointer: docPointer, message: 'Unknown setting for the selected environments' }); return; }
      if (isSweep(value)) {
        // Swept values (#34) of one setting: chips in the form.
        if (!entry || entry.kind !== 'field') { errors.push({ pointer: docPointer, message: 'Only a single setting can be swept' }); return; }
        const role = roleRowProblem(model, template, pointer);
        if (role) { errors.push({ pointer: docPointer, message: role }); return; }
        if (entry.secret || entry.widget === 'secret') {
          errors.push({ pointer: docPointer, message: 'Keys are never entered here: bind a model slot (project or temporary model) instead' });
          return;
        }
        if (sweepErrors(entry, value, docPointer, errors)) out[pointer] = clone(value);
        return;
      }
      if (isPlainObject(value) && (!entry || entry.kind !== 'field')) {
        Object.keys(value).forEach((key) => flattenOverrides(value[key], pointer + '/' + api.escSeg(key), model, out, errors));
        return;
      }
      if (!entry || entry.kind !== 'field') { errors.push({ pointer: docPointer, message: 'Must be an object' }); return; }
      const role = roleRowProblem(model, template, pointer);
      if (role) { errors.push({ pointer: docPointer, message: role }); return; }
      if (entry.secret || entry.widget === 'secret') {
        errors.push({ pointer: docPointer, message: 'Keys are never entered here: bind a model slot (project or temporary model) instead' });
        return;
      }
      const problem = typeProblem(entry, value);
      if (problem) { errors.push({ pointer: docPointer, message: problem }); return; }
      out[pointer] = value;
    }

    function readBindings(doc, slots, errors) {
      const next = {};
      const raw = doc.slot_bindings == null ? {} : doc.slot_bindings;
      if (!isPlainObject(raw)) { errors.push({ pointer: '/slot_bindings', message: 'Must be an object' }); return next; }
      Object.keys(raw).forEach((slotKey) => {
        const pointer = '/slot_bindings/' + api.escSeg(slotKey);
        const b = raw[slotKey];
        if (!slots.some((s) => s.slot_key === slotKey)) { errors.push({ pointer, message: 'Unknown model slot for the selected environments' }); return; }
        if (b === null || (isPlainObject(b) && Object.keys(b).length === 1 && b.inherit === true)) return;
        if (isSweep(b)) {
          // A model sweep (#34): each value is a whole binding (or inherit).
          if (!api.sweeps) { errors.push({ pointer, message: SWEEP_MESSAGE }); return; }
          if (!Array.isArray(b.sweep) || !b.sweep.length) { errors.push({ pointer, message: 'A sweep needs a non-empty list of models' }); return; }
          const items = [];
          const seen = {};
          let ok = true;
          b.sweep.forEach((item, i) => {
            const at = pointer + '/sweep/' + i;
            const read = isPlainObject(item) && Object.keys(item).length === 1 && item.inherit === true
              ? { kind: 'inherit' } : readBinding(item, at, slotKey, errors);
            if (!read) { ok = false; return; }
            const value = read.kind === 'inherit' ? { inherit: true } : read.kind === 'connection' ? { connection_id: read.id } : read.binding;
            const key = api.sweeps.bindingKey(value);
            if (seen[key]) { errors.push({ pointer: at, message: 'Duplicate model' }); ok = false; return; }
            seen[key] = true;
            items.push(value);
          });
          if (ok) next[slotKey] = { kind: 'raw', value: { sweep: items } };
          return;
        }
        const read = readBinding(b, pointer, slotKey, errors);
        if (read) next[slotKey] = read;
      });
      return next;
    }

    /** One {connection_id} or {temporary} binding → the form's binding, or null (errors pushed). */
    function readBinding(b, pointer, slotKey, errors) {
      if (!isPlainObject(b)) { errors.push({ pointer, message: 'Must be {"connection_id": …}, {"temporary": …} or null' }); return null; }
      if (has(b, 'connection_id') && !has(b, 'temporary')) {
        const extra = Object.keys(b).filter((k) => CONNECTION_KEYS.indexOf(k) < 0);
        if (extra.length) { errors.push({ pointer, message: 'Unknown binding keys: ' + extra.join(', ') }); return null; }
        if (typeof b.connection_id !== 'string' || !b.connection_id) { errors.push({ pointer: pointer + '/connection_id', message: 'Must be a project model id' }); return null; }
        return { kind: 'connection', id: b.connection_id };
      }
      if (has(b, 'temporary') && Object.keys(b).length === 1 && isPlainObject(b.temporary)) {
        const t = b.temporary;
        const extra = Object.keys(t).filter((k) => TEMPORARY_KEYS.indexOf(k) < 0);
        if (extra.length) { errors.push({ pointer: pointer + '/temporary', message: 'Unknown temporary model keys: ' + extra.join(', ') }); return null; }
        if (typeof t.model !== 'string' || !t.model) { errors.push({ pointer: pointer + '/temporary/model', message: 'A temporary model needs a model name' }); return null; }
        if ((t.label != null && typeof t.label !== 'string') || (t.base_url != null && typeof t.base_url !== 'string')) {
          errors.push({ pointer: pointer + '/temporary', message: 'label and base_url must be strings' });
          return null;
        }
        let ref = null;
        if (t.api_key != null) {
          const valid = isPlainObject(t.api_key) && Object.keys(t.api_key).length === 1 && typeof t.api_key.$secret === 'string';
          if (!valid) {
            errors.push({ pointer: pointer + '/temporary/api_key', message: 'Keys are never typed into JSON: use "+ Temporary model" on the model card' });
            return null;
          }
          ref = t.api_key.$secret;
          if (!has(st.secrets, ref)) {
            errors.push({ pointer: pointer + '/temporary/api_key', message: 'Unknown key reference: add the temporary model again to enter its key' });
            return null;
          }
        }
        const binding = { temporary: {} };
        TEMPORARY_KEYS.forEach((k) => { if (t[k] != null) binding.temporary[k] = clone(t[k]); });
        const prev = st.bindings[slotKey];
        const save = !!(prev && prev.kind === 'temporary' && ref && prev.secretRef === ref && prev.save);
        return { kind: 'temporary', binding, secretRef: ref, save };
      }
      errors.push({ pointer, message: 'Must be {"connection_id": …}, {"temporary": …} or null' });
      return null;
    }

    function readEvaluator(doc, errors) {
      const out = { dataset: null, dataset_version: null, report_k: null, config: {}, meta: [] };
      const ev = doc.evaluator;
      if (!isPlainObject(ev)) { errors.push({ pointer: '/evaluator', message: 'evaluator must be an object' }); return out; }
      Object.keys(ev).forEach((key) => {
        if (EVALUATOR_KEYS.indexOf(key) < 0) errors.push({ pointer: '/evaluator/' + api.escSeg(key), message: 'Unknown key' });
      });
      platformOwnedEvaluator().forEach((key) => {
        if (ev[key] != null) errors.push({ pointer: '/evaluator/' + key, message: key + ' is set by the platform (from the primary model slot); remove it' });
      });
      ['dataset', 'dataset_version'].forEach((key) => {
        if (ev[key] == null) return;
        if (isSweep(ev[key])) errors.push({ pointer: '/evaluator/' + key, message: DATASET_SWEEP_MESSAGE });
        else if (typeof ev[key] !== 'string') errors.push({ pointer: '/evaluator/' + key, message: 'Must be a string' });
        else out[key] = ev[key];
      });
      if (ev.report_k != null) {
        if (typeof ev.report_k !== 'number' || !Number.isInteger(ev.report_k) || ev.report_k < 1) errors.push({ pointer: '/evaluator/report_k', message: 'Must be a whole number ≥ 1' });
        else out.report_k = ev.report_k;
      }
      const config = ev.config == null ? {} : ev.config;
      if (!isPlainObject(config)) { errors.push({ pointer: '/evaluator/config', message: 'Must be an object' }); return out; }
      if (!adv.panel && Object.keys(config).length) {
        errors.push({ pointer: '/evaluator/config', message: 'The evaluation inputs are still loading; try again' });
        return out;
      }
      const owned = platformOwnedConfig();
      Object.keys(config).forEach((name) => {
        const pointer = '/evaluator/config/' + api.escSeg(name);
        const value = config[name];
        if (name === 'run_metadata') {
          if (value == null) return;
          if (!isPlainObject(value)) { errors.push({ pointer, message: 'Must be an object' }); return; }
          Object.keys(value).forEach((key) => {
            if (isReservedKey(key)) errors.push({ pointer: pointer + '/' + api.escSeg(key), message: 'Keys starting with ' + reservedPrefix() + ' are reserved for the platform' });
            else out.meta.push({ key, raw: metadataText(value[key]) });
          });
          return;
        }
        if (owned.indexOf(name) >= 0) {
          if (value != null) errors.push({ pointer, message: name + ' is set by the platform; remove it' });
          return;
        }
        const entry = configEntry(name);
        if (!entry) { errors.push({ pointer, message: 'Unknown key (EvaluatorRequestConfig rejects extra keys)' }); return; }
        if (value == null) return;
        if (isSweep(value)) {
          if (name === 'dataset_alias' || name === 'dataset_version') { errors.push({ pointer, message: DATASET_SWEEP_MESSAGE }); return; }
          if (sweepErrors(entry, value, pointer, errors)) out.config[name] = clone(value);
          return;
        }
        const problem = typeProblem(entry, value);
        if (problem) { errors.push({ pointer, message: problem }); return; }
        out.config[name] = value;
      });
      return out;
    }

    /** Parse and validate the editor text; on success the form state it maps to. */
    function readDocument(text) {
      let doc;
      try {
        doc = JSON.parse(text);
      } catch (err) {
        return { errors: [{ pointer: '', message: 'Invalid JSON: ' + ((err && err.message) || 'parse error') }] };
      }
      const errors = [];
      if (!isPlainObject(doc)) return { errors: [{ pointer: '', message: 'The document must be a JSON object' }] };
      Object.keys(doc).forEach((key) => {
        if (DOCUMENT_KEYS.indexOf(key) < 0) errors.push({ pointer: '/' + api.escSeg(key), message: 'Unknown key' });
      });
      placeholderPointers(doc, '', api.escSeg, []).forEach((pointer) => {
        errors.push({ pointer, message: PLACEHOLDER_PREFIX + ' is reserved for platform slot placeholders' });
      });
      const model = api.union();
      const slots = api.unionSlots();
      const evaluator = readEvaluator(doc, errors);
      const bindings = readBindings(doc, slots, errors);
      const values = {};
      const env = doc.env_overrides == null ? {} : doc.env_overrides;
      if (!isPlainObject(env)) errors.push({ pointer: '/env_overrides', message: 'Must be an object' });
      else if (Object.keys(env).length && !model.envs.length) errors.push({ pointer: '/env_overrides', message: 'Pick an environment (and wait for its settings) first' });
      else flattenOverrides(env, '', model, values, errors);
      // A bound slot fills its fields: a raw value there is a binding_conflict.
      slots.forEach((slot) => {
        if (!bindings[slot.slot_key]) return;
        slot.pointers.forEach((pointer) => {
          if (has(values, pointer)) errors.push({ pointer: '/env_overrides' + pointer, message: 'Filled by the ' + slot.label + ' binding; remove this value or unbind the slot' });
        });
      });
      // Linked groups (#34): the form's st.links, checked like the service does.
      let links = null;
      if (doc.links != null) {
        if (!api.sweeps) errors.push({ pointer: '/links', message: SWEEP_MESSAGE });
        else {
          const problems = api.sweeps.checkLinks(doc);
          problems.forEach((e) => errors.push(e));
          if (!problems.length && doc.links.length) links = clone(doc.links);
        }
      }
      return { errors, evaluator, bindings, values, links };
    }

    function applyDataset(evaluator, config) {
      const name = evaluator.dataset;
      const datasets = st.datasets || [];
      let version = evaluator.dataset_version;
      if (name && datasets.some((d) => d.name === name)) {
        st.datasetMode = 'project';
        st.datasetName = name;
        st.datasetRef = '';
        if (version) { st.datasetRef = 'v:' + version; version = null; }
        else if (typeof config.dataset_alias === 'string' && config.dataset_alias) { st.datasetRef = 'a:' + config.dataset_alias; delete config.dataset_alias; }
        api.loadVersions(name);
      } else if (name) {
        st.datasetMode = 'custom';
        st.customDataset = name;
        st.datasetRef = '';
      } else if (st.datasetMode === 'custom') {
        st.customDataset = '';
      } else {
        st.datasetName = '';
        st.datasetRef = '';
      }
      return version;
    }

    function applyJson(explicit) {
      const text = editorText();
      if (!explicit && !json.dirty && !json.errors.length) return;
      const result = readDocument(text);
      json.errors = result.errors;
      if (result.errors.length) {
        renderJsonStatus();
        api.renderPreview();
        return;
      }
      const config = result.evaluator.config;
      const version = applyDataset(result.evaluator, config);
      // Bindings: drop in-memory keys no binding (swept ones too) refers to any more.
      st.bindings = result.bindings;
      api.pruneSecrets();
      st.values = result.values;
      st.invalid = {};
      adv.config = config;
      adv.invalid = {};
      adv.meta = result.evaluator.meta.map((row) => ({ id: adv.nextMetaId++, key: row.key, raw: row.raw }));
      adv.extra = {};
      if (result.evaluator.report_k != null) adv.extra.report_k = result.evaluator.report_k;
      if (version) adv.extra.dataset_version = version;
      st.links = result.links || undefined;
      json.dirty = false;
      api.rerender();
      if (adv.open) { renderRoles(); renderInputs(); }
      syncJson(true);
      updateCounts();
      api.schedulePreview();
    }

    // ── Panel shell ────────────────────────────────────────────────────────
    function updateCounts() {
      if (!nodes.counts) return;
      const inputs = Object.keys(adv.config).length + Object.keys(adv.invalid).length + adv.meta.filter((r) => r.key.trim()).length;
      nodes.counts.inputs.textContent = String(inputs);
      const loading = !st.selected.length || st.selected.some((id) => !st.envData[id] || st.envData[id].loading);
      nodes.counts.roles.textContent = loading ? '0' : String(overriddenRoleCount());
    }

    function renderSection(id) {
      if (id === 'inputs') renderInputs();
      else if (id === 'roles') renderRoles();
      else renderJson();
    }

    function renderAll() {
      if (!adv.open) return;
      SECTIONS.forEach((section) => renderSection(section.id));
    }

    /** Shows the cards (opening the host disclosure) and optionally scrolls to one. */
    function open(id, focus) {
      const wasOpen = adv.open;
      adv.open = true;
      if (nested) nested.open = true;
      if (!wasOpen) renderAll();
      const card = nodes.cards[id];
      if (focus && card) {
        card.scrollIntoView({ block: 'start', behavior: 'smooth' });
        card.focus({ preventScroll: true });
      }
    }

    /** Before the launch form focuses an error: show the card that holds it. */
    function reveal(pointer) {
      if (typeof pointer !== 'string') return false;
      if (pointer === JSON_POINTER) { open('json'); return true; }
      if (pointer === '/evaluator/config' || pointer.indexOf('/evaluator/config/') === 0) {
        if (pointer.indexOf('/evaluator/config/dataset_alias') === 0 && pickerAlias()) return false;
        open('inputs');
        return true;
      }
      if (pointer.indexOf('/env_overrides/') === 0) {
        const relative = pointer.slice('/env_overrides'.length);
        const model = api.union();
        const inRole = roleTables(model).some((table) => (table.rows || []).some((row) => relative === row.pointer || relative.indexOf(row.pointer + '/') === 0));
        if (!inRole) return false;
        adv.roleSearch = '';
        adv.overriddenOnly = false;
        open('roles');
        return true;
      }
      return false;
    }

    function refresh() {
      adv.frame = null;
      if (!adv.active) return;
      adv.summaries = adv.summaries.filter((node) => node.isConnected);
      adv.summaries.forEach((node) => { node.textContent = summaryText(node._xaTable); });
      updateCounts();
      if (!adv.open) return;
      SECTIONS.forEach(({ id }) => {
        const focusInside = nodes.panels[id].contains(document.activeElement);
        if (id === 'json') syncJson(false);
        else if (!focusInside) renderSection(id);
        else if (id === 'inputs') renderOwned();
      });
    }

    function scheduleRefresh() {
      if (adv.frame || !adv.active) return;
      adv.frame = requestAnimationFrame(refresh);
    }

    function onSpecChange() {
      scheduleRefresh();
    }

    function build() {
      nodes.panels = {};
      nodes.counts = {};
      nodes.cards = {};
      SECTIONS.forEach((section) => {
        const count = section.id === 'json' ? null : el('span', { className: 'qym-tag qym-tag--count', text: '0' });
        if (count) nodes.counts[section.id] = count;
        nodes.panels[section.id] = el('div', { className: 'xa-section-body', 'data-xa-panel': section.id });
        nodes.cards[section.id] = el('section', { className: 'xl-card xa-card', 'data-xa-section': section.id, tabindex: '-1', 'aria-label': section.label }, [
          el('div', { className: 'xl-card-header' }, [el('div', null, [
            el('h2', { className: 'xl-section-title' }, [section.label, count ? ' ' : null, count]),
            el('p', { className: 'xl-section-description', text: section.description }),
          ])]),
          el('div', { className: 'xl-card-body' }, [nodes.panels[section.id]]),
        ]);
      });
      // Role overrides go to the form's roles slot (under Environment overrides) when
      // it has one; the other cards go to the host.
      const scope = host.parentElement || host;
      const rolesSlot = scope.querySelector('[data-xl-advanced-slot="roles"]');
      if (rolesSlot) {
        rolesSlot.className = 'xa-host';
        rolesSlot.hidden = false;
        rolesSlot.replaceChildren(nodes.cards.roles);
        nodes.rolesSlot = rolesSlot;
      }
      host.className = 'xa-host';
      host.replaceChildren.apply(host, SECTIONS.filter((section) => !(rolesSlot && section.id === 'roles')).map((section) => nodes.cards[section.id]));
      // Inside the launch form's "Advanced configuration" the cards follow that
      // disclosure; elsewhere (the default preset editor) they are always shown.
      adv.open = nested ? nested.open : true;
      if (nested) {
        nested.addEventListener('toggle', () => {
          if (!adv.active) return; // a torn-down panel whose host disclosure survived
          // open() sets adv.open first: re-rendering here would drop the focus it set.
          const wasOpen = adv.open;
          adv.open = nested.open;
          if (adv.open && !wasOpen) renderAll();
        });
      }
      updateCounts();
      renderAll();
    }

    function teardown() {
      adv.active = false;
      if (adv.frame) cancelAnimationFrame(adv.frame);
      adv.frame = null;
      if (json.view) json.view.destroy();
      json.view = null;
      json.textarea = null;
      adv.summaries = [];
      if (nodes.rolesSlot) { nodes.rolesSlot.replaceChildren(); nodes.rolesSlot.hidden = true; }
    }

    build();
    loadPanel();
    return { decorateSpec, localErrors, onSpecChange, reveal, roleTableSummary, open, teardown };
  }

  window.QymLaunchAdvanced = { mount };
})();
