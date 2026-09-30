/*
 * Official defaults editor, publish and history; saved presets list
 * (plan §9.1, §12.1; issue #30).
 *
 *   window.QymOfficialDefaults.renderDrawerSection(container, {
 *     projectId, projectSlug, env, onEdit })
 *       Environments → env drawer: "Official defaults" (current version, Publish /
 *       Edit and publish, version history with notes, author and date; any version
 *       opens read-only) and "Saved presets" (name, author, updated; open in the
 *       launch form). onEdit({ fromVersion }) opens the editor; without it (or
 *       when the API says the viewer cannot publish) no write action is shown.
 *       Managers also get "Promote to official" on each saved preset (#39):
 *       onEdit({ promote: { kind: 'saved', id } }).
 *
 *   window.QymOfficialDefaults.openEditor({
 *     host, hide, project, me, env, fromVersion, promote, onPublished, onClose })
 *       Mounts the launch form in editor mode (QymExperimentLaunch.mountEditor)
 *       into `host`: the current official version (re-mapped onto the current
 *       schema) is the base the diff counts against, `fromVersion` (optional) is
 *       laid on top as edits. Publish needs release notes and posts
 *       POST …/presets (v1, kind official) or POST …/presets/{id}/versions.
 *
 *   Promote to official (#39, plan §9.1): `promote` = { kind: saved|run|job, id }
 *       loads GET …/eval-environments/{env}/promote-prefill (managers; re-mapped
 *       onto the current schema, temporary slots unbound) and lays it on top of
 *       the current official version as edits. It never publishes: the manager
 *       reviews the diff and publishes from the editor as usual. Slots that held a
 *       temporary model are passed as `rebind`, so Publish stays disabled until
 *       each is bound to a project model.
 *
 * APIs (api/eval_presets.py): GET …/presets (can_publish_official, can_publish),
 * GET …/presets/{id}/versions, GET …/versions/{n}?remap=current, the two POSTs
 * above; GET …/model-options for model names in the read-only view.
 * Temporary models cannot be published (the server refuses them; the editor
 * hides "+ Temporary model"). Preset versions are append-only and there is no
 * delete route, so the saved list has no delete action.
 *
 * Security: nodes are built with el()/textContent only; no server or user string
 * is parsed as HTML.
 */
(function () {
  'use strict';
  if (window.QymOfficialDefaults) return;

  const STYLESHEET = 'static/eval_official_defaults.css?v=eval-official-defaults-20260930-2';

  // ── Utilities ──────────────────────────────────────────────────────────
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((key) => {
        const value = attrs[key];
        if (value === undefined || value === null || value === false) return;
        if (key === 'className') node.className = value;
        else if (key === 'text') node.textContent = String(value);
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
    if (typeof window.__QYM_ROOT_PATH__ === 'string') return window.__QYM_ROOT_PATH__.replace(/\/+$/, '') + '/';
    const idx = window.location.pathname.indexOf('/projects/');
    return idx >= 0 ? window.location.pathname.slice(0, idx + 1) : '/';
  }

  function apiUrl(path) {
    return window.location.origin + appRoot() + String(path || '').replace(/^\/+/, '');
  }

  /** Head <link>s are not carried by client-side navigation: add ours on use. */
  function ensureStylesheet() {
    const file = STYLESHEET.split('?')[0].split('/').pop();
    if (document.querySelector('link[href*="' + file + '"]')) return;
    const anchor = document.querySelector('link[href*="ui_components.css"]');
    document.head.insertBefore(el('link', { rel: 'stylesheet', href: appRoot() + STYLESHEET }), anchor || null);
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

  function postJson(body) {
    return { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  }

  function errorMessage(data, fallback) {
    const detail = data && data.detail;
    if (typeof detail === 'string' && detail) return detail;
    if (detail && typeof detail.message === 'string' && detail.message) return detail.message;
    if (detail && Array.isArray(detail.errors)) return detail.errors.map((e) => e && e.message).filter(Boolean).join('; ') || fallback || 'Request failed';
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

  function relTime(value) {
    if (!value) return '';
    const stamp = new Date(value);
    if (Number.isNaN(stamp.getTime())) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - stamp.getTime()) / 1000));
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' min ago';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' hr ago';
    if (seconds < 604800) return Math.floor(seconds / 86400) + ' days ago';
    return stamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function absTime(value) {
    if (!value) return '';
    const stamp = new Date(value);
    return Number.isNaN(stamp.getTime()) ? '' : stamp.toLocaleString();
  }

  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
  }

  function formatValue(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value); } catch (_) { return String(value); }
  }

  function tag(text, modifier, title) {
    return el('span', { className: 'qym-tag' + (modifier ? ' qym-tag--' + modifier : ''), title: title || null, text });
  }

  function author(person) {
    return (person && person.name) || 'Unknown';
  }

  function presetsPath(projectId, envId, suffix) {
    return 'v1/projects/' + encodeURIComponent(projectId) + '/eval-environments/' + encodeURIComponent(envId) + '/presets' + (suffix || '');
  }

  function experimentsUrl(slug, query) {
    return appRoot() + 'projects/' + encodeURIComponent(slug) + '/experiments?' + query;
  }

  function navigateTo(url) {
    if (window.QymShell && window.QymShell.navigateTo) window.QymShell.navigateTo(url);
    else window.location.href = url;
  }

  /** {canPublishOfficial, official, saved, error} from GET …/presets. */
  async function loadPresets(projectId, envId) {
    const res = await request(presetsPath(projectId, envId));
    if (!res.ok) return { error: errorMessage(res.data, 'Failed to load presets'), official: null, saved: [], canPublishOfficial: false };
    const presets = res.data.presets || [];
    return {
      error: '',
      canPublishOfficial: !!res.data.can_publish_official,
      official: presets.find((p) => p.kind === 'official') || null,
      saved: presets.filter((p) => p.kind === 'saved'),
    };
  }

  /** env_overrides → [["A.B", value]] for the read-only view. */
  function flattenSettings(node, prefix, out) {
    Object.keys(node || {}).forEach((key) => {
      const value = node[key];
      const name = prefix ? prefix + '.' + key : key;
      if (isPlainObject(value) && !(Object.keys(value).length === 1 && Array.isArray(value.sweep))) flattenSettings(value, name, out);
      else out.push([name, value]);
    });
    return out;
  }

  /** Read-only view of one stored version (plan §9.1: history is never edited). */
  function versionView(version, modelNames) {
    const config = isPlainObject(version.config) ? version.config : {};
    const evaluator = isPlainObject(config.evaluator) ? config.evaluator : {};
    const bindings = isPlainObject(config.slot_bindings) ? config.slot_bindings : {};
    const models = Object.keys(bindings).map((key) => {
      const b = bindings[key];
      let text = 'Inherit';
      if (isPlainObject(b) && typeof b.connection_id === 'string') text = modelNames[b.connection_id] || b.name || b.connection_id;
      else if (isPlainObject(b) && isPlainObject(b.temporary)) text = 'Temporary: ' + (b.temporary.label || b.temporary.model || key);
      return key + ': ' + text;
    });
    const inputs = isPlainObject(evaluator.config) ? flattenSettings(evaluator.config, '', []) : [];
    const settings = flattenSettings(isPlainObject(config.env_overrides) ? config.env_overrides : {}, '', []);
    const dataset = typeof evaluator.dataset === 'string' && evaluator.dataset
      ? evaluator.dataset + (evaluator.dataset_version ? ' · ' + evaluator.dataset_version : '')
      : 'None';
    const list = (rows, attr) => (rows.length
      ? el('ul', { className: 'odx-kv-list', [attr]: '1' }, rows.map(([name, value]) => el('li', null, [
        el('span', { className: 'odx-kv-name', text: name }), ' = ', el('span', { className: 'odx-kv-value', text: formatValue(value) }),
      ])))
      : el('span', { className: 'odx-muted', text: 'None' }));
    return el('div', { className: 'odx-view', 'data-odx-readonly': '1' }, [
      el('dl', { className: 'env-kv' }, [
        el('dt', { text: 'Dataset' }), el('dd', { className: 'env-mono', text: dataset }),
        el('dt', { text: 'Models' }), el('dd', { text: models.join('; ') || 'Inherit' }),
        el('dt', { text: 'Inputs' }), el('dd', null, [list(inputs, 'data-odx-inputs')]),
        el('dt', { text: 'Settings' }), el('dd', null, [list(settings, 'data-odx-settings')]),
        el('dt', { text: 'Schema' }), el('dd', null, [
          el('span', { className: 'env-mono', title: version.schema_hash || null, text: String(version.schema_hash || '—').slice(0, 12) }),
          version.schema_current === false ? tag('older schema', 'warning', 'Re-mapped onto the current schema when used') : null,
        ]),
      ]),
      el('details', { className: 'odx-json' }, [
        el('summary', { text: 'Config document (read-only)' }),
        el('pre', { className: 'odx-pre', 'data-odx-json': '1', text: JSON.stringify(config, null, 2) }),
      ]),
    ]);
  }

  function warningsCallout(warnings) {
    const items = (warnings || []).map((w) => (w && w.message) || '').filter(Boolean);
    if (!items.length) return null;
    return el('div', { className: 'env-callout env-callout--warning', role: 'note', 'data-odx-warnings': '1' }, [el('div', null, [
      el('strong', { text: 'Check before launching' }),
      el('ul', { className: 'env-list' }, items.map((text) => el('li', { text }))),
    ])]);
  }

  // ── Drawer section ─────────────────────────────────────────────────────
  function renderDrawerSection(container, options) {
    const opts = options || {};
    const env = opts.env || {};
    const st = { token: {}, data: null, versions: null, versionsError: '', modelNames: {} };
    container._odxToken = st.token;
    ensureStylesheet();
    container.replaceChildren(el('section', { className: 'env-section' }, [
      el('div', { className: 'env-loading' }, [el('span', { className: 'env-spinner', 'aria-hidden': 'true' }), 'Loading presets…']),
    ]));

    async function load() {
      const [data, models] = await Promise.all([
        loadPresets(opts.projectId, env.id),
        request('v1/projects/' + encodeURIComponent(opts.projectId) + '/eval-environments/' + encodeURIComponent(env.id) + '/model-options'),
      ]);
      if (container._odxToken !== st.token) return;
      st.data = data;
      ((models.ok && models.data.connections) || []).forEach((c) => { st.modelNames[c.connection_id] = c.name; });
      if (data.official) {
        const res = await request(presetsPath(opts.projectId, env.id, '/' + encodeURIComponent(data.official.id) + '/versions'));
        if (container._odxToken !== st.token) return;
        st.versions = res.ok ? (res.data.versions || []) : [];
        st.versionsError = res.ok ? '' : errorMessage(res.data, 'Failed to load the version history');
      }
      render();
    }

    function canPublish() {
      const data = st.data || {};
      if (!data.canPublishOfficial) return false;
      return data.official ? data.official.can_publish !== false : true;
    }

    function officialSection() {
      const data = st.data;
      const official = data.official;
      const current = official && official.current_version;
      const writable = canPublish() && typeof opts.onEdit === 'function';
      const actions = [];
      if (writable && env.is_active !== false) {
        actions.push(el('button', {
          type: 'button', className: 'qym-inline-action qym-inline-action--accent', 'data-odx-edit': '1',
          text: current ? 'Edit and publish' : 'Publish v1',
          onClick: () => opts.onEdit({ fromVersion: null }),
        }));
      }
      const children = [el('div', { className: 'env-section-head' }, [
        el('div', null, [
          el('div', { className: 'env-section-title', text: 'Official defaults' }),
          el('div', { className: 'env-section-desc', text: 'The default base of every launch on this environment. Each publish adds a version; earlier versions never change.' }),
        ]),
        el('div', { className: 'env-section-actions' }, actions),
      ])];
      if (data.error) children.push(el('div', { className: 'env-callout env-callout--error', role: 'alert' }, [el('div', { text: data.error })]));
      if (!data.canPublishOfficial) {
        children.push(el('div', { className: 'env-hint', 'data-odx-readonly-note': '1', text: 'Only project managers publish official defaults. You can view every version.' }));
      } else if (env.is_active === false) {
        children.push(el('div', { className: 'env-hint', text: 'Re-enable this environment to publish.' }));
      }
      if (!current) {
        if (!data.error) children.push(el('div', { className: 'env-empty-state', text: 'No official defaults yet. Launches on this environment start from Blank.' }));
        return el('section', { className: 'env-section', 'data-odx-official': '1' }, children);
      }
      children.push(el('dl', { className: 'env-kv', 'data-odx-current': '1' }, [
        el('dt', { text: 'Current' }), el('dd', null, [tag('v' + current.version, 'version')]),
        el('dt', { text: 'Published' }), el('dd', null, [
          author(current.published_by), ' · ',
          el('span', { className: 'env-mono', title: absTime(current.published_at) || null, text: relTime(current.published_at) || '—' }),
        ]),
        el('dt', { text: 'Release notes' }), el('dd', { className: 'odx-notes', text: current.notes || '—' }),
      ]));
      const warnings = warningsCallout(current.warnings);
      if (warnings) children.push(warnings);
      children.push(historyBlock(official, writable && env.is_active !== false));
      return el('section', { className: 'env-section', 'data-odx-official': '1' }, children);
    }

    function historyBlock(official, writable) {
      const versions = st.versions || [];
      const block = el('div', { className: 'odx-history', 'data-odx-history': '1' }, [
        el('div', { className: 'odx-subtitle' }, ['Version history ', tag(String(versions.length), 'count')]),
      ]);
      if (st.versionsError) block.appendChild(el('div', { className: 'env-error-text', role: 'alert', text: st.versionsError }));
      versions.forEach((version) => {
        const isCurrent = version.id === official.current_version_id;
        const body = el('div', { className: 'odx-version-body' });
        const details = el('details', { className: 'odx-version', 'data-odx-version': String(version.version) }, [
          el('summary', null, [
            tag('v' + version.version, 'version'),
            isCurrent ? tag('current', 'success') : null,
            el('span', { className: 'odx-version-author', text: author(version.published_by) }),
            el('span', { className: 'odx-version-date env-mono', title: absTime(version.published_at) || null, text: relTime(version.published_at) }),
            el('span', { className: 'odx-version-notes', text: version.notes || '' }),
          ]),
          body,
        ]);
        details.addEventListener('toggle', () => {
          if (!details.open || body.firstChild) return;
          const children = [];
          if (version.notes) children.push(el('div', { className: 'odx-notes', text: version.notes }));
          const warnings = warningsCallout(version.warnings);
          if (warnings) children.push(warnings);
          children.push(versionView(version, st.modelNames));
          if (writable && !isCurrent) {
            children.push(el('div', { className: 'odx-version-actions' }, [el('button', {
              type: 'button', className: 'qym-inline-action qym-inline-action--neutral', 'data-odx-edit-from': String(version.version),
              text: 'Edit from v' + version.version,
              title: 'Open the editor with v' + version.version + ' as a draft; nothing is published until you publish',
              onClick: () => opts.onEdit({ fromVersion: version.version }),
            })]));
          }
          body.replaceChildren.apply(body, children);
        });
        block.appendChild(details);
      });
      return block;
    }

    function savedSection() {
      const saved = (st.data && st.data.saved) || [];
      const promotable = canPublish() && typeof opts.onEdit === 'function' && env.is_active !== false;
      const children = [el('div', { className: 'env-section-head' }, [el('div', null, [
        el('div', { className: 'env-section-title', text: 'Saved presets' }),
        el('div', { className: 'env-section-desc', text: 'Named starting points saved on this environment. Open one in the launch form to start from it.' }),
      ])])];
      if (!saved.length) {
        children.push(el('div', { className: 'env-empty-state', text: 'No saved presets yet.' }));
      } else {
        const rows = saved.map((preset) => {
          const version = preset.current_version;
          const open = opts.projectSlug && env.is_active !== false && version ? el('button', {
            type: 'button', className: 'qym-inline-action qym-inline-action--neutral', 'data-odx-open-preset': preset.id,
            text: 'Open in launch form',
            onClick: () => navigateTo(experimentsUrl(opts.projectSlug, 'new=1&env=' + encodeURIComponent(env.id) + '&base=saved&preset=' + encodeURIComponent(preset.id))),
          }) : null;
          // Opens the editor prefilled with this preset; never publishes (#39).
          const promote = promotable && version ? el('button', {
            type: 'button', className: 'qym-inline-action qym-inline-action--neutral', 'data-odx-promote': preset.id,
            text: 'Promote to official',
            title: 'Open the official defaults editor with this preset, compared with the current version; nothing is published until you publish',
            onClick: () => opts.onEdit({ fromVersion: null, promote: { kind: 'saved', id: preset.id } }),
          }) : null;
          return el('tr', { 'data-odx-saved': preset.id }, [
            el('td', null, [el('span', { className: 'odx-preset-name', text: preset.name }), ' ', version ? tag('v' + version.version, 'version') : null]),
            el('td', { text: author(preset.created_by) }),
            el('td', { className: 'env-mono', title: absTime(preset.updated_at) || null, text: relTime(preset.updated_at) || '—' }),
            el('td', { className: 'odx-actions-cell' }, [open, promote]),
          ]);
        });
        children.push(el('div', { className: 'odx-table-wrap' }, [el('table', { className: 'odx-table' }, [
          el('thead', null, [el('tr', null, [
            el('th', { text: 'Name' }), el('th', { text: 'Author' }), el('th', { text: 'Updated' }), el('th', { className: 'odx-actions-cell', text: 'Actions' }),
          ])]),
          el('tbody', null, rows),
        ])]));
      }
      return el('section', { className: 'env-section', 'data-odx-saved-presets': '1' }, children);
    }

    function render() {
      container.replaceChildren(officialSection(), savedSection());
    }

    load();
    return { reload: () => renderDrawerSection(container, opts) };
  }

  // ── Editor (launch form in editor mode) ────────────────────────────────
  async function remapped(projectId, envId, presetId, version) {
    const res = await request(presetsPath(projectId, envId, '/' + encodeURIComponent(presetId) + '/versions/' + encodeURIComponent(version) + '?remap=current'));
    if (!res.ok || !res.data.remap) return { error: errorMessage(res.data, 'Failed to load v' + version) };
    return { version: res.data.version || {}, remap: res.data.remap };
  }

  /** The editor prefill for a promote source (#39); read-only on the server. */
  async function promotePrefill(projectId, envId, promote) {
    const query = 'kind=' + encodeURIComponent(promote.kind) + '&id=' + encodeURIComponent(promote.id);
    const res = await request('v1/projects/' + encodeURIComponent(projectId) + '/eval-environments/' + encodeURIComponent(envId) + '/promote-prefill?' + query);
    if (!res.ok) return { error: errorMessage(res.data, 'Could not load the configuration to promote') };
    return res.data || {};
  }

  /** Remap, model and temporary-slot notes of a promote prefill, for the editor. */
  function promoteWarnings(promoted) {
    const from = (promoted.source && promoted.source.label) || 'The source';
    const remap = promoted.remap || {};
    const out = [];
    (remap.dropped || []).forEach((d) => out.push({ message: from + ': ' + (d.label || d.pointer) + ' was dropped (' + (d.message || d.reason || 'no longer supported') + ').' }));
    (remap.errors || []).forEach((e) => out.push({ message: from + ': ' + (e.message || e.pointer || 'Invalid value') }));
    (promoted.warnings || []).forEach((w) => { if (w && w.message) out.push({ message: w.message }); });
    (promoted.unbound || []).forEach((u) => out.push({
      message: 'Rebind ' + u.slot_key + ': it used temporary model ' + (u.label || u.model || u.slot_key) + '. Pick a project model before publishing.',
    }));
    return out;
  }

  async function openEditor(options) {
    const o = options || {};
    const env = o.env || {};
    const project = o.project || {};
    const launch = window.QymExperimentLaunch;
    if (!o.host || !launch || !launch.mountEditor) {
      toast('The official defaults editor failed to load', 'error');
      return null;
    }
    ensureStylesheet();
    const data = await loadPresets(project.id, env.id);
    if (data.error) { toast(data.error, 'error'); return null; }
    const official = data.official;
    const current = official && official.current_version;
    if (!data.canPublishOfficial || (official && official.can_publish === false)) {
      toast('Only project managers publish official defaults', 'error');
      return null;
    }
    let baseConfig = {};
    let baseMeta = { label: 'Blank (no official defaults yet)' };
    if (current) {
      const cur = await remapped(project.id, env.id, official.id, current.version);
      if (cur.error) { toast(cur.error, 'error'); return null; }
      baseConfig = cur.remap.config || {};
      baseMeta = {
        label: 'Official defaults v' + current.version,
        version: current.version,
        versionId: current.id,
        releaseNotes: current.notes || '',
        summary: cur.remap.summary,
        dropped: cur.remap.dropped || [],
        errors: cur.remap.errors || [],
        // The schema_hash warning is what the remap just resolved.
        warnings: (cur.version.warnings || []).filter((w) => w.rule !== 'schema_hash'),
      };
    }
    let initialConfig = null;
    let promoted = null;
    if (o.promote && o.promote.kind && o.promote.id) {
      promoted = await promotePrefill(project.id, env.id, o.promote);
      if (promoted.error) { toast(promoted.error, 'error'); return null; }
      initialConfig = promoted.config || {};
      baseMeta.warnings = (baseMeta.warnings || []).concat(promoteWarnings(promoted));
      if (promoted.remap && promoted.remap.summary) toast(promoted.remap.summary, 'info');
    } else if (official && o.fromVersion && o.fromVersion !== (current && current.version)) {
      const from = await remapped(project.id, env.id, official.id, o.fromVersion);
      if (from.error) { toast(from.error, 'error'); return null; }
      initialConfig = from.remap.config || {};
      if (from.remap.summary) toast('v' + o.fromVersion + ': ' + from.remap.summary, 'info');
    }
    const next = current ? current.version + 1 : 1;
    const hidden = (o.hide || []).filter((node) => node && !node.hidden);
    hidden.forEach((node) => { node.hidden = true; });
    o.host.hidden = false;
    let handle = null;

    function close() {
      if (handle) handle.teardown();
      handle = null;
      o.host.replaceChildren();
      o.host.hidden = true;
      hidden.forEach((node) => { node.hidden = false; });
      if (o.onClose) o.onClose();
    }

    async function publish(payload) {
      const diff = payload.diff || { total: 0 };
      const ok = await confirmDialog({
        title: 'Publish official defaults v' + next + '?',
        description: [
          current ? diff.total + ' change' + (diff.total === 1 ? '' : 's') + ' vs ' + payload.baseLabel + '.' : 'The first version of the official defaults of “' + env.name + '”.',
          'Launches that start from official defaults use it from now on. Earlier versions stay in the history and never change.',
        ],
        confirmLabel: 'Publish v' + next,
        cancelLabel: 'Keep editing',
      });
      if (!ok) return { ok: false, message: '' };
      const body = { config: payload.config, notes: payload.notes };
      const res = official
        ? await request(presetsPath(project.id, env.id, '/' + encodeURIComponent(official.id) + '/versions'), postJson(body))
        : await request(presetsPath(project.id, env.id), postJson(Object.assign({ kind: 'official' }, body)));
      const detail = res.data && res.data.detail;
      if (res.ok) {
        const version = (res.data.version || (res.data.preset && res.data.preset.current_version) || {}).version || next;
        const warnings = (res.data.warnings || []).length;
        toast('Published official defaults v' + version + ' for “' + env.name + '”' + (warnings ? ' (' + warnings + ' warning' + (warnings === 1 ? '' : 's') + ')' : ''), 'success');
        close();
        if (o.onPublished) o.onPublished(res.data);
        return { ok: true };
      }
      if (res.status === 422 && detail && Array.isArray(detail.errors) && detail.errors.length) {
        return { ok: false, errors: detail.errors, message: 'The configuration is not valid' };
      }
      if (res.status === 409) {
        return { ok: false, message: errorMessage(res.data, 'The official defaults changed meanwhile') + '. Close the editor and open it again.' };
      }
      return { ok: false, message: errorMessage(res.data, 'Could not publish') };
    }

    handle = launch.mountEditor({
      root: o.host,
      project,
      me: o.me || {},
      slug: project.slug,
      environment: env,
      baseConfig,
      baseMeta,
      initialConfig,
      title: 'Official defaults · ' + (env.name || ''),
      description: promoted
        ? 'Promoting ' + ((promoted.source && promoted.source.label) || 'a configuration') + ', compared with ' + (current ? 'the current version' : 'Blank') + '. Nothing changes until you publish.'
        : initialConfig
          ? 'A draft from v' + o.fromVersion + ', compared with the current version. Nothing changes until you publish.'
          : 'Edit the environment\'s official defaults and publish them as a new version.',
      backLabel: '← Environments',
      saveLabel: 'Publish v' + next,
      notesLabel: 'Release notes',
      notesPlaceholder: 'What changed and why (required)',
      notesRequired: true,
      allowTemporary: false,
      // Slots the promoted source bound to a temporary model: Publish waits for a project model.
      rebind: promoted ? (promoted.unbound || []) : [],
      requireChange: !!current,
      onSave: publish,
      onCancel: close,
    });
    return { close };
  }

  window.QymOfficialDefaults = { renderDrawerSection, openEditor, _internal: { versionView, flattenSettings, promoteWarnings } };
})();
