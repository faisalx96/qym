/*
 * New-experiment launch form (plan §12.2 / §8.2, issue #23).
 *
 * Mounted by experiments.js on /projects/{slug}/experiments?new=1:
 *
 *   window.QymExperimentLaunch.mount({ root, project, me, slug, onLaunched, onCancel })
 *     → { teardown }
 *
 * One page with a sticky preview: environments ("+ New environment" opens the
 * QymEvalEnvironments add dialog inline), dataset (project dataset + version or
 * alias, or a custom string), "Start from" (official defaults, a saved preset,
 * blank or a clone; see below), one model card per confirmed slot (project model, temporary model via QymTemporaryModel, or
 * Inherit), the generated grouped settings form (search, "changed only"),
 * priority (HIGH is gated) and name. The preview runs a debounced dry run of
 * POST /v1/projects/{pid}/experiments and lists every validation error; each
 * error focuses its field. Launch posts the same body without dry_run.
 *
 * APIs:
 *   GET  /v1/projects/{pid}/eval-environments?active=true
 *   GET  /v1/projects/{pid}/eval-environments/{eid}/form           descriptor
 *   GET  /v1/projects/{pid}/eval-environments/{eid}/model-slots    slots
 *   GET  /v1/projects/{pid}/eval-environments/{eid}/model-options  project models
 *   GET  /v1/datasets?project_slug=  and  /v1/datasets/{name}/versions
 *   POST /v1/projects/{pid}/experiments  (dry_run for the preview)
 *   GET  /v1/projects/{pid}/eval-environments/{eid}/presets         official + saved
 *   GET  …/presets/{preset_id}/versions/{n}?remap=current            base config (§9.3)
 *   POST /v1/projects/{pid}/experiments/{xid}/clone  and  GET …/experiments/{xid}
 *
 * Bases (#31, plan §8.2/§9.2): "Official defaults" is the default when the base
 * environment has a published version (otherwise Blank, with a note). Official and
 * saved presets load re-mapped onto the environment's current schema; dropped
 * settings and model warnings are listed. The base fills st.baseline (settings,
 * bindings, dataset) and st.evaluatorExtra (other evaluator inputs); a field that
 * differs from the baseline shows the "changed" dot and resets to the base value,
 * and the base section counts the diff vs base. Switching base (confirmed when
 * there are edits) keeps the edits whose setting or slot exists on the new base.
 * ?clone=<xid>[&job=<jid>] prefills from POST …/clone (or that job's qym_config)
 * with base kind "clone"; temporary models come without their key and ask for it
 * again. ?env=<eid> preselects an environment ("Run official defaults" fallback).
 *
 * Extension points: BASE_OPTIONS (#38 best-run base),
 * the [data-xl-advanced] host (#24 Advanced panel) and specValue() (#34 sweeps
 * write {"sweep": [...]} values into the same spec).
 *
 * Advanced panel (#24): experiment_launch_advanced.js (window.QymLaunchAdvanced)
 * mounts into [data-xl-advanced] through the "Advanced panel hook" below. It
 * reads and writes this form's state (st) through advancedApi(), so there is one
 * source of truth: role overrides live in st.values, which the Advanced role
 * table edits (the Settings form shows a summary for role tables instead).
 *
 * Security: nodes are built with el()/textContent, so no server or user string
 * is parsed as HTML. The only innerHTML is QymTemporaryModel.renderChip(), which
 * escapes its values. Temporary-model keys live only in this closure
 * (st.secrets) and the request body; they are never put in the URL, storage,
 * the DOM or logs, and are dropped on teardown.
 */
(function () {
  'use strict';
  if (window.QymExperimentLaunch) return;

  const STYLESHEETS = [
    'static/eval_environments.css?v=eval-environments-20260929-1',
    'static/eval_temporary_model.css?v=eval-temporary-model-20260930-1',
    'static/experiment_launch.css?v=experiment-launch-20260930-3',
    'static/experiment_launch_advanced.css?v=experiment-launch-advanced-20260930-1',
  ];
  const PREVIEW_DELAY_MS = 600;
  const PRIORITIES = ['LOW', 'NORMAL', 'HIGH'];
  const PRIORITY_ORDER = { LOW: 0, NORMAL: 1, HIGH: 2 };
  // services/eval_priority.PREEMPTION_ACK_REQUIRED
  const PREEMPTION_ACK_REQUIRED = 'preemption_acknowledgement_required';
  // "Start from" (§8.2). `available` means implemented; official/saved also need a
  // published version on the base environment. Best run arrives with #38; "Clone"
  // only appears for a ?clone= prefill.
  const BASE_OPTIONS = [
    { kind: 'official', label: 'Official defaults', available: true },
    { kind: 'best_run', label: 'Best run', available: false },
    { kind: 'saved', label: 'Saved preset', available: true },
    { kind: 'blank', label: 'Blank', available: true },
  ];
  const CLONE_OPTION = { kind: 'clone', label: 'Clone', available: true };
  const ROLE_LABELS = { model: 'model', base_url: 'base URL', api_key: 'API key' };

  // ── Utilities ──────────────────────────────────────────────────────────
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((key) => {
        const value = attrs[key];
        if (value === undefined || value === null || value === false) return;
        if (key === 'className') node.className = value;
        else if (key === 'text') node.textContent = String(value);
        else if (key === 'value') node.value = String(value);
        else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
        else node.setAttribute(key, value === true ? '' : String(value));
      });
    }
    [].concat(children == null ? [] : children).forEach((child) => {
      if (child == null || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  function appRoot() {
    if (typeof window.__QYM_ROOT_PATH__ === 'string') {
      return window.__QYM_ROOT_PATH__.replace(/\/+$/, '') + '/';
    }
    const idx = window.location.pathname.indexOf('/projects/');
    return idx >= 0 ? window.location.pathname.slice(0, idx + 1) : '/';
  }

  function apiUrl(path) {
    return window.location.origin + appRoot() + String(path || '').replace(/^\/+/, '');
  }

  /** Head <link>s are not carried by client-side navigation: add ours on mount. */
  function ensureStylesheets() {
    const anchor = document.querySelector('link[href*="ui_components.css"]');
    STYLESHEETS.forEach((href) => {
      const file = href.split('?')[0].split('/').pop();
      if (document.querySelector('link[href*="' + file + '"]')) return;
      const link = el('link', { rel: 'stylesheet', href: appRoot() + href });
      document.head.insertBefore(link, anchor || null);
    });
  }

  async function request(path, options) {
    let res;
    try {
      res = await fetch(apiUrl(path), Object.assign({ credentials: 'same-origin' }, options || {}));
    } catch (err) {
      return { ok: false, status: 0, data: { detail: (err && err.message) || 'Network error' } };
    }
    if (window.QymAuth && window.QymAuth.handle401 && window.QymAuth.handle401(res)) {
      return { ok: false, status: 401, data: { detail: 'Your session expired' } };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data: data || {} };
  }

  function errorMessage(data, fallback) {
    const detail = data && data.detail;
    if (typeof detail === 'string' && detail) return detail;
    if (detail && typeof detail.message === 'string' && detail.message) return detail.message;
    if (Array.isArray(detail)) return detail.map((e) => (e && e.msg) || String(e)).join('; ');
    return fallback || 'Request failed';
  }

  function toast(message, type) {
    if (window.QymShell && window.QymShell.toast) window.QymShell.toast(message, type);
  }

  async function confirmDialog(options) {
    if (window.QymShell && window.QymShell.openConfirmDialog) {
      const result = await window.QymShell.openConfirmDialog(options);
      return !!(result && result.confirmed);
    }
    return window.confirm(options.title + '\n\n' + [].concat(options.description || []).join('\n'));
  }

  function tag(text, modifier, title) {
    return el('span', { className: 'qym-tag' + (modifier ? ' qym-tag--' + modifier : ''), title: title || null, text: text });
  }

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  function formatValue(value) {
    if (typeof value === 'string') return value === '' ? '""' : value;
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }

  // RFC 6901 pointers (mirrors services/eval_schema_form.py).
  function escSeg(segment) {
    return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
  }
  function splitPointer(pointer) {
    if (!pointer) return [];
    return pointer.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  }
  function templateParam(segment) {
    return segment.length > 2 && segment.charAt(0) === '{' && segment.charAt(segment.length - 1) === '}';
  }
  /** Descriptor pointer for a concrete pointer, or null (mirrors match_pointer). */
  function matchPointer(descriptor, pointer) {
    const fields = (descriptor && descriptor.fields) || {};
    let candidates = (descriptor && descriptor.root) || [];
    let current = null;
    const segments = splitPointer(pointer);
    for (let i = 0; i < segments.length; i += 1) {
      const seg = segments[i];
      let chosen = null;
      ['literal', 'row', 'key'].some((rank) => candidates.some((child) => {
        const entry = fields[child];
        if (!entry) return false;
        const last = entry.path[entry.path.length - 1];
        if (rank === 'literal') chosen = !templateParam(last) && last === seg ? child : null;
        else if (rank === 'row') chosen = entry.kind === 'role_table' && (entry.rows || []).some((r) => r.key === seg) ? child : null;
        else chosen = templateParam(last) && entry.kind !== 'role_table' ? child : null;
        return !!chosen;
      }));
      if (!chosen) return null;
      current = chosen;
      candidates = fields[chosen].children || [];
    }
    return current;
  }
  /** A child's concrete pointer: its template relative to the parent's template. */
  function childPointer(parentTemplate, parentConcrete, childTemplate) {
    return parentConcrete + childTemplate.slice(parentTemplate.length);
  }

  /** env_overrides from the flat {pointer: value} edits. */
  function buildOverrides(values) {
    const out = {};
    Object.keys(values).sort().forEach((pointer) => {
      const segments = splitPointer(pointer);
      if (!segments.length) return;
      let node = out;
      for (let i = 0; i < segments.length - 1; i += 1) {
        const seg = segments[i];
        if (!node[seg] || typeof node[seg] !== 'object' || Array.isArray(node[seg])) node[seg] = {};
        node = node[seg];
      }
      node[segments[segments.length - 1]] = values[pointer];
    });
    return out;
  }

  // ── Base helpers (#31) ─────────────────────────────────────────────────
  function deepCopy(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }
  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }
  function sameValue(a, b) {
    if (a === undefined || b === undefined) return a === b;
    return JSON.stringify(a) === JSON.stringify(b);
  }
  /** A {"sweep": [...]} value (services/eval_config.is_sweep). */
  function isSweepValue(value) {
    return isPlainObject(value) && Object.keys(value).length === 1 && Array.isArray(value.sweep);
  }
  /** The descriptor template a concrete pointer belongs to (exact match first). */
  function matchTemplate(fields, concrete) {
    if (has(fields, concrete)) return concrete;
    const segs = splitPointer(concrete);
    let best = null;
    let bestWild = Infinity;
    Object.keys(fields).forEach((template) => {
      const parts = splitPointer(template);
      if (parts.length !== segs.length) return;
      let wild = 0;
      const fits = parts.every((part, i) => {
        if (part === segs[i]) return true;
        if (part.length > 2 && part.charAt(0) === '{' && part.charAt(part.length - 1) === '}') { wild += 1; return true; }
        return false;
      });
      if (fits && wild < bestWild) { best = template; bestWild = wild; }
    });
    return best;
  }
  /** env_overrides → flat {pointer: value}; leaves are descriptor fields or scalars. */
  function flattenOverrides(node, pointer, fields, out) {
    if (node === null || node === undefined) return;
    if (pointer) {
      const template = matchTemplate(fields, pointer);
      const entry = template ? fields[template] : null;
      if (!isPlainObject(node) || isSweepValue(node) || (entry && entry.kind === 'field')) {
        out[pointer] = deepCopy(node);
        return;
      }
    }
    if (!isPlainObject(node)) return;
    Object.keys(node).forEach((key) => flattenOverrides(node[key], pointer + '/' + escSeg(key), fields, out));
  }
  /** A comparable key for a form binding (a temporary model's key is not part of it). */
  function bindingKey(b) {
    if (!b) return '';
    if (b.kind === 'connection') return 'c:' + b.id;
    if (b.kind === 'temporary') {
      const t = Object.assign({}, (b.binding && b.binding.temporary) || {});
      delete t.api_key;
      return 't:' + JSON.stringify(t);
    }
    return 'r:' + JSON.stringify(b.value);
  }

  // ── Mount ──────────────────────────────────────────────────────────────
  function mount(options) {
    const opts = options || {};
    const root = opts.root;
    const project = opts.project || {};
    const me = opts.me || {};
    const isManager = me.role === 'ADMIN' || project.role === 'MANAGER';

    const st = {
      active: true,
      envs: [],
      envsError: '',
      selected: [],
      envData: {}, // id → { loading, form, formError, slots, needsConfirmation, options, optionsError }
      datasets: null,
      datasetsError: '',
      datasetMode: 'project',
      datasetName: '',
      datasetRef: '', // '' latest | 'v:<version>' | 'a:<alias>'
      versions: {},
      customDataset: '',
      base: 'blank',
      baseTouched: false, // the user picked a base: selection changes keep its kind
      baseEnv: null, // environment whose presets are the base
      savedPresetId: '',
      presets: {}, // env id → { loading, error, official, saved }
      baseInfo: { kind: 'blank', loaded: false }, // what the current base loaded
      baseGeneration: 0,
      baseNote: '',
      baseline: { values: {}, bindings: {}, dataset: null }, // the base's form values
      evaluatorExtra: {}, // base evaluator inputs besides the dataset (sent as is)
      clone: null, // { experimentId, jobId, spec, linkedGroups, sourceName, notes }
      bindings: {}, // slot_key → {kind:'connection', id} | {kind:'temporary', binding, secretRef, save}
      secrets: {}, // temporary-model keys {ref: key}: memory only
      tempFormFor: null,
      values: {}, // env_overrides pointer → value
      invalid: {}, // env_overrides pointer → {message, raw}: a value that did not parse
      addedKeys: {}, // collection pointer → [keys]
      search: '',
      changedOnly: false,
      priority: '',
      name: '',
      preview: null,
      previewError: '',
      previewLoading: false,
      launchErrors: null,
      launching: false,
      timer: null,
      generation: 0,
    };

    const hosts = {};
    let advanced = null; // #24 Advanced panel (experiment_launch_advanced.js)

    function projectPath(suffix) {
      return 'v1/projects/' + encodeURIComponent(project.id) + suffix;
    }
    function envPath(id, suffix) {
      return projectPath('/eval-environments/' + encodeURIComponent(id) + (suffix || ''));
    }
    function envById(id) {
      return st.envs.find((env) => env.id === id) || null;
    }
    function envName(id) {
      const env = envById(id);
      return env ? env.name : id;
    }
    function selectedEnvs() {
      return st.selected.map(envById).filter(Boolean);
    }
    /** Selected envs whose schema lacks an env_overrides pointer (§6 "not in env"). */
    function envsMissing(pointer) {
      return st.selected.filter((id) => st.envData[id] && st.envData[id].form && !matchPointer(st.envData[id].form, pointer));
    }
    function notInEnvMessage(pointer, id) {
      const segments = splitPointer(pointer);
      return (segments[segments.length - 1] || pointer) + ' is not in environment "' + envName(id) + '": reset it or deselect ' + envName(id) + '.';
    }

    // ── Loading ─────────────────────────────────────────────────────────
    async function loadEnvironments(selectId) {
      const res = await request(projectPath('/eval-environments?active=true'));
      if (!st.active) return;
      if (!res.ok) {
        st.envsError = errorMessage(res.data, 'Failed to load environments');
      } else {
        st.envsError = '';
        st.envs = (res.data.environments || []).filter((env) => env.is_active !== false);
        st.selected = st.selected.filter((id) => envById(id));
        if (selectId && envById(selectId) && st.selected.indexOf(selectId) < 0) st.selected.push(selectId);        if (!st.selected.length && st.envs.length === 1) st.selected = [st.envs[0].id];
      }
      renderEnvironments();
      await loadSelectedEnvData();
    }

    async function loadEnvData(id, force) {
      if (st.envData[id] && !force) return;
      st.envData[id] = { loading: true };
      const [form, slots, models] = await Promise.all([
        request(envPath(id, '/form')),
        request(envPath(id, '/model-slots')),
        request(envPath(id, '/model-options')),
      ]);
      if (!st.active) return;
      const slotRows = slots.ok ? (slots.data.slots || []) : [];
      st.envData[id] = {
        loading: false,
        form: form.ok ? form.data.descriptor : null,
        formError: form.ok ? '' : errorMessage(form.data, 'Failed to load the settings form'),
        slots: slotRows.filter((slot) => slot.status === 'confirmed'),
        needsConfirmation: slots.ok ? !!slots.data.needs_confirmation : false,
        options: models.ok ? models.data : null,
        optionsError: models.ok ? '' : errorMessage(models.data, 'Failed to load project models'),
      };
    }

    async function loadSelectedEnvData(force) {
      const ids = st.selected.slice();
      renderModels();
      renderSettings();
      await Promise.all(ids.map((id) => loadEnvData(id, force)));
      if (!st.active) return;
      pruneBindings();
      pruneOrphanValues();
      renderModels();
      renderSettings();
      renderRun();
      await syncBase();
      if (!st.active) return;
      schedulePreview();
    }

    async function loadDatasets() {
      const res = await request('v1/datasets?project_slug=' + encodeURIComponent(opts.slug || project.slug || ''));
      if (!st.active) return;
      if (res.ok) {
        st.datasets = res.data.datasets || [];
        if (!st.datasets.length) st.datasetMode = 'custom';
      } else {
        st.datasets = [];
        st.datasetsError = errorMessage(res.data, 'Failed to load datasets');
        st.datasetMode = 'custom';
      }
      renderDataset();
    }

    async function loadVersions(name) {
      if (!name || st.versions[name]) return;
      st.versions[name] = { loading: true, versions: [], aliases: [] };
      const res = await request('v1/datasets/' + encodeURIComponent(name) + '/versions?project_slug=' + encodeURIComponent(opts.slug || project.slug || ''));
      if (!st.active) return;
      const versions = res.ok ? (res.data.versions || []) : [];
      const aliases = [];
      versions.forEach((v) => (v.aliases || []).forEach((a) => { if (aliases.indexOf(a) < 0) aliases.push(a); }));
      st.versions[name] = { loading: false, versions, aliases };
      renderDataset();
    }

    // ── Union of the selected environments (§6 multi-environment) ───────
    function union() {
      const fields = {};
      const presence = {};
      const groups = [];
      const groupIndex = {};
      const envs = [];
      st.selected.forEach((id) => {
        const data = st.envData[id];
        const d = data && data.form;
        if (!d) return;
        envs.push(id);
        Object.keys(d.fields || {}).forEach((pointer) => {
          const entry = d.fields[pointer];
          (presence[pointer] = presence[pointer] || []).push(id);
          if (!fields[pointer]) {
            fields[pointer] = Object.assign({}, entry);
            if (entry.rows) fields[pointer].rows = entry.rows.slice();
            if (entry.required_keys) fields[pointer].required_keys = entry.required_keys.slice();
            return;
          }
          const merged = fields[pointer];
          (entry.rows || []).forEach((row) => {
            if (!merged.rows.some((r) => r.key === row.key)) merged.rows.push(row);
          });
          (entry.required_keys || []).forEach((key) => {
            if (merged.required_keys && merged.required_keys.indexOf(key) < 0) merged.required_keys.push(key);
          });
        });
        (d.groups || []).forEach((group) => {
          if (!groupIndex[group.id]) {
            groupIndex[group.id] = { id: group.id, label: group.label, pointers: [] };
            groups.push(groupIndex[group.id]);
          }
          (group.pointers || []).forEach((p) => {
            if (groupIndex[group.id].pointers.indexOf(p) < 0) groupIndex[group.id].pointers.push(p);
          });
        });
      });
      return { fields, presence, groups, envs };
    }

    /** Confirmed slots across the selected environments, keyed by slot_key. */
    function unionSlots() {
      const slots = [];
      const index = {};
      st.selected.forEach((id) => {
        const data = st.envData[id];
        (data && data.slots || []).forEach((slot) => {
          if (!index[slot.slot_key]) {
            index[slot.slot_key] = { slot_key: slot.slot_key, label: slot.label || slot.slot_key, kind: slot.kind, required: !!slot.required, field_map: {}, envs: [] };
            slots.push(index[slot.slot_key]);
          }
          const merged = index[slot.slot_key];
          merged.envs.push(id);
          merged.required = merged.required || !!slot.required;
          Object.keys(slot.field_map || {}).forEach((role) => {
            if (slot.field_map[role]) merged.field_map[role] = slot.field_map[role];
          });
        });
      });
      slots.sort((a, b) => (a.slot_key === 'endpoint:primary' ? -1 : b.slot_key === 'endpoint:primary' ? 1 : 0));
      return slots;
    }

    /** Pointers filled by a bound slot → the slot label (those inputs are locked). */
    function boundPointers() {
      const out = {};
      unionSlots().forEach((slot) => {
        if (!st.bindings[slot.slot_key]) return;
        Object.keys(slot.field_map).forEach((role) => { out[slot.field_map[role]] = slot.label; });
      });
      return out;
    }

    /** Drop edits no selected environment knows (like pruneBindings); needs every form. */
    function pruneOrphanValues() {
      if (!st.selected.length || st.selected.some((id) => !st.envData[id] || !st.envData[id].form)) return;
      [st.values, st.invalid].forEach((map) => Object.keys(map).forEach((p) => {
        if (envsMissing(p).length === st.selected.length) delete map[p];
      }));
    }

    function pruneBindings() {
      const keys = unionSlots().map((s) => s.slot_key);
      Object.keys(st.bindings).forEach((key) => {
        if (keys.indexOf(key) < 0) clearBinding(key);
      });
      Object.keys(st.baseline.bindings).forEach((key) => {
        if (keys.indexOf(key) < 0) delete st.baseline.bindings[key];
      });
    }

    // ── Bindings ────────────────────────────────────────────────────────
    function clearBinding(slotKey) {
      const current = st.bindings[slotKey];
      if (current && current.kind === 'temporary' && current.secretRef) delete st.secrets[current.secretRef];
      delete st.bindings[slotKey];
    }

    function setBinding(slotKey, binding) {
      clearBinding(slotKey);
      if (binding) {
        st.bindings[slotKey] = binding;
        // A bound slot fills its fields: drop raw values there (binding_conflict otherwise).
        const slot = unionSlots().find((s) => s.slot_key === slotKey);
        if (slot) Object.keys(slot.field_map).forEach((role) => {
          delete st.values[slot.field_map[role]];
          delete st.invalid[slot.field_map[role]];
        });
      }
      renderModels();
      renderSettings();
      updateBaseMeta();
      schedulePreview();
    }

    /** Project models for one slot: union across envs, disabled unless usable on all. */
    function slotConnections(slot) {
      const byId = {};
      const list = [];
      slot.envs.forEach((envId) => {
        const data = st.envData[envId];
        const options = data && data.options;
        (options && options.connections || []).forEach((conn) => {
          const perSlot = (conn.slots && conn.slots[slot.slot_key]) || { available: conn.available, reason: conn.reason };
          if (!byId[conn.connection_id]) {
            byId[conn.connection_id] = { id: conn.connection_id, name: conn.name, model: conn.model, available: true, reasons: [] };
            list.push(byId[conn.connection_id]);
          }
          if (!perSlot.available) {
            byId[conn.connection_id].available = false;
            const reason = (perSlot.reason || 'Not available') + (slot.envs.length > 1 ? ' (' + envName(envId) + ')' : '');
            byId[conn.connection_id].reasons.push(reason);
          }
        });
      });
      return list;
    }

    function temporaryKeys() {
      let allowed = true;
      let reason = null;
      selectedEnvs().forEach((env) => {
        const options = st.envData[env.id] && st.envData[env.id].options;
        if (options && options.temporary_keys_allowed === false) {
          allowed = false;
          reason = reason || ((options.temporary_keys_reason || 'Model API keys are not sent to this environment') + ' (' + env.name + ')');
        }
      });
      return { allowed, reason };
    }

    function bindingSummary(slotKey) {
      const b = st.bindings[slotKey];
      if (!b) return 'Inherit';
      if (b.kind === 'connection') {
        for (const id of st.selected) {
          const options = st.envData[id] && st.envData[id].options;
          const conn = (options && options.connections || []).find((c) => c.connection_id === b.id);
          if (conn) return conn.name;
        }
        return b.id;
      }
      if (b.kind === 'raw') {
        const n = isSweepValue(b.value) ? b.value.sweep.length : 0;
        return n ? 'Sweep of ' + n + ' models' : 'From the base';
      }
      const t = b.binding.temporary || {};
      return 'Temporary: ' + (t.label || t.model);
    }

    // ── Base (#31, plan §8.2 / §9.2) ────────────────────────────────────
    function hasOfficial(env) {
      return !!(env && env.official_preset_id && env.official_preset_version != null);
    }

    /** The first selected environment with official defaults, else the first one. */
    function pickBaseEnv() {
      const envs = selectedEnvs();
      const official = envs.find(hasOfficial);
      return official ? official.id : (envs[0] ? envs[0].id : null);
    }

    function loadPresets(envId) {
      if (!envId) return Promise.resolve(null);
      const cached = st.presets[envId];
      if (cached) return cached.promise;
      const entry = { loading: true, error: '', official: null, saved: [] };
      entry.promise = request(envPath(envId, '/presets')).then((res) => {
        entry.loading = false;
        if (!res.ok) entry.error = errorMessage(res.data, 'Failed to load presets');
        else (res.data.presets || []).forEach((preset) => {
          if (!preset.current_version) return;
          if (preset.kind === 'official') entry.official = preset;
          else entry.saved.push(preset);
        });
        return entry;
      });
      st.presets[envId] = entry;
      return entry.promise;
    }

    function presetsFor(envId) {
      const entry = envId ? st.presets[envId] : null;
      return entry && !entry.loading ? entry : null;
    }

    function baseAvailability(kind) {
      const env = envById(st.baseEnv);
      if (kind === 'blank') return { ok: true };
      if (kind === 'clone') return { ok: !!st.clone };
      if (kind === 'best_run') return { ok: false, reason: 'Coming soon' };
      if (!env) return { ok: false, reason: 'Pick an environment first' };
      if (kind === 'official') {
        return hasOfficial(env) ? { ok: true } : { ok: false, reason: 'No official defaults are published for ' + env.name };
      }
      if (kind === 'saved') {
        const presets = presetsFor(env.id);
        if (!presets) return { ok: false, reason: 'Loading saved presets…' };
        return presets.saved.length ? { ok: true } : { ok: false, reason: 'No saved presets for ' + env.name + ' yet' };
      }
      return { ok: false };
    }

    function baseLabel() {
      const info = st.baseInfo || {};
      const version = info.version != null ? ' v' + info.version : '';
      if (st.base === 'official') {
        return 'Official defaults' + version + (st.selected.length > 1 && info.envId ? ' · ' + envName(info.envId) : '');
      }
      if (st.base === 'saved') return 'Saved preset' + (info.presetName ? ' “' + info.presetName + '”' : '') + version;
      if (st.base === 'clone') {
        const c = st.clone || {};
        return 'Clone' + (c.sourceName ? ' of ' + c.sourceName : '') + (c.jobId ? ' (one job)' : '');
      }
      const opt = BASE_OPTIONS.find((b) => b.kind === st.base);
      return opt ? opt.label : st.base;
    }

    /** base_source for the request; validated by the server (api/experiments.py). */
    function baseSource() {
      const info = st.baseInfo || {};
      if ((st.base === 'official' || st.base === 'saved') && info.loaded && info.versionId) {
        return { kind: st.base, preset_version_id: info.versionId };
      }
      if (st.base === 'clone' && st.clone) {
        const source = { kind: 'clone', experiment_id: st.clone.experimentId };
        if (st.clone.jobId) source.job_id = st.clone.jobId;
        return source;
      }
      return { kind: 'blank' };
    }

    function currentDataset() {
      return { mode: st.datasetMode, name: st.datasetName, ref: st.datasetRef, custom: st.customDataset };
    }

    function applyDataset(d) {
      st.datasetMode = d.mode;
      st.datasetName = d.name;
      st.datasetRef = d.ref;
      st.customDataset = d.custom;
      if (d.mode === 'project' && d.name) loadVersions(d.name);
    }

    function datasetChanged() {
      const b = st.baseline.dataset;
      if (!b) return false;
      const c = currentDataset();
      if (b.mode !== c.mode) return true;
      return b.mode === 'custom' ? b.custom.trim() !== c.custom.trim() : (b.name !== c.name || b.ref !== c.ref);
    }

    /** Raw values under a bound slot's fields would be a binding_conflict: drop them. */
    function stripBoundFields(values, bindings) {
      unionSlots().forEach((slot) => {
        if (!bindings[slot.slot_key]) return;
        Object.keys(slot.field_map).forEach((role) => { delete values[slot.field_map[role]]; });
      });
    }

    /** Form state of a base config: {values, bindings, dataset, evaluatorExtra, notes}. */
    function baselineFrom(config) {
      const cfg = isPlainObject(config) ? config : {};
      const values = {};
      const model = union();
      flattenOverrides(isPlainObject(cfg.env_overrides) ? cfg.env_overrides : {}, '', model.fields, values);
      const slots = unionSlots();
      const bindings = {};
      const notes = [];
      if (model.envs.length) {
        // Settings no selected environment knows are dropped, and said so.
        Object.keys(values).forEach((p) => {
          if (matchTemplate(model.fields, p)) return;
          delete values[p];
          notes.push(splitPointer(p).join('.') + ' was dropped: not in any selected environment.');
        });
      }
      const raw = isPlainObject(cfg.slot_bindings) ? cfg.slot_bindings : {};
      Object.keys(raw).forEach((key) => {
        const b = raw[key];
        if (b == null || !isPlainObject(b) || b.inherit === true) return;
        const slot = slots.find((s) => s.slot_key === key);
        if (!slot) {
          notes.push('Model slot ' + key + ' is not confirmed on the selected environments; it is left to Inherit.');
          return;
        }
        if (isSweepValue(b)) {
          bindings[key] = { kind: 'raw', value: deepCopy(b) };
        } else if (typeof b.connection_id === 'string' && !has(b, 'temporary')) {
          const conn = slotConnections(slot).find((c) => c.id === b.connection_id);
          if (conn && conn.available) bindings[key] = { kind: 'connection', id: b.connection_id };
          else {
            notes.push('Model ' + (b.name || (conn && conn.name) || b.connection_id) + (conn ? ' cannot be used' : ' no longer exists')
              + ' for ' + slot.label + '; pick another model.');
          }
        } else if (isPlainObject(b.temporary)) {
          // Never a key: presets and clones drop it (§7.5); it is asked for again.
          const t = {};
          ['label', 'model', 'base_url'].forEach((f) => { if (typeof b.temporary[f] === 'string') t[f] = b.temporary[f]; });
          bindings[key] = { kind: 'temporary', binding: { temporary: t }, secretRef: null, needsKey: true };
        }
      });
      stripBoundFields(values, bindings);
      const evaluator = isPlainObject(cfg.evaluator) ? deepCopy(cfg.evaluator) : {};
      const evConfig = isPlainObject(evaluator.config) ? evaluator.config : {};
      let dataset = null;
      if (typeof evaluator.dataset === 'string' && evaluator.dataset) {
        const known = (st.datasets || []).some((d) => d.name === evaluator.dataset);
        if (known) {
          const alias = typeof evConfig.dataset_alias === 'string' ? evConfig.dataset_alias : '';
          dataset = {
            mode: 'project', name: evaluator.dataset, custom: '',
            ref: evaluator.dataset_version ? 'v:' + evaluator.dataset_version : alias ? 'a:' + alias : '',
          };
          delete evaluator.dataset_version;
          delete evConfig.dataset_alias;
        } else {
          dataset = { mode: 'custom', name: '', ref: '', custom: evaluator.dataset };
        }
      }
      delete evaluator.dataset;
      if (isPlainObject(evaluator.config) && !Object.keys(evaluator.config).length) delete evaluator.config;
      return { values, bindings, dataset, evaluatorExtra: evaluator, notes };
    }

    function applyBaseline(base) {
      st.baseline = { values: deepCopy(base.values), bindings: deepCopy(base.bindings), dataset: base.dataset ? Object.assign({}, base.dataset) : null };
      st.values = deepCopy(base.values);
      st.invalid = {};
      st.bindings = deepCopy(base.bindings);
      st.evaluatorExtra = deepCopy(base.evaluatorExtra) || {};
      if (base.dataset) applyDataset(base.dataset);
    }

    function isChanged(pointer) {
      return has(st.invalid, pointer) || !sameValue(st.values[pointer], st.baseline.values[pointer]);
    }

    function changedPointers() {
      const seen = {};
      Object.keys(st.values).concat(Object.keys(st.baseline.values), Object.keys(st.invalid)).forEach((p) => {
        if (!seen[p] && isChanged(p)) seen[p] = true;
      });
      return Object.keys(seen);
    }

    function bindingChanged(key) {
      return bindingKey(st.bindings[key]) !== bindingKey(st.baseline.bindings[key]);
    }

    function changedSlots() {
      const seen = {};
      Object.keys(st.bindings).concat(Object.keys(st.baseline.bindings)).forEach((k) => {
        if (!seen[k] && bindingChanged(k)) seen[k] = true;
      });
      return Object.keys(seen);
    }

    /** "Diff vs base" (§8.2): changed settings, model bindings and dataset. */
    function diffVsBase() {
      const settings = changedPointers().length;
      const models = changedSlots().length;
      const dataset = datasetChanged() ? 1 : 0;
      return { settings, models, dataset, total: settings + models + dataset };
    }

    function diffText() {
      const total = diffVsBase().total;
      return total + ' change' + (total === 1 ? '' : 's') + ' vs base';
    }

    /** The user's edits relative to the current base (see replayEdits). */
    function captureEdits() {
      const values = {};
      changedPointers().forEach((p) => {
        values[p] = has(st.invalid, p) ? { invalid: st.invalid[p] } : { value: deepCopy(st.values[p]) };
      });
      const bindings = {};
      changedSlots().forEach((k) => { bindings[k] = st.bindings[k] ? deepCopy(st.bindings[k]) : null; });
      const dataset = datasetValue() && (datasetChanged() || !st.baseline.dataset) ? currentDataset() : null;
      return { values, bindings, dataset };
    }

    /** Re-apply edits whose setting or slot exists on the new base (§8.2). */
    function replayEdits(edits) {
      const fields = union().fields;
      const slotKeys = unionSlots().map((s) => s.slot_key);
      let kept = 0;
      let dropped = 0;
      Object.keys(edits.values).forEach((p) => {
        if (!matchTemplate(fields, p)) { dropped += 1; return; }
        const edit = edits.values[p];
        delete st.invalid[p];
        delete st.values[p];
        if (edit.invalid) st.invalid[p] = edit.invalid;
        else if (edit.value !== undefined) st.values[p] = edit.value;
        kept += 1;
      });
      Object.keys(edits.bindings).forEach((k) => {
        if (slotKeys.indexOf(k) < 0) { dropped += 1; return; }
        if (edits.bindings[k]) st.bindings[k] = edits.bindings[k];
        else delete st.bindings[k];
        kept += 1;
      });
      if (edits.dataset) applyDataset(edits.dataset);
      stripBoundFields(st.values, st.bindings);
      pruneSecrets();
      return { kept, dropped };
    }

    /** Keys of temporary models no binding uses any more are forgotten. */
    function pruneSecrets() {
      const refs = {};
      Object.keys(st.bindings).forEach((k) => {
        const b = st.bindings[k];
        if (b && b.kind === 'temporary' && b.secretRef) refs[b.secretRef] = true;
      });
      Object.keys(st.secrets).forEach((ref) => { if (!refs[ref]) delete st.secrets[ref]; });
    }

    /** Fetch st.base's config (re-mapped onto the current schema) → {base, info}. */
    async function loadBase() {
      const generation = ++st.baseGeneration;
      const kind = st.base;
      const envId = st.baseEnv;
      st.baseInfo = { kind, loading: true, loaded: false, envId };
      renderBase();
      const info = { kind, loading: false, loaded: true, envId, warnings: [], dropped: [], errors: [], summary: null, notes: [] };
      let config = {};
      if (kind === 'official' || kind === 'saved') {
        const presets = await loadPresets(envId);
        if (!st.active || generation !== st.baseGeneration) return null;
        let preset = null;
        if (presets && !presets.error) {
          preset = kind === 'official' ? presets.official
            : (presets.saved.find((p) => p.id === st.savedPresetId) || presets.saved[0] || null);
        }
        if (kind === 'saved') st.savedPresetId = preset ? preset.id : '';
        if (!preset) {
          info.loaded = false;
          info.error = (presets && presets.error) || (kind === 'official'
            ? 'No official defaults are published for ' + envName(envId) + '.'
            : 'There is no saved preset to start from.');
        } else {
          const res = await request(envPath(envId, '/presets/' + encodeURIComponent(preset.id) + '/versions/'
            + encodeURIComponent(preset.current_version.version) + '?remap=current'));
          if (!st.active || generation !== st.baseGeneration) return null;
          if (!res.ok || !res.data.remap) {
            info.loaded = false;
            info.error = errorMessage(res.data, 'Failed to load the preset');
          } else {
            const remap = res.data.remap;
            const version = res.data.version || {};
            config = remap.config || {};
            Object.assign(info, {
              versionId: version.id,
              version: version.version,
              presetId: preset.id,
              presetName: kind === 'saved' ? preset.name : null,
              releaseNotes: version.notes || '',
              summary: remap.summary || null,
              dropped: remap.dropped || [],
              errors: remap.errors || [],
              // The schema_hash warning is what the remap just resolved.
              warnings: (version.warnings || []).filter((w) => w.rule !== 'schema_hash'),
            });
          }
        }
      } else if (kind === 'clone' && st.clone) {
        config = st.clone.spec || {};
        info.notes = st.clone.notes.slice();
      }
      await st.datasetsReady; // a base dataset maps onto the project picker
      if (!st.active || generation !== st.baseGeneration) return null;
      const base = baselineFrom(config);
      info.notes = info.notes.concat(base.notes);
      return { base, info };
    }

    /** Lay st.base under the form, keeping the edits that still fit. */
    async function setBase(kind) {
      st.base = kind;
      st.baseKey = kind + '|' + (kind === 'official' || kind === 'saved' ? st.baseEnv : '');
      const loaded = await loadBase();
      if (!loaded || !st.active) return null;
      const edits = captureEdits();
      applyBaseline(loaded.base);
      st.baseInfo = loaded.info;
      st.links = kind === 'clone' && st.clone ? deepCopy(st.clone.linkedGroups) : undefined;
      const result = replayEdits(edits);
      renderDataset();
      renderBase();
      renderModels();
      renderSettings();
      renderPreview();
      schedulePreview();
      return result;
    }

    /** "Start from" / "Switch base": confirm when there are edits (§8.2). */
    async function chooseBase(kind, force) {
      if (kind === st.base && !force) return true;
      const diff = diffVsBase();
      if (diff.total > 0) {
        const ok = await confirmDialog({
          title: 'Switch base?',
          description: [
            'You have ' + diff.total + ' change' + (diff.total === 1 ? '' : 's') + ' from ' + baseLabel() + '.',
            'Changes to settings and models that also exist on the new base are kept; the others are dropped.',
          ],
          confirmLabel: 'Switch base',
          cancelLabel: 'Keep current base',
        });
        if (!ok || !st.active) { renderBase(); return false; }
      }
      st.baseTouched = true;
      st.baseNote = '';
      const result = await setBase(kind);
      if (result && result.dropped) {
        toast(result.dropped + ' change' + (result.dropped === 1 ? '' : 's') + ' did not fit the new base and ' + (result.dropped === 1 ? 'was' : 'were') + ' dropped', 'info');
      }
      return true;
    }

    /** After an environment change: default to official defaults, else Blank (§9.2). */
    async function syncBase() {
      if (!st.selected.length) { renderBase(); return; }
      if (!st.baseEnv || st.selected.indexOf(st.baseEnv) < 0) st.baseEnv = pickBaseEnv();
      const env = envById(st.baseEnv);
      await loadPresets(st.baseEnv);
      if (!st.active) return;
      let kind = st.base;
      if (kind !== 'clone') {
        if (!st.baseTouched) kind = 'official';
        const available = baseAvailability(kind);
        if ((kind === 'official' || kind === 'saved') && !available.ok) {
          st.baseNote = (available.reason || 'That base is not available') + (st.baseTouched ? '' : ' yet') + ', so the form starts from Blank.';
          kind = 'blank';
        } else if (kind !== 'blank') {
          st.baseNote = '';
        }
      }
      const key = kind + '|' + (kind === 'official' || kind === 'saved' ? (env ? env.id : '') : '');
      if (key !== st.baseKey) await setBase(kind);
      else renderBase();
    }

    function resetAllToBase() {
      st.values = deepCopy(st.baseline.values);
      st.invalid = {};
      const bindings = {};
      Object.keys(st.baseline.bindings).forEach((k) => {
        // Keep a re-entered key when the model itself is unchanged.
        bindings[k] = bindingChanged(k) ? deepCopy(st.baseline.bindings[k]) : st.bindings[k];
      });
      st.bindings = bindings;
      pruneSecrets();
      if (st.baseline.dataset) applyDataset(st.baseline.dataset);
      renderDataset();
      renderBase();
      renderModels();
      renderSettings();
      renderPreview();
      schedulePreview();
    }

    // ── Clone prefill (#26 "Rerun with this config") ─────────────────────
    function containsSweep(node) {
      if (isSweepValue(node)) return true;
      if (Array.isArray(node)) return node.some(containsSweep);
      return isPlainObject(node) && Object.keys(node).some((k) => containsSweep(node[k]));
    }

    async function loadClone(experimentId, jobId) {
      const suffix = '/experiments/' + encodeURIComponent(experimentId) + '/clone' + (jobId ? '?job_id=' + encodeURIComponent(jobId) : '');
      const res = await request(projectPath(suffix), { method: 'POST' });
      if (!st.active) return;
      if (!res.ok) {
        toast(errorMessage(res.data, 'Could not load the experiment to clone'), 'error');
        return;
      }
      const data = res.data || {};
      let spec = isPlainObject(data.spec) ? data.spec : {};
      let envIds = Array.isArray(data.environment_ids) ? data.environment_ids.slice() : [];
      const notes = [];
      let job = jobId && data.base_source && data.base_source.job_id === jobId ? jobId : null;
      if (jobId && !job) {
        // Without ?job_id= support: take the job's qym_config from the detail.
        const detail = await request(projectPath('/experiments/' + encodeURIComponent(experimentId)));
        if (!st.active) return;
        const row = detail.ok ? (detail.data.jobs || []).find((j) => j.id === jobId) : null;
        if (row && isPlainObject(row.qym_config)) {
          const q = row.qym_config;
          spec = { evaluator: q.evaluator || {}, slot_bindings: q.slot_bindings || {}, env_overrides: q.env_overrides || {} };
          envIds = envIds.indexOf(row.environment_id) >= 0 ? [row.environment_id] : [];
          job = row.id;
        } else {
          notes.push('That job\'s configuration was not found, so the whole experiment is cloned.');
        }
      }
      const unavailable = (data.unavailable_environment_ids || []).length;
      if (unavailable) {
        notes.push(unavailable + ' environment' + (unavailable === 1 ? ' of the original is' : 's of the original are') + ' disabled or gone and ' + (unavailable === 1 ? 'was' : 'were') + ' left out.');
      }
      const bindings = isPlainObject(spec.slot_bindings) ? spec.slot_bindings : {};
      const temporary = Object.keys(bindings).filter((k) => {
        const b = bindings[k];
        return (isSweepValue(b) ? b.sweep : [b]).some((x) => isPlainObject(x) && isPlainObject(x.temporary));
      });
      if (temporary.length) {
        notes.push('Temporary models are copied without their API keys: re-enter each key under Models (' + temporary.join(', ') + ').');
      }
      if (containsSweep(spec)) notes.push('Swept values are kept as they were, so the same combinations are launched.');
      const sourceName = String(data.name || '').replace(/ \((copy|rerun)\)$/, '');
      st.clone = {
        experimentId,
        jobId: job,
        spec: deepCopy(spec),
        linkedGroups: !job && Array.isArray(spec.links) ? deepCopy(spec.links) : undefined,
        sourceName,
        notes,
      };
      st.name = String(data.name || '').slice(0, 200);
      if (data.priority) st.priority = data.priority;
      st.selected = envIds;
      st.base = 'clone';
      st.baseTouched = true;
    }

    // ── Spec (the §8.1 document) ────────────────────────────────────────
    function datasetValue() {
      return st.datasetMode === 'custom' ? st.customDataset.trim() : st.datasetName;
    }

    /** Hook for sweeps (#34): a field's spec value; today always the single value. */
    function specValue(value) {
      return value;
    }

    function buildSpec() {
      // Base evaluator inputs (samples, report_k, …) ride along unchanged (#31).
      const evaluator = Object.assign(deepCopy(st.evaluatorExtra) || {}, { dataset: datasetValue() || null });
      if (st.datasetMode === 'project' && st.datasetRef) {
        if (st.datasetRef.indexOf('v:') === 0) evaluator.dataset_version = st.datasetRef.slice(2);
        else if (st.datasetRef.indexOf('a:') === 0) evaluator.config = Object.assign({}, evaluator.config, { dataset_alias: st.datasetRef.slice(2) });
      }
      const bindings = {};
      Object.keys(st.bindings).forEach((key) => {
        const b = st.bindings[key];
        bindings[key] = specValue(b.kind === 'connection' ? { connection_id: b.id } : b.kind === 'raw' ? b.value : b.binding);
      });
      const values = {};
      Object.keys(st.values).forEach((p) => { values[p] = specValue(st.values[p]); });
      const spec = { evaluator, slot_bindings: bindings, env_overrides: buildOverrides(values) };
      if (st.links) spec.links = deepCopy(st.links); // a cloned sweep's linked groups
      if (advanced) advanced.decorateSpec(spec);
      return spec;
    }

    function buildRequest(dryRun) {
      const spec = buildSpec();
      const refs = {};
      const save = [];
      Object.keys(st.bindings).forEach((key) => {
        const b = st.bindings[key];
        if (b.kind !== 'temporary') return;
        if (b.secretRef && has(st.secrets, b.secretRef)) refs[b.secretRef] = st.secrets[b.secretRef];
        if (b.save) save.push(key);
      });
      const body = {
        name: st.name.trim() || (dryRun ? 'Untitled experiment' : ''),
        environment_ids: st.selected.slice(),
        spec,
        base_source: baseSource(),
        dry_run: !!dryRun,
        secrets: refs,
        save_to_project_models: save,
      };
      if (st.priority) body.priority = st.priority;
      return body;
    }

    // ── Local validation ────────────────────────────────────────────────
    function localErrors() {
      const errors = [];
      if (!st.selected.length) errors.push({ pointer: '#environments', message: 'Pick at least one environment.' });
      st.selected.forEach((id) => {
        const data = st.envData[id];
        if (data && data.formError) errors.push({ pointer: '#environments', message: data.formError + ' (' + envName(id) + ')' });
      });
      if ((st.base === 'official' || st.base === 'saved') && !(st.baseInfo.loaded && st.baseInfo.versionId)) {
        errors.push({ pointer: '#base', message: st.baseInfo.loading ? 'The base is still loading.' : (st.baseInfo.error || 'The base did not load; pick another base.') });
      }
      if (!datasetValue()) errors.push({ pointer: '/evaluator/dataset', message: 'Choose a dataset or enter a custom dataset string.' });
      Object.keys(st.invalid).forEach((p) => errors.push({ pointer: '/env_overrides' + p, message: st.invalid[p].message }));
      Object.keys(st.values).forEach((p) => envsMissing(p).forEach((id) => errors.push({
        pointer: '/env_overrides' + p, environment_id: id, rule: 'not_in_environment', message: notInEnvMessage(p, id),
      })));
      if (!st.name.trim()) errors.push({ pointer: '#name', message: 'Name the experiment.' });
      if (advanced) advanced.localErrors().forEach((e) => errors.push(e));
      return errors;
    }

    // ── Preview (debounced dry run) ─────────────────────────────────────
    function schedulePreview() {
      st.launchErrors = null;
      if (advanced) advanced.onSpecChange();
      if (st.timer) clearTimeout(st.timer);
      st.timer = null;
      if (!st.active) return;
      if (!st.selected.length || st.selected.some((id) => !st.envData[id] || st.envData[id].loading)) {
        st.preview = null;
        st.previewLoading = false;
        renderPreview();
        return;
      }
      st.previewLoading = true;
      renderPreview();
      st.timer = setTimeout(runPreview, PREVIEW_DELAY_MS);
    }

    async function runPreview() {
      st.timer = null;
      const generation = ++st.generation;
      const res = await request(projectPath('/experiments'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildRequest(true)),
      });
      if (!st.active || generation !== st.generation) return;
      st.previewLoading = false;
      if (res.ok) {
        st.preview = res.data;
        st.previewError = '';
      } else {
        st.preview = null;
        st.previewError = errorMessage(res.data, 'The preview failed');
      }
      renderPreview();
    }

    function serverErrors() {
      const source = st.launchErrors || (st.preview && st.preview.errors) || [];
      const local = localErrors().map((e) => e.pointer);
      const seen = {};
      return source.filter((e) => {
        if (local.indexOf(e.pointer) >= 0) return false;
        const key = [e.pointer, e.message, e.environment_id].join('|');
        if (seen[key]) return false;
        seen[key] = true;
        return true;
      });
    }

    // ── Focus a field from an error ─────────────────────────────────────
    function findTarget(pointer) {
      if (pointer === '#environments' || pointer === '' || pointer == null) return hosts.environments;
      if (pointer === '#name') return root.querySelector('[data-xl-pointer="#name"]');
      if (pointer === '#base') return hosts.base;
      const nodes = Array.from(root.querySelectorAll('[data-xl-pointer]'));
      let best = null;
      let bestLength = -1;
      nodes.forEach((node) => {
        const p = node.getAttribute('data-xl-pointer');
        if (p === pointer) { best = node; bestLength = Infinity; return; }
        if (pointer.indexOf(p + '/') === 0 && p.length > bestLength) { best = node; bestLength = p.length; }
      });
      if (best) return best;
      if (pointer.indexOf('/slot_bindings') === 0) return hosts.models;
      if (pointer.indexOf('/evaluator') === 0) return hosts.dataset;
      return hosts.settings;
    }

    function focusError(error) {
      if (advanced) advanced.reveal(error.pointer);
      let target = findTarget(error.pointer);
      if (target && target.closest('[hidden]') && (st.search || st.changedOnly)) {
        st.search = '';
        st.changedOnly = false;
        renderSettings();
        target = findTarget(error.pointer);
      }
      if (!target) return;
      let details = target.closest('details');
      while (details) {
        details.open = true;
        details = details.parentElement ? details.parentElement.closest('details') : null;
      }
      target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      if (typeof target.focus === 'function') target.focus({ preventScroll: true });
      target.classList.add('xl-flash');
      setTimeout(() => target.classList.remove('xl-flash'), 1600);
    }

    // ── Section: environments ───────────────────────────────────────────
    function toggleEnv(id, on) {
      const idx = st.selected.indexOf(id);
      if (on && idx < 0) st.selected.push(id);
      if (!on && idx >= 0) st.selected.splice(idx, 1);
      renderEnvironments();
      loadSelectedEnvData();
    }

    function openNewEnvironment() {
      const api = window.QymEvalEnvironments;
      if (!api || !api.openAddDialog) return;
      api.openAddDialog({
        projectId: project.id,
        onChange: (env) => { if (st.active) loadEnvironments(env && env.id); },
        onGotoApiKeys: () => {
          const url = appRoot() + 'projects/' + encodeURIComponent(opts.slug || project.slug) + '/settings';
          if (window.QymShell && window.QymShell.navigateTo) window.QymShell.navigateTo(url);
          else window.location.href = url;
        },
      });
    }

    function renderEnvironments() {
      const host = hosts.environments;
      if (!host) return;
      const body = host.querySelector('[data-xl-body]');
      const children = [];
      if (st.envsError) children.push(el('div', { className: 'xl-error-text', role: 'alert', text: st.envsError }));
      if (!st.envs.length && !st.envsError) {
        children.push(el('div', { className: 'xl-hint', text: isManager
          ? 'No environments yet. Add one to launch experiments.'
          : 'No environments yet. Ask a project manager to add one.' }));
      }
      if (st.envs.length) {
        children.push(el('div', { className: 'xl-env-list', role: 'group', 'aria-label': 'Environments' }, st.envs.map((env) => {
          const selected = st.selected.indexOf(env.id) >= 0;
          const tags = [];
          const health = env.health_status === 'ok' ? ['Healthy', 'success'] : env.health_status === 'error' ? ['Unreachable', 'danger'] : ['Health unknown', null];
          tags.push(tag(health[0], health[1], env.health_status === 'error' && env.health_error ? env.health_error : null));
          if (!env.schema_hash) tags.push(tag('No schema', 'danger'));
          if (env.model_slots && env.model_slots.needs_confirmation) tags.push(tag('Needs LLM grouping', 'warning'));
          tags.push(tag('max ' + env.max_priority, null, 'Highest priority allowed on this environment'));
          if (hasOfficial(env)) tags.push(tag('official v' + env.official_preset_version, 'version', 'Published official defaults'));
          return el('label', { className: 'xl-env-option' + (selected ? ' xl-env-option--selected' : '') }, [
            el('input', { type: 'checkbox', checked: selected, 'data-xl-env': env.id, onChange: (e) => toggleEnv(env.id, e.target.checked) }),
            el('span', null, [
              el('div', { className: 'xl-env-name', text: env.name }),
              el('div', { className: 'xl-env-sub' }, tags),
            ]),
          ]);
        })));
      }
      body.replaceChildren.apply(body, children);
    }

    // ── Section: dataset ────────────────────────────────────────────────
    function renderDataset() {
      const host = hosts.dataset;
      if (!host) return;
      const body = host.querySelector('[data-xl-body]');
      const modes = el('div', { className: 'qym-segmented', role: 'group', 'aria-label': 'Dataset source' }, [
        ['project', 'Project dataset'], ['custom', 'Custom string'],
      ].map(([mode, label]) => el('button', {
        type: 'button',
        className: 'qym-segmented__option' + (st.datasetMode === mode ? ' active' : ''),
        'aria-pressed': st.datasetMode === mode ? 'true' : 'false',
        disabled: mode === 'project' && st.datasets && !st.datasets.length,
        text: label,
        onClick: () => { st.datasetMode = mode; renderDataset(); renderPreview(); schedulePreview(); },
      })));
      const children = [modes];
      if (st.datasetMode === 'project') {
        if (!st.datasets) {
          children.push(el('div', { className: 'xl-hint', text: 'Loading datasets…' }));
        } else {
          const datasetSelect = el('select', {
            className: 'qym-control qym-select xl-grow', 'aria-label': 'Dataset', 'data-xl-pointer': '/evaluator/dataset',
            onChange: (e) => {
              st.datasetName = e.target.value;
              st.datasetRef = '';
              loadVersions(st.datasetName);
              renderDataset();
              schedulePreview();
            },
          }, [el('option', { value: '', text: 'Choose a dataset…' })].concat(st.datasets.map((ds) => el('option', {
            value: ds.name, selected: ds.name === st.datasetName, text: ds.name,
          }))));
          const info = st.versions[st.datasetName];
          const versionOptions = [el('option', { value: '', text: 'Latest version' })];
          if (info && !info.loading) {
            info.aliases.forEach((alias) => versionOptions.push(el('option', { value: 'a:' + alias, selected: st.datasetRef === 'a:' + alias, text: 'Alias: ' + alias })));
            info.versions.forEach((v) => versionOptions.push(el('option', { value: 'v:' + v.version, selected: st.datasetRef === 'v:' + v.version, text: v.version + (v.status ? ' · ' + String(v.status).toLowerCase() : '') })));
          }
          const versionSelect = el('select', {
            className: 'qym-control qym-select', 'aria-label': 'Dataset version or alias', 'data-xl-pointer': '/evaluator/dataset_version',
            disabled: !st.datasetName,
            onChange: (e) => { st.datasetRef = e.target.value; schedulePreview(); },
          }, versionOptions);
          children.push(el('div', { className: 'xl-row' }, [datasetSelect, versionSelect]));
        }
      } else {
        children.push(el('input', {
          className: 'qym-control qym-input xl-wide xl-mono', type: 'text', maxlength: '2000',
          placeholder: 'e.g. playground_set_v2', 'aria-label': 'Custom dataset string', 'data-xl-pointer': '/evaluator/dataset',
          value: st.customDataset,
          onInput: (e) => { st.customDataset = e.target.value; renderPreviewSoon(); schedulePreview(); },
        }));
        children.push(el('div', { className: 'xl-hint', text: 'Sent as evaluator.dataset, following the service\'s dataset loader convention. Custom strings are never ranked as best runs.' }));
      }
      if (st.datasetsError) children.push(el('div', { className: 'xl-hint', text: st.datasetsError }));
      body.replaceChildren.apply(body, children);
    }

    // ── Section: start from ─────────────────────────────────────────────
    function renderBase() {
      const host = hosts.base;
      if (!host) return;
      const body = host.querySelector('[data-xl-body]');
      const options = BASE_OPTIONS.concat(st.clone ? [CLONE_OPTION] : []);
      const children = [el('div', { className: 'qym-segmented', role: 'group', 'aria-label': 'Start from', 'data-xl-base': '1' }, options.map((opt) => {
        const active = st.base === opt.kind;
        const avail = opt.available ? baseAvailability(opt.kind) : { ok: false, reason: 'Coming soon' };
        return el('button', {
          type: 'button',
          className: 'qym-segmented__option' + (active ? ' active' : ''),
          'aria-pressed': active ? 'true' : 'false',
          'data-base': opt.kind,
          disabled: !active && !avail.ok,
          title: avail.ok ? null : (avail.reason || null),
          text: opt.label,
          onClick: () => { if (!active && avail.ok) chooseBase(opt.kind); },
        });
      }))];
      const presetBase = st.base === 'official' || st.base === 'saved';
      if (presetBase && st.selected.length > 1) {
        // Presets belong to one environment; the others validate the same config.
        children.push(el('div', { className: 'xl-row' }, [
          el('span', { className: 'xl-hint', text: 'Presets from' }),
          el('select', {
            className: 'qym-control qym-select', 'aria-label': 'Environment whose presets are the base', 'data-xl-base-env': '1',
            onChange: (e) => {
              const previous = st.baseEnv;
              st.baseEnv = e.target.value;
              chooseBase(st.base, true).then((ok) => { if (!ok) { st.baseEnv = previous; renderBase(); } });
            },
          }, selectedEnvs().map((env) => el('option', {
            value: env.id, selected: env.id === st.baseEnv,
            disabled: st.base === 'official' && !hasOfficial(env),
            text: env.name + (hasOfficial(env) ? ' · official v' + env.official_preset_version : ''),
          }))),
        ]));
      }
      if (st.base === 'saved') {
        const presets = presetsFor(st.baseEnv);
        children.push(el('select', {
          className: 'qym-control qym-select xl-wide', 'aria-label': 'Saved preset', 'data-xl-saved-preset': '1',
          onChange: (e) => {
            const previous = st.savedPresetId;
            st.savedPresetId = e.target.value;
            chooseBase('saved', true).then((ok) => { if (!ok) { st.savedPresetId = previous; renderBase(); } });
          },
        }, (presets ? presets.saved : []).map((p) => el('option', {
          value: p.id, selected: p.id === st.savedPresetId, text: p.name + ' · v' + p.current_version.version,
        }))));
      }
      children.push(baseStatus());
      body.replaceChildren.apply(body, children);
      updateBaseMeta();
    }

    const BASE_HINTS = {
      official: 'The environment\'s published defaults. Your edits are layered on top: a changed setting shows a dot and resets to the base value.',
      saved: 'A saved preset of this environment. Your edits are layered on top: a changed setting shows a dot and resets to the base value.',
      clone: 'A copy of an earlier experiment\'s configuration. Your edits are layered on top: a changed setting shows a dot and resets to the base value.',
      blank: 'Blank starts from the environment\'s own settings: only what you change below is sent.',
    };

    function listCallout(tone, title, items, attr) {
      const attrs = { className: 'xl-callout' + (tone ? ' xl-callout--' + tone : ''), role: tone === 'error' ? 'alert' : 'note' };
      if (attr) attrs[attr] = '1';
      return el('div', attrs, [el('div', null, [
        title ? el('strong', { text: title }) : null,
        items.length ? el('ul', { className: 'xl-callout-list' }, items.map((text) => el('li', { text }))) : null,
      ])]);
    }

    function baseStatus() {
      const info = st.baseInfo || {};
      const children = [];
      if (info.loading) {
        children.push(el('div', { className: 'xl-hint', text: 'Loading the base…' }));
      } else {
        children.push(el('div', { className: 'xl-row' }, [
          el('span', { className: 'xl-base-label', 'data-xl-base-label': '1', text: baseLabel() }),
          el('span', { className: 'xl-hint xl-mono', 'data-xl-diff-count': '1', text: diffText() }),
          el('span', { className: 'xl-spacer' }),
          st.base !== 'blank' ? el('button', { type: 'button', className: 'xl-link-btn', 'data-xl-reset-base': '1', text: 'Reset all to base', onClick: resetAllToBase }) : null,
        ]));
      }
      children.push(el('div', { className: 'xl-hint', text: BASE_HINTS[st.base] || '' }));
      if (info.releaseNotes) children.push(el('div', { className: 'xl-hint xl-base-notes', text: 'Release notes: ' + info.releaseNotes }));
      if (st.baseNote) children.push(el('div', { className: 'xl-callout', role: 'note', 'data-xl-base-note': '1', text: st.baseNote }));
      if (info.error) children.push(el('div', { className: 'xl-callout xl-callout--error', role: 'alert', text: info.error }));
      if (info.dropped && info.dropped.length) {
        children.push(listCallout('warning', info.summary || 'Some settings are no longer supported',
          info.dropped.map((d) => (d.label || d.pointer) + ': ' + (d.message || d.reason || 'dropped')), 'data-xl-remap-dropped'));
      }
      if (info.errors && info.errors.length) {
        children.push(listCallout('error', 'The base does not fit the environment\'s current schema', info.errors.map((e) => e.message || e.pointer || 'Invalid value')));
      }
      const warnings = (info.warnings || []).map((w) => w.message || '').filter(Boolean).concat(info.notes || []);
      if (warnings.length) children.push(listCallout('warning', 'Check before launching', warnings, 'data-xl-base-warnings'));
      return el('div', { className: 'xl-base-status', 'data-xl-base-status': '1' }, children);
    }

    function updateBaseMeta() {
      const meta = root.querySelector('[data-xl-base-meta]');
      if (meta) meta.textContent = 'Base: ' + baseLabel();
      root.querySelectorAll('[data-xl-diff-count]').forEach((node) => { node.textContent = diffText(); });
    }

    // ── Section: models ─────────────────────────────────────────────────
    function renderModels() {
      const host = hosts.models;
      if (!host) return;
      const body = host.querySelector('[data-xl-body]');
      const children = [];
      const pending = st.selected.filter((id) => st.envData[id] && st.envData[id].needsConfirmation);
      if (pending.length) {
        const banner = el('div', { className: 'xl-callout xl-callout--warning', role: 'note', 'data-xl-group-banner': '1' }, [
          el('div', null, [
            el('strong', { text: 'Group LLM settings to pick project models' }),
            el('div', { text: 'On ' + pending.map(envName).join(', ') + ', LLM fields stay raw inputs under Settings until their grouping is confirmed.' }),
          ]),
        ]);
        if (isManager && window.QymEvalEnvironments && window.QymEvalEnvironments.openEnvironmentDrawer) {
          banner.appendChild(el('button', {
            type: 'button', className: 'qym-inline-action qym-inline-action--neutral', text: 'Group LLM settings',
            onClick: () => window.QymEvalEnvironments.openEnvironmentDrawer({
              projectId: project.id, env: envById(pending[0]), canManage: true,
              onChange: () => { if (!st.active) return; pending.forEach((id) => delete st.envData[id]); loadEnvironments(); },
            }),
          }));
        }
        children.push(banner);
      }
      const slots = unionSlots();
      if (!st.selected.length) {
        children.push(el('div', { className: 'xl-hint', text: 'Pick an environment to see its model slots.' }));
      } else if (st.selected.some((id) => !st.envData[id] || st.envData[id].loading)) {
        children.push(el('div', { className: 'xl-hint', text: 'Loading model slots…' }));
      } else if (!slots.length) {
        children.push(el('div', { className: 'xl-hint', text: 'No confirmed model slots. LLM fields are edited under Settings.' }));
      } else {
        st.selected.forEach((id) => {
          const err = st.envData[id] && st.envData[id].optionsError;
          if (err) children.push(el('div', { className: 'xl-error-text', text: err + ' (' + envName(id) + ')' }));
        });
        children.push(el('div', { className: 'xl-models' }, slots.map(modelCard)));
      }
      body.replaceChildren.apply(body, children);
    }

    /** A temporary model from a base (clone or preset) comes without its key (§7.5). */
    function reenterKey(slot, binding) {
      const keys = temporaryKeys();
      if (!keys.allowed) return el('div', { className: 'xl-hint', text: 'Its API key was not copied. ' + keys.reason });
      const input = el('input', {
        className: 'qym-control qym-input xl-grow', type: 'password', autocomplete: 'off', spellcheck: 'false',
        placeholder: 'API key', 'aria-label': 'API key for ' + slot.label, 'data-xl-reenter-key': slot.slot_key,
      });
      const use = el('button', {
        type: 'button', className: 'qym-inline-action qym-inline-action--neutral', text: 'Use key',
        onClick: () => {
          const key = input.value.trim();
          input.value = '';
          if (!key) return;
          const ref = 'tmp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
          binding.binding = { temporary: Object.assign({}, binding.binding.temporary, { api_key: { $secret: ref } }) };
          binding.secretRef = ref;
          st.secrets[ref] = key; // memory only, like keys typed in the temporary-model form
          renderModels();
          schedulePreview();
        },
      });
      return el('div', { className: 'xl-model-key' }, [
        el('div', { className: 'xl-hint', text: 'Its API key was not copied. Enter it again, or launch without a key.' }),
        el('div', { className: 'xl-row' }, [input, use]),
      ]);
    }

    function modelCard(slot) {
      const binding = st.bindings[slot.slot_key];
      const connections = slotConnections(slot);
      const missing = st.selected.filter((id) => slot.envs.indexOf(id) < 0 && st.envData[id] && st.envData[id].form);
      const changed = bindingChanged(slot.slot_key);
      const head = el('div', { className: 'xl-model-head' }, [
        changed ? el('span', { className: 'xl-dot', title: 'Changed from the base', 'data-xl-binding-changed': '1' }) : null,
        el('span', { className: 'xl-model-title', text: slot.label }),
        tag(slot.slot_key, 'data'),
        slot.required ? tag('required', 'role') : null,
      ].concat(missing.map((id) => tag('not in ' + envName(id), 'warning'))).concat(changed ? [
        el('span', { className: 'xl-spacer' }),
        el('button', {
          type: 'button', className: 'xl-link-btn', text: 'Reset', 'aria-label': 'Reset ' + slot.label + ' to the base model',
          onClick: () => {
            const base = st.baseline.bindings[slot.slot_key];
            setBinding(slot.slot_key, base ? deepCopy(base) : null);
          },
        }),
      ] : []));
      const fills = Object.keys(slot.field_map).map((role) => ROLE_LABELS[role] || role).join(', ');

      const select = el('select', {
        className: 'qym-control qym-select xl-wide', 'aria-label': slot.label + ' model',
        'data-xl-pointer': '/slot_bindings/' + escSeg(slot.slot_key),
        'data-xl-slot': slot.slot_key,
        onChange: (e) => {
          const value = e.target.value;
          if (value === '__inherit') setBinding(slot.slot_key, null);
          else if (value === '__temporary' || value === '__raw') { /* unchanged */ }
          else setBinding(slot.slot_key, { kind: 'connection', id: value });
        },
      });
      select.appendChild(el('option', { value: '__inherit', selected: !binding, text: 'Inherit (the worker\'s own setting)' }));
      const group = el('optgroup', { label: 'Project models' });
      connections.forEach((conn) => {
        const label = conn.name + (conn.model ? ' · ' + conn.model : '') + (conn.available ? '' : ' — ' + conn.reasons.join('; '));
        group.appendChild(el('option', {
          value: conn.id, disabled: !conn.available,
          selected: !!(binding && binding.kind === 'connection' && binding.id === conn.id), text: label,
        }));
      });
      if (!connections.length) group.appendChild(el('option', { value: '', disabled: true, text: 'No project models are available for experiments' }));
      select.appendChild(group);
      if (binding && binding.kind === 'temporary') {
        select.appendChild(el('option', { value: '__temporary', selected: true, text: bindingSummary(slot.slot_key) }));
      }
      if (binding && binding.kind === 'raw') {
        // A cloned model sweep: kept as is until a model is picked.
        select.appendChild(el('option', { value: '__raw', selected: true, text: bindingSummary(slot.slot_key) }));
      }

      const children = [head, el('div', { className: 'xl-hint', text: 'Fills ' + (fills || 'no fields') + '.' }), select];
      if (binding && binding.kind === 'temporary') {
        const chip = el('span');
        // renderChip escapes every value (eval_temporary_model.js).
        chip.innerHTML = window.QymTemporaryModel ? window.QymTemporaryModel.renderChip(binding.binding) : '';
        children.push(el('div', { className: 'xl-model-bound' }, [
          chip,
          binding.save ? tag('will be saved to project models', 'accent') : null,
          binding.secretRef ? null : tag('no API key', null),
          el('button', { type: 'button', className: 'xl-link-btn', text: 'Remove', onClick: () => setBinding(slot.slot_key, null) }),
        ]));
        if (binding.needsKey && !binding.secretRef) children.push(reenterKey(slot, binding));
      }
      if (st.tempFormFor === slot.slot_key && window.QymTemporaryModel) {
        const keys = temporaryKeys();
        children.push(window.QymTemporaryModel.createForm({
          keysAllowed: keys.allowed,
          keysReason: keys.reason,
          canSaveToProject: isManager,
          onAdd: (result) => {
            st.tempFormFor = null;
            const next = { kind: 'temporary', binding: result.binding, secretRef: result.secretRef, save: !!result.saveToProject };
            setBinding(slot.slot_key, next);
            // setBinding cleared the previous ref; keep only this one's key, in memory.
            if (result.secretRef && result.apiKey) st.secrets[result.secretRef] = result.apiKey;
            schedulePreview();
          },
          onCancel: () => { st.tempFormFor = null; renderModels(); },
        }));
      } else if (window.QymTemporaryModel) {
        children.push(el('div', null, [el('button', {
          type: 'button', className: 'qym-inline-action qym-inline-action--neutral', text: '+ Temporary model',
          onClick: () => { st.tempFormFor = slot.slot_key; renderModels(); },
        })]));
      }
      return el('div', { className: 'xl-model-card', 'data-xl-model-card': slot.slot_key }, children);
    }

    // ── Section: settings (generated from the descriptor) ───────────────
    function parseInput(entry, raw) {
      const type = entry.type;
      if (type === 'boolean') return raw === '' ? { unset: true } : { value: raw === 'true' };
      if (type === 'enum') return raw === '' ? { unset: true } : { value: (entry.enum || [])[Number(raw)] };
      const text = String(raw);
      if (entry.widget === 'endpoint-ref') return text === '' ? { unset: true } : { value: text };
      if (type === 'integer' || type === 'number') {
        const trimmed = text.trim();
        if (!trimmed) return { unset: true };
        const num = Number(trimmed);
        if (!Number.isFinite(num)) return { error: 'Enter a number' };
        if (type === 'integer' && !Number.isInteger(num)) return { error: 'Enter a whole number' };
        return { value: num };
      }
      if (type === 'json' || type === 'array' || type === 'object') {
        if (!text.trim()) return { unset: true };
        try { return { value: JSON.parse(text) }; } catch (_) { return { error: 'Enter valid JSON' }; }
      }
      return text === '' ? { unset: true } : { value: text };
    }

    function collectionKeys(entry, concrete) {
      const keys = (entry.required_keys || []).slice();
      if (entry.key_param === 'endpoint' || /\/endpoints$/.test(concrete)) {
        unionSlots().forEach((slot) => {
          const match = /^endpoint:(.+)$/.exec(slot.slot_key);
          if (match && keys.indexOf(match[1]) < 0) keys.push(match[1]);
        });
      }
      (st.addedKeys[concrete] || []).forEach((key) => { if (keys.indexOf(key) < 0) keys.push(key); });
      Object.keys(st.values).forEach((p) => {
        if (p.indexOf(concrete + '/') !== 0) return;
        const key = splitPointer(p.slice(concrete.length))[0];
        if (key != null && keys.indexOf(key) < 0) keys.push(key);
      });
      return keys;
    }

    function endpointOptions(entry, fields) {
      const collection = entry.ref_collection && fields[entry.ref_collection];
      if (!collection) return [];
      return collectionKeys(collection, entry.ref_collection);
    }

    function markChanged(wrapper, pointer) {
      if (!wrapper) return;
      const changed = isChanged(pointer);
      const missing = has(st.values, pointer) ? envsMissing(pointer) : [];
      const note = missing.map((id) => notInEnvMessage(pointer, id)).join(' ');
      if (wrapper.tagName === 'TD') {
        wrapper.classList.toggle('xl-cell--changed', changed);
        wrapper.classList.toggle('xl-cell--error', !!missing.length);
        if (missing.length) wrapper.title = note;
        else wrapper.removeAttribute('title');
      } else {
        wrapper.classList.toggle('xl-field--changed', changed);
        wrapper.classList.toggle('xl-field--error', has(st.invalid, pointer) || !!missing.length);
        let inline = wrapper.querySelector('[data-xl-env-error]');
        if (missing.length && !inline) wrapper.appendChild(inline = el('div', { className: 'xl-error-text', role: 'alert', 'data-xl-env-error': '1' }));
        if (inline && !missing.length) inline.remove();
        else if (inline) inline.textContent = note;
      }
    }

    function onLeafInput(entry, pointer, control, wrapper) {
      const parsed = parseInput(entry, control.value);
      delete st.invalid[pointer];
      if (parsed.unset) delete st.values[pointer];
      else if (parsed.error) { delete st.values[pointer]; st.invalid[pointer] = { message: parsed.error, raw: control.value }; }
      else st.values[pointer] = parsed.value;
      markChanged(wrapper, pointer);
      updateChangedCount();
      renderPreviewSoon();
      schedulePreview();
    }

    function leafControl(entry, pointer, fields, bound, label) {
      const docPointer = '/env_overrides' + pointer;
      const current = has(st.values, pointer) ? st.values[pointer] : undefined;
      const placeholder = bound ? 'Set by ' + bound
        : entry.has_default ? 'Default: ' + formatValue(entry.default) : 'Inherited from environment';
      const common = { 'data-xl-pointer': docPointer, 'aria-label': label, disabled: !!bound, title: bound ? 'Filled by the ' + bound + ' model' : null };
      let control;
      if (isSweepValue(current)) {
        // A swept value from a cloned experiment: launched as is (sweep editing is #34).
        control = el('input', Object.assign({}, common, {
          className: 'qym-control qym-input xl-wide xl-mono', type: 'text', disabled: true,
          title: 'Swept values from the cloned experiment; they are launched as they are',
        }));
        control.value = 'Sweep: ' + current.sweep.map(formatValue).join(', ');
        return control;
      }
      if (entry.secret || entry.widget === 'secret') {
        control = el('input', Object.assign({}, common, {
          className: 'qym-control qym-input xl-wide', type: 'text', disabled: true,
          placeholder: bound ? placeholder : 'Keys are set through model slots',
        }));
        return control;
      }
      if (entry.type === 'boolean') {
        control = el('select', Object.assign({}, common, { className: 'qym-control qym-select xl-wide' }), [
          el('option', { value: '', text: bound ? placeholder : (entry.has_default ? 'Default (' + formatValue(entry.default) + ')' : 'Inherit') }),
          el('option', { value: 'true', selected: current === true, text: 'true' }),
          el('option', { value: 'false', selected: current === false, text: 'false' }),
        ]);
      } else if (entry.type === 'enum') {
        const values = entry.enum || [];
        control = el('select', Object.assign({}, common, { className: 'qym-control qym-select xl-wide' }),
          [el('option', { value: '', text: bound ? placeholder : (entry.has_default ? 'Default (' + formatValue(entry.default) + ')' : 'Inherit') })]
            .concat(values.map((v, i) => el('option', { value: String(i), selected: current !== undefined && JSON.stringify(current) === JSON.stringify(v), text: formatValue(v) }))));
      } else if (entry.widget === 'endpoint-ref') {
        const keys = endpointOptions(entry, fields);
        if (typeof current === 'string' && keys.indexOf(current) < 0) keys.push(current);
        control = el('select', Object.assign({}, common, { className: 'qym-control qym-select xl-wide xl-mono' }),
          [el('option', { value: '', text: 'Inherit' })].concat(keys.map((k) => el('option', { value: k, selected: current === k, text: k }))));
      } else if (entry.type === 'json' || entry.type === 'array' || entry.type === 'object') {
        control = el('textarea', Object.assign({}, common, { className: 'xl-textarea', spellcheck: 'false', placeholder }));
        control.value = has(st.invalid, pointer) ? st.invalid[pointer].raw
          : current === undefined ? '' : JSON.stringify(current, null, 2);
      } else {
        const numeric = entry.type === 'integer' || entry.type === 'number';
        const mono = numeric || entry.widget === 'model-name' || entry.widget === 'url';
        control = el('input', Object.assign({}, common, {
          className: 'qym-control qym-input xl-wide' + (mono ? ' xl-mono' : ''),
          type: 'text', inputmode: numeric ? 'decimal' : null, spellcheck: 'false', placeholder,
        }));
        control.value = has(st.invalid, pointer) ? st.invalid[pointer].raw
          : current === undefined ? '' : String(current);
      }
      return control;
    }

    function hintText(entry) {
      const parts = [];
      if (entry.hints && entry.hints.text) parts.push(entry.hints.text);
      else if (entry.description) parts.push(entry.description);
      const b = entry.bounds || {};
      const range = [];
      if (b.minimum != null) range.push('≥ ' + b.minimum);
      if (b.exclusiveMinimum != null) range.push('> ' + b.exclusiveMinimum);
      if (b.maximum != null) range.push('≤ ' + b.maximum);
      if (b.exclusiveMaximum != null) range.push('< ' + b.exclusiveMaximum);
      if (range.length) parts.push('Range ' + range.join(', ') + '.');
      return parts.join(' ');
    }

    function missingFrom(model, template) {
      if (model.envs.length < 2) return [];
      const present = model.presence[template] || [];
      return model.envs.filter((id) => present.indexOf(id) < 0);
    }

    function renderLeaf(model, template, pointer, bound, context) {
      const entry = model.fields[template];
      const missing = missingFrom(model, template);
      const label = (context ? context + ' · ' : '') + (entry.label || entry.name);
      const wrapper = el('div', { className: 'xl-field', 'data-xl-leaf': pointer });
      const control = leafControl(entry, pointer, model.fields, bound[pointer], label);
      const handler = () => onLeafInput(entry, pointer, control, wrapper);
      control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', handler);
      const reset = el('button', {
        type: 'button', className: 'xl-link-btn xl-reset', text: 'Reset', title: 'Reset to the base value',
        onClick: () => {
          delete st.invalid[pointer];
          if (has(st.baseline.values, pointer)) st.values[pointer] = deepCopy(st.baseline.values[pointer]);
          else delete st.values[pointer];
          renderSettings();
          updateChangedCount();
          renderPreviewSoon();
          schedulePreview();
        },
      });
      const head = el('div', { className: 'xl-field-head' }, [
        el('span', { className: 'xl-dot', 'aria-hidden': 'true' }),
        el('label', { className: 'xl-field-label', text: entry.label || entry.name }),
        entry.label && entry.label !== entry.name ? el('span', { className: 'xl-field-name', text: entry.name }) : null,
        entry.required ? tag('required', 'role') : null,
        bound[pointer] ? tag('slot: ' + bound[pointer], 'accent') : null,
      ].concat(missing.map((id) => tag('not in ' + envName(id), 'warning'))).concat([el('span', { className: 'xl-spacer' }), bound[pointer] ? null : reset]));
      const id = 'xl-f-' + Math.random().toString(36).slice(2, 10);
      control.id = id;
      head.querySelector('label').setAttribute('for', id);
      const hint = hintText(entry);
      wrapper.appendChild(head);
      wrapper.appendChild(control);
      if (hint) wrapper.appendChild(el('div', { className: 'xl-hint', text: hint }));
      wrapper.setAttribute('data-xl-search', [label, entry.name, pointer, entry.description || ''].join(' ').toLowerCase());
      markChanged(wrapper, pointer);
      return wrapper;
    }

    /** Flattened leaf columns of a role table: [{template, label}]. */
    function roleColumns(model, table) {
      const cols = [];
      (table.columns || []).forEach((template) => {
        const entry = model.fields[template];
        if (!entry) return;
        if (entry.kind === 'field') cols.push({ template, label: entry.name });
        else (entry.children || []).forEach((child) => {
          const c = model.fields[child];
          if (c && c.kind === 'field') cols.push({ template: child, label: entry.name + '.' + c.name });
        });
      });
      return cols;
    }

    function renderRoleTable(model, table, bound) {
      // With the Advanced panel, roles are edited in its Role overrides tab only.
      if (advanced) return advanced.roleTableSummary(model, table);
      const cols = roleColumns(model, table);
      const head = el('tr', null, [el('th', { text: table.row_param || 'role' })].concat(cols.map((c) => el('th', { className: 'xl-mono', text: c.label }))));
      const rows = (table.rows || []).map((row) => {
        const absent = model.envs.length > 1 ? envsMissing(row.pointer) : [];
        const name = absent.length ? el('span', { className: 'xl-row' }, [el('span', { text: row.key })].concat(absent.map((id) => tag('not in ' + envName(id), 'warning')))) : row.key;
        const cells = [el('td', { className: 'xl-role-name', title: row.description || null }, [name])];
        const pointers = [];
        cols.forEach((col) => {
          const pointer = childPointer(table.pointer, row.pointer, col.template);
          pointers.push(pointer);
          const entry = model.fields[col.template];
          const td = el('td');
          const control = leafControl(entry, pointer, model.fields, bound[pointer], row.key + ' · ' + col.label);
          control.addEventListener(control.tagName === 'SELECT' ? 'change' : 'input', () => onLeafInput(entry, pointer, control, td));
          td.appendChild(control);
          markChanged(td, pointer);
          cells.push(td);
        });
        const tr = el('tr', { 'data-xl-row': row.key, 'data-xl-pointer': '/env_overrides' + row.pointer }, cells);
        tr.setAttribute('data-xl-search', [row.key, row.label || '', row.description || ''].concat(cols.map((c) => c.label)).join(' ').toLowerCase());
        tr._xlPointers = pointers;
        return tr;
      });
      return el('div', { className: 'xl-object', 'data-xl-container': '1' }, [
        el('div', { className: 'xl-object-title' }, [el('span', { text: 'Roles' }), tag(String(rows.length), 'count')]),
        el('div', { className: 'xl-hint', text: 'One row per role; leave a cell on Inherit to keep the environment value.' }),
        el('div', { className: 'xl-table-wrap' }, [el('table', { className: 'xl-role-table' }, [el('thead', null, [head]), el('tbody', null, rows)])]),
      ]);
    }

    function renderCollection(model, entry, pointer, bound) {
      const keys = collectionKeys(entry, pointer);
      const required = entry.required_keys || [];
      const item = entry.item_pointer && model.fields[entry.item_pointer];
      const blocks = keys.map((key) => {
        const itemPointer = pointer + '/' + escSeg(key);
        const title = el('div', { className: 'xl-object-title' }, [
          el('span', { className: 'xl-mono', text: key }),
          required.indexOf(key) >= 0 ? tag('required', 'role') : null,
          required.indexOf(key) < 0 && (st.addedKeys[pointer] || []).indexOf(key) >= 0 ? el('button', {
            type: 'button', className: 'xl-link-btn', text: 'Remove',
            onClick: () => {
              st.addedKeys[pointer] = (st.addedKeys[pointer] || []).filter((k) => k !== key);
              Object.keys(st.values).forEach((p) => { if (p === itemPointer || p.indexOf(itemPointer + '/') === 0) delete st.values[p]; });
              Object.keys(st.invalid).forEach((p) => { if (p === itemPointer || p.indexOf(itemPointer + '/') === 0) delete st.invalid[p]; });
              renderSettings();
              schedulePreview();
            },
          }) : null,
        ]);
        const inner = item ? renderChildren(model, item, itemPointer, bound, key) : [];
        return el('div', { className: 'xl-object', 'data-xl-container': '1', 'data-xl-pointer': '/env_overrides' + itemPointer }, [title].concat(inner));
      });
      const keyInput = el('input', { className: 'qym-control qym-input xl-mono', type: 'text', maxlength: '100', placeholder: entry.key_param || 'key', 'aria-label': 'New ' + (entry.key_param || 'entry') + ' name' });
      const addError = el('span', { className: 'xl-error-text', role: 'alert' });
      const add = el('div', { className: 'xl-row' }, [keyInput, el('button', {
        type: 'button', className: 'qym-inline-action qym-inline-action--neutral', text: '+ Add ' + (entry.key_param || 'entry'),
        onClick: () => {
          const key = keyInput.value.trim();
          addError.textContent = '';
          if (!key) { addError.textContent = 'Enter a name.'; return; }
          if (entry.key_pattern && !(new RegExp(entry.key_pattern)).test(key)) { addError.textContent = 'Invalid name.'; return; }
          if (keys.indexOf(key) >= 0) { addError.textContent = 'Already present.'; return; }
          (st.addedKeys[pointer] = st.addedKeys[pointer] || []).push(key);
          renderSettings();
        },
      }), addError]);
      return el('div', { className: 'xl-object', 'data-xl-container': '1', 'data-xl-pointer': '/env_overrides' + pointer }, [
        el('div', { className: 'xl-object-title' }, [el('span', { text: entry.label || entry.name }), el('span', { className: 'xl-field-name', text: entry.name })]),
      ].concat(blocks).concat([add]));
    }

    /** Children of an object-like entry: leaves in a grid, containers after. */
    function renderChildren(model, entry, pointer, bound, context) {
      const leaves = [];
      const containers = [];
      (entry.children || []).forEach((childTemplate) => {
        const child = model.fields[childTemplate];
        if (!child) return;
        if (child.kind === 'role_table') { containers.push(renderRoleTable(model, child, bound)); return; }
        const childConcrete = childPointer(entry.pointer, pointer, childTemplate);
        const node = renderNode(model, childTemplate, childConcrete, bound, context);
        if (child.kind === 'field') leaves.push(node);
        else containers.push(node);
      });
      const out = [];
      if (leaves.length) out.push(el('div', { className: 'xl-fields' }, leaves));
      return out.concat(containers);
    }

    function renderNode(model, template, pointer, bound, context) {
      const entry = model.fields[template];
      if (entry.kind === 'field') return renderLeaf(model, template, pointer, bound, context);
      if (entry.kind === 'collection') return renderCollection(model, entry, pointer, bound);
      if (entry.kind === 'role_table') return renderRoleTable(model, entry, bound);
      const missing = missingFrom(model, template);
      return el('div', { className: 'xl-object', 'data-xl-container': '1', 'data-xl-pointer': '/env_overrides' + pointer }, [
        el('div', { className: 'xl-object-title' }, [el('span', { text: entry.label || entry.name })].concat(missing.map((id) => tag('not in ' + envName(id), 'warning')))),
      ].concat(renderChildren(model, entry, pointer, bound, context)));
    }

    /** Settings that differ from the base (every set value on a Blank base). */
    function countChanged() {
      return changedPointers().length;
    }

    function updateChangedCount() {
      const node = root.querySelector('[data-xl-changed-count]');
      if (node) node.textContent = countChanged() + ' changed';
      updateBaseMeta();
    }

    function applyFilters() {
      const host = hosts.settings;
      if (!host) return;
      const query = st.search.trim().toLowerCase();
      const filtering = !!query || st.changedOnly;
      host.querySelectorAll('[data-xl-leaf]').forEach((node) => {
        const pointer = node.getAttribute('data-xl-leaf');
        const text = node.getAttribute('data-xl-search') || '';
        const show = (!query || text.indexOf(query) >= 0) && (!st.changedOnly || isChanged(pointer));
        node.hidden = !show;
      });
      host.querySelectorAll('[data-xl-row]').forEach((row) => {
        const text = row.getAttribute('data-xl-search') || '';
        const changed = (row._xlPointers || []).some(isChanged);
        row.hidden = !((!query || text.indexOf(query) >= 0) && (!st.changedOnly || changed));
      });
      const containers = Array.from(host.querySelectorAll('[data-xl-container]')).reverse();
      containers.forEach((node) => {
        node.hidden = false;
        if (!filtering) return;
        node.hidden = !node.querySelector('[data-xl-leaf]:not([hidden]), [data-xl-row]:not([hidden])');
      });
      host.querySelectorAll('details[data-xl-group]').forEach((details) => {
        const visible = !!details.querySelector('[data-xl-leaf]:not([hidden]), [data-xl-row]:not([hidden])');
        details.hidden = filtering && !visible;
        if (filtering && visible) details.open = true;
      });
      const empty = host.querySelector('[data-xl-filter-empty]');
      if (empty) empty.hidden = !filtering || !!host.querySelector('details[data-xl-group]:not([hidden])');
    }

    function renderSettings() {
      const host = hosts.settings;
      if (!host) return;
      const body = host.querySelector('[data-xl-body]');
      const openState = {};
      body.querySelectorAll('details[data-xl-group]').forEach((d) => { openState[d.getAttribute('data-xl-group')] = d.open; });
      const children = [];
      if (!st.selected.length) {
        body.replaceChildren(el('div', { className: 'xl-hint', text: 'Pick an environment to see its settings.' }));
        return;
      }
      if (st.selected.some((id) => !st.envData[id] || st.envData[id].loading)) {
        body.replaceChildren(el('div', { className: 'xl-hint', text: 'Loading settings…' }));
        return;
      }
      st.selected.forEach((id) => {
        const err = st.envData[id].formError;
        if (err) children.push(el('div', { className: 'xl-callout xl-callout--error', role: 'alert', text: envName(id) + ': ' + err }));
      });
      const model = union();
      if (!model.envs.length) {
        body.replaceChildren.apply(body, children);
        return;
      }
      const search = el('input', {
        className: 'qym-control qym-search xl-grow', type: 'search', placeholder: 'Search settings', 'aria-label': 'Search settings',
        value: st.search, 'data-xl-search-input': '1',
        onInput: (e) => { st.search = e.target.value; applyFilters(); },
      });
      const changedOnly = el('label', { className: 'xl-check' }, [
        el('input', { type: 'checkbox', checked: st.changedOnly, 'data-xl-changed-only': '1', onChange: (e) => { st.changedOnly = e.target.checked; applyFilters(); } }),
        'Changed only',
      ]);
      children.push(el('div', { className: 'xl-toolbar' }, [
        search, changedOnly,
        el('span', { className: 'xl-hint xl-mono', 'data-xl-changed-count': '1', text: countChanged() + ' changed' }),
        el('button', {
          type: 'button', className: 'xl-link-btn', text: 'Reset all',
          title: 'Reset every setting to the base value',
          onClick: () => {
            st.values = deepCopy(st.baseline.values);
            st.invalid = {};
            stripBoundFields(st.values, st.bindings);
            renderSettings();
            updateBaseMeta();
            schedulePreview();
          },
        }),
      ]));
      const bound = boundPointers();
      model.groups.forEach((group) => {
        const nodes = [];
        const leaves = [];
        group.pointers.forEach((template) => {
          const entry = model.fields[template];
          if (!entry) return;
          const node = renderNode(model, template, template, bound, '');
          if (entry.kind === 'field') leaves.push(node);
          else nodes.push(node);
        });
        const groupBody = el('div', { className: 'xl-group-body' }, (leaves.length ? [el('div', { className: 'xl-fields' }, leaves)] : []).concat(nodes));
        const details = el('details', { className: 'xl-group', 'data-xl-group': group.id }, [
          el('summary', null, [el('span', { text: group.label }), el('span', { className: 'xl-group-count', text: String(group.pointers.length) })]),
          groupBody,
        ]);
        details.open = has(openState, group.id) ? openState[group.id] : group.id !== 'llm_routing' || !unionSlots().length;
        children.push(details);
      });
      children.push(el('div', { className: 'xl-empty', 'data-xl-filter-empty': '1', hidden: true, text: 'No settings match.' }));
      body.replaceChildren.apply(body, children);
      applyFilters();
    }

    // ── Section: priority & name ────────────────────────────────────────
    function maxPriority() {
      const envs = selectedEnvs();
      if (!envs.length) return 'HIGH';
      return envs.map((env) => env.max_priority || 'NORMAL').reduce((a, b) => (PRIORITY_ORDER[a] <= PRIORITY_ORDER[b] ? a : b));
    }

    function highWarnings() {
      if (st.preview && st.preview.preemption_warning) return [st.preview.preemption_warning];
      const api = window.QymEvalEnvironments;
      return selectedEnvs().map((env) => (api && api.highPriorityWarning ? api.highPriorityWarning(env.name) : 'Launching at HIGH preempts other jobs on ' + env.name + '.'));
    }

    function renderRun() {
      const host = hosts.run;
      if (!host) return;
      const body = host.querySelector('[data-xl-body]');
      const cap = maxPriority();
      if (st.priority && PRIORITY_ORDER[st.priority] > PRIORITY_ORDER[cap]) st.priority = '';
      if (st.priority === 'HIGH' && !isManager) st.priority = '';
      const defaults = selectedEnvs().map((env) => env.default_priority).filter(Boolean);
      const select = el('select', {
        className: 'qym-control qym-select', 'aria-label': 'Priority', 'data-xl-priority': '1',
        onChange: (e) => { st.priority = e.target.value; renderRun(); schedulePreview(); },
      }, [el('option', { value: '', text: 'Environment default' + (defaults.length ? ' (' + defaults.reduce((a, b) => (PRIORITY_ORDER[a] <= PRIORITY_ORDER[b] ? a : b)) + ')' : '') })].concat(PRIORITIES.map((p) => {
        const overCap = PRIORITY_ORDER[p] > PRIORITY_ORDER[cap];
        const gated = p === 'HIGH' && !isManager;
        return el('option', {
          value: p, selected: st.priority === p, disabled: overCap || gated,
          text: p + (gated ? ' (managers only)' : overCap ? ' (above the environment maximum)' : ''),
        });
      })));
      const name = el('input', {
        className: 'qym-control qym-input xl-wide', type: 'text', maxlength: '200', placeholder: 'e.g. rag threshold 0.7 on staging',
        'aria-label': 'Experiment name', 'data-xl-pointer': '#name', value: st.name,
        onInput: (e) => { st.name = e.target.value; renderPreviewSoon(); schedulePreview(); },
      });
      const children = [
        el('div', null, [el('span', { className: 'xl-label', text: 'Name' }), name]),
        el('div', null, [el('span', { className: 'xl-label', text: 'Priority' }), select]),
      ];
      if (st.priority === 'HIGH') {
        children.push(el('div', { className: 'xl-callout xl-callout--warning', role: 'note', 'data-xl-high-warning': '1' },
          [el('div', null, highWarnings().map((w) => el('div', { text: w })))]));
      }
      body.replaceChildren.apply(body, children);
    }

    // ── Preview panel ───────────────────────────────────────────────────
    let previewFrame = null;
    function renderPreviewSoon() {
      if (previewFrame) return;
      previewFrame = requestAnimationFrame(() => { previewFrame = null; renderPreview(); });
    }

    function errorButton(error) {
      const where = [];
      if (error.environment_id && st.selected.length > 1) where.push(envName(error.environment_id));
      if (error.pointer && error.pointer.charAt(0) === '/') where.push(error.pointer);
      return el('li', null, [el('button', {
        type: 'button', className: 'xl-error-item', 'data-xl-error': error.pointer || '',
        onClick: () => focusError(error),
      }, [
        el('span', { text: error.message || 'Invalid value' }),
        where.length ? el('span', { className: 'xl-error-where', text: where.join(' · ') }) : null,
      ])]);
    }

    function renderPreview() {
      const host = hosts.preview;
      if (!host) return;
      const local = localErrors();
      const remote = serverErrors();
      const errors = local.concat(remote);
      const datasetText = datasetValue() ? datasetValue() + (st.datasetMode === 'project' && st.datasetRef ? ' · ' + st.datasetRef.slice(2) : '') : '—';
      const models = unionSlots().map((slot) => slot.label + ': ' + bindingSummary(slot.slot_key));
      const summary = el('dl', { className: 'xl-summary' }, [
        el('dt', { text: 'Environments' }), el('dd', { text: selectedEnvs().map((e) => e.name).join(', ') || '—' }),
        el('dt', { text: 'Dataset' }), el('dd', { className: st.datasetMode === 'custom' ? 'xl-mono' : null, text: datasetText }),
        el('dt', { text: 'Start from' }), el('dd', { 'data-xl-preview-base': '1', text: baseLabel() + ' · ' + diffText() }),
        el('dt', { text: 'Models' }), el('dd', { text: models.join('; ') || '—' }),
        el('dt', { text: 'Settings' }), el('dd', { className: 'xl-mono', text: countChanged() + ' changed' }),
        el('dt', { text: 'Priority' }), el('dd', { text: st.priority || (st.preview && st.preview.priority ? st.preview.priority + ' (default)' : 'Environment default') }),
      ]);
      const children = [summary];

      let status;
      if (!st.selected.length) status = 'Pick an environment to preview.';
      else if (st.previewLoading) status = 'Checking…';
      else if (st.previewError) status = st.previewError;
      else if (errors.length) status = errors.length + ' problem' + (errors.length === 1 ? '' : 's') + ' to fix';
      else if (st.preview) status = 'Ready to launch';
      else status = '';
      if (st.preview && !st.previewLoading) {
        const jobs = st.preview.jobs || [];
        const count = st.preview.job_count != null ? st.preview.job_count : jobs.length;
        children.push(el('div', null, [
          el('div', { className: 'xl-preview-heading', text: 'Jobs' }),
          el('div', { className: 'xl-hint' }, [el('span', { className: 'xl-mono', text: String(count) }), ' job' + (count === 1 ? '' : 's') + (st.preview.max_jobs ? ' (cap ' + st.preview.max_jobs + ')' : '')]),
          el('ul', { className: 'xl-run-names', 'aria-label': 'Run names' }, jobs.slice(0, 10).map((job) => el('li', { text: job.run_name || '' }))),
        ]));
        if (st.preview.preemption_warning) {
          children.push(el('div', { className: 'xl-callout xl-callout--warning', role: 'note', text: st.preview.preemption_warning }));
        }
      }
      children.push(el('div', { className: 'xl-status', role: 'status', 'data-xl-status': '1', text: status }));
      if (errors.length) {
        children.push(el('div', null, [
          el('div', { className: 'xl-preview-heading', text: 'Validation' }),
          el('ul', { className: 'xl-errors', 'data-xl-errors': '1' }, errors.map(errorButton)),
        ]));
      }
      const launch = el('button', {
        type: 'button', className: 'qym-inline-action qym-inline-action--accent', 'data-xl-launch': '1',
        disabled: st.launching || !st.selected.length,
        text: st.launching ? 'Launching…' : 'Launch',
        onClick: launchExperiment,
      });
      children.push(el('div', { className: 'xl-actions' }, [
        el('button', { type: 'button', className: 'qym-inline-action qym-inline-action--neutral', text: 'Cancel', onClick: () => { if (opts.onCancel) opts.onCancel(); } }),
        launch,
      ]));
      const body = host.querySelector('[data-xl-body]');
      body.replaceChildren.apply(body, children);
    }

    // ── Launch ──────────────────────────────────────────────────────────
    async function launchExperiment() {
      if (st.launching) return;
      const local = localErrors();
      if (local.length) {
        renderPreview();
        focusError(local[0]);
        return;
      }
      if (st.timer) { clearTimeout(st.timer); st.timer = null; }
      st.generation += 1; // drop any in-flight preview
      st.previewLoading = false;
      const body = buildRequest(false);
      if (body.priority === 'HIGH') {
        const ok = await confirmDialog({
          title: 'Launch at HIGH priority?',
          description: highWarnings(),
          confirmLabel: 'Launch at HIGH',
          cancelLabel: 'Don’t launch',
          confirmClass: 'shell-btn-danger',
        });
        if (!ok || !st.active) return;
        body.acknowledge_preemption = true;
      }
      st.launching = true;
      renderPreview();
      const send = () => request(projectPath('/experiments'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let res = await send();
      const detail = res.data && res.data.detail;
      if (st.active && !res.ok && res.status === 422 && detail && detail.code === PREEMPTION_ACK_REQUIRED) {
        const ok = await confirmDialog({
          title: 'Launch at HIGH priority?',
          description: [errorMessage(res.data, '')],
          confirmLabel: 'Launch at HIGH',
          cancelLabel: 'Don’t launch',
          confirmClass: 'shell-btn-danger',
        });
        if (ok && st.active) {
          body.acknowledge_preemption = true;
          res = await send();
        }
      }
      body.secrets = {};
      if (!st.active) return;
      st.launching = false;
      if (res.ok && res.data && res.data.id) {
        st.secrets = {};
        toast('Launched ' + (res.data.name || 'experiment'), 'success');
        if (opts.onLaunched) opts.onLaunched(res.data);
        return;
      }
      const failure = res.data && res.data.detail;
      if (res.status === 422 && failure && Array.isArray(failure.errors)) {
        st.launchErrors = failure.errors;
        toast(failure.message || 'The configuration is not valid', 'error');
        renderPreview();
        if (failure.errors[0]) focusError(failure.errors[0]);
        return;
      }
      toast(errorMessage(res.data, 'Failed to launch the experiment'), 'error');
      st.previewError = errorMessage(res.data, 'Failed to launch the experiment');
      renderPreview();
    }

    // ── Layout ──────────────────────────────────────────────────────────
    function section(key, step, title, description, extra) {
      const node = el('section', { className: 'xl-card', 'data-xl-section': key, tabindex: '-1' }, [
        el('div', { className: 'xl-card-header' }, [
          el('div', null, [
            el('h2', { className: 'xl-section-title' }, [el('span', { className: 'xl-step', text: step + '.' }), title]),
            el('p', { className: 'xl-section-description', text: description }),
          ]),
          extra || null,
        ]),
        el('div', { className: 'xl-card-body', 'data-xl-body': '1' }),
      ]);
      hosts[key] = node;
      return node;
    }

    function render() {
      ensureStylesheets();
      const newEnvButton = isManager && window.QymEvalEnvironments && window.QymEvalEnvironments.openAddDialog
        ? el('button', { type: 'button', className: 'qym-inline-action qym-inline-action--neutral', 'data-xl-new-env': '1', text: '+ New environment', onClick: openNewEnvironment })
        : null;
      const main = el('div', { className: 'xl-main' }, [
        section('environments', 1, 'Environments', 'Where the jobs run. Each selected environment gets one job.', newEnvButton),
        section('dataset', 2, 'Dataset', 'A project dataset (optionally pinned to a version or alias) or a custom dataset string.'),
        section('base', 3, 'Start from', 'The base configuration your edits are layered on.'),
        section('models', 4, 'Models', 'Bind each LLM slot to a project model, a temporary model, or leave it to the environment.'),
        section('settings', 5, 'Settings', 'Generated from the environment schema. Only changed values are sent.'),
        // Extension point: the Advanced panel (#24) mounts here.
        el('div', { 'data-xl-advanced': '1', hidden: true }),
        section('run', 6, 'Priority and name', 'HIGH preempts other users\' jobs and needs a project manager.'),
      ]);
      const preview = el('aside', { className: 'xl-preview', 'aria-label': 'Preview' }, [
        el('div', { className: 'xl-card-header' }, [el('div', null, [
          el('h2', { className: 'xl-section-title', text: 'Preview' }),
          el('p', { className: 'xl-section-description', text: 'Validated against every selected environment as you edit.' }),
        ])]),
        el('div', { className: 'xl-preview-body', 'data-xl-body': '1' }),
      ]);
      hosts.preview = preview;
      mountAdvanced(main.querySelector('[data-xl-advanced]'));
      root.replaceChildren(el('div', { className: 'xl-page', 'data-xl-launch-form': '1' }, [
        el('a', {
          className: 'xl-back', href: opts.listUrl || '#', text: '← Experiments',
          onClick: (e) => { if (opts.onCancel) { e.preventDefault(); opts.onCancel(); } },
        }),
        el('h1', { className: 'xl-title', text: 'New experiment' }),
        el('p', { className: 'xl-description', text: 'Configure one Evaluation Service run per environment and launch it.' }),
        el('div', { className: 'xl-meta' }, [el('span', { text: project.name || '' }), el('span', { className: 'xl-meta-sep', text: '·' }), el('span', { 'data-xl-base-meta': '1', text: 'Base: ' + baseLabel() })]),
        el('div', { className: 'xl-layout' }, [main, preview]),
      ]));
      renderEnvironments();
      renderDataset();
      renderBase();
      renderModels();
      renderSettings();
      renderRun();
      renderPreview();
    }

    // ── Advanced panel hook (#24) ───────────────────────────────────────
    // The only coupling with experiment_launch_advanced.js: what it may read and
    // call. Keys stay in st.secrets; the panel only ever sees {"$secret": ref}.
    function advancedApi() {
      return {
        el, tag, request, projectPath, has, escSeg, splitPointer, childPointer,
        state: st,
        union, unionSlots, boundPointers, roleColumns, leafControl, onLeafInput, markChanged,
        buildSpec, bindingSummary, clearBinding, loadVersions,
        rerender: () => { renderDataset(); renderModels(); renderSettings(); renderRun(); renderPreview(); },
        renderDataset, renderPreview, schedulePreview, updateChangedCount,
      };
    }

    function mountAdvanced(host) {
      const api = window.QymLaunchAdvanced;
      if (advanced) advanced.teardown(); // render() again replaces the host
      advanced = null;
      if (!host || !api || !api.mount) return;
      advanced = api.mount(host, advancedApi());
      host.hidden = !advanced;
    }

    function teardown() {
      if (advanced) advanced.teardown();
      advanced = null;
      st.active = false;
      if (st.timer) clearTimeout(st.timer);
      st.timer = null;
      if (previewFrame) cancelAnimationFrame(previewFrame);
      st.secrets = {};
      st.bindings = {};
    }

    render();
    st.datasetsReady = loadDatasets();
    (async () => {
      // ?clone=<xid>[&job=<jid>] ("Rerun with this config", #26) or ?env=<eid>.
      const params = new URLSearchParams(window.location.search);
      const cloneId = opts.clone || params.get('clone');
      const envParam = opts.environmentId || params.get('env');
      if (cloneId) await loadClone(cloneId, opts.cloneJob || params.get('job') || null);
      else if (envParam) st.selected = [envParam];
      if (!st.active) return;
      renderRun();
      renderBase();
      loadEnvironments();
    })();
    return { teardown };
  }

  window.QymExperimentLaunch = { mount, BASE_OPTIONS };
})();
