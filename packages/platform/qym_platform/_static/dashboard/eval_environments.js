/*
 * Evaluation Service environments UI (plan §12.1, §7.2; requirements R1–R3).
 *
 * Exposes window.QymEvalEnvironments so Project Settings (and later the
 * Experiments page, "+ New environment") share one implementation:
 *
 *   mountEnvironmentsPanel({ projectId, canManage, tbody, addButton, note, onGotoApiKeys })
 *   openAddDialog({ projectId, onChange, onGotoApiKeys })        3-step add dialog
 *   openEnvironmentDrawer({ projectId, projectSlug, env, canManage, onChange, onEditOfficial })
 *                                    detail drawer; its presets section (official
 *                                    defaults + saved presets, #30) is
 *                                    QymOfficialDefaults.renderDrawerSection
 *   createSlotEditor({...})                                       "Group LLM settings"
 *   renderFormPreview(descriptor)                                 read-only generated form
 *   HIGH_PRIORITY_WARNING / highPriorityWarning(envName)          §5.3 preemption text
 *   runOfficialDefaults({ projectId, projectSlug, env, canManage, onLaunched })
 *                                    "Run official defaults" one click (§9.2, #31)
 *
 * Security: every server or user string goes through esc() before it reaches
 * innerHTML. The environment API key only exists in its password input until
 * it is submitted; the UI renders the server's masked api_key_hint and never
 * reads a raw key back.
 */
(function () {
  'use strict';
  if (window.QymEvalEnvironments) return;

  // Mirrors DEFAULT_SLOT_RULES in services/eval_model_slots.py.
  const ROLE_RULES = {
    model: { names: ['model', 'model_name'], suffixes: ['_MODEL_NAME', '_MODEL'], types: ['string', 'enum'] },
    base_url: { names: ['base_url', 'url'], suffixes: ['_BASE_URL', '_URL', '_ENDPOINT'], types: ['string'] },
    api_key: { names: ['api_key'], suffixes: ['_API_KEY', '_KEY'], types: ['string'] },
  };
  const ROLES = ['model', 'base_url', 'api_key'];
  const ROLE_LABELS = { model: 'Model', base_url: 'Base URL', api_key: 'API key' };
  const TRANSPORT = ['timeout', 'max_attempts', 'max_connections', 'max_keepalive', 'connect_timeout'];
  const SCALAR_TYPES = ['boolean', 'integer', 'number', 'string', 'enum'];
  const PRIORITIES = ['LOW', 'NORMAL', 'HIGH'];
  // Mirrors HIGH_PRIORITY_WARNING in services/eval_priority.py (plan §5.3). The launch
  // form reuses it through window.QymEvalEnvironments.highPriorityWarning.
  const HIGH_PRIORITY_WARNING = 'Launching at HIGH cancels every running LOW/NORMAL job on {env} for all users.';
  function highPriorityWarning(envName) {
    return HIGH_PRIORITY_WARNING.replace('{env}', envName);
  }
  const DIFF_LIMIT = 50;
  const KEYS_HELP = 'Send project LLM connection API keys to this service when a slot is bound to a connection.';
  const KEYS_HELP_MOVED = 'Turned off because the URL changed. Tick it again to send connection keys to the new host.';

  // ── Utilities ──────────────────────────────────────────────────────────
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function apiUrl(path) {
    const root = (window.__QYM_ROOT_PATH__ || '').replace(/\/$/, '');
    return `${window.location.origin}${root}/${String(path || '').replace(/^\/+/, '')}`;
  }

  function envPath(projectId, suffix) {
    return `v1/projects/${encodeURIComponent(projectId)}/eval-environments${suffix || ''}`;
  }

  async function request(path, options) {
    let res;
    try {
      res = await fetch(apiUrl(path), options);
    } catch (err) {
      return { ok: false, status: 0, data: { detail: (err && err.message) || 'Network error' } };
    }
    if (window.QymAuth && window.QymAuth.handle401 && window.QymAuth.handle401(res)) {
      return { ok: false, status: 401, data: { detail: 'Your session expired' } };
    }
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data: data || {} };
  }

  function sendJson(method, body) {
    return {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    };
  }

  /** Human text for FastAPI errors: a string, a pydantic list, or {errors:[...]} */
  function errorMessage(data, fallback) {
    const detail = data && data.detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail)) {
      return detail.map((e) => {
        if (!e || typeof e !== 'object') return String(e);
        const loc = Array.isArray(e.loc) ? e.loc.filter((part) => part !== 'body').join('.') : '';
        return loc ? `${loc}: ${e.msg}` : String(e.msg || '');
      }).join('; ');
    }
    if (detail && Array.isArray(detail.errors)) return detail.errors.map((e) => e && e.message).filter(Boolean).join('; ');
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
    return window.confirm(`${options.title}\n\n${[].concat(options.description || []).join('\n')}`);
  }

  function relTime(value) {
    if (!value) return '';
    const stamp = new Date(value);
    if (Number.isNaN(stamp.getTime())) return '';
    const seconds = Math.max(0, Math.floor((Date.now() - stamp.getTime()) / 1000));
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} hr ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)} days ago`;
    return stamp.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function absTime(value) {
    if (!value) return '';
    const stamp = new Date(value);
    return Number.isNaN(stamp.getTime()) ? '' : stamp.toLocaleString();
  }

  function shortHash(hash) {
    return hash ? String(hash).slice(0, 12) : '';
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function spinnerLabel(button, label) {
    if (!button) return () => {};
    const original = button.innerHTML;
    const width = button.style.width;
    button.style.width = `${button.offsetWidth}px`;
    button.disabled = true;
    button.innerHTML = `<span class="env-spinner" aria-hidden="true"></span>${esc(label || '')}`;
    return () => {
      button.disabled = false;
      button.innerHTML = original;
      button.style.width = width;
    };
  }

  // ── JSON pointers & descriptor helpers (services/eval_schema_form.py) ────
  function escapeSegment(segment) {
    return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
  }

  function unescapeSegment(segment) {
    return String(segment).replace(/~1/g, '/').replace(/~0/g, '~');
  }

  function expandPointer(template, params) {
    return String(template).split('/').map((segment) => {
      const match = /^\{(.+)\}$/.exec(segment);
      return match && params[match[1]] != null ? escapeSegment(params[match[1]]) : segment;
    }).join('/');
  }

  function lastSegment(pointer) {
    const parts = String(pointer || '').split('/');
    return unescapeSegment(parts[parts.length - 1] || '');
  }

  function descriptorFields(descriptor) {
    return (descriptor && descriptor.fields) || {};
  }

  function countFields(descriptor) {
    return Object.values(descriptorFields(descriptor)).filter((entry) => entry && entry.kind === 'field').length;
  }

  function endpointCollection(descriptor) {
    return Object.values(descriptorFields(descriptor)).find((entry) => entry
      && entry.kind === 'collection' && entry.name === 'endpoints'
      && !(entry.params && entry.params.length)) || null;
  }

  function roleFits(entry, role) {
    return !!(entry && entry.kind === 'field' && ROLE_RULES[role].types.includes(entry.type));
  }

  /** Concrete pointers that can fill ``role`` for an endpoint slot. */
  function endpointCandidates(descriptor, endpointKey, role) {
    const fields = descriptorFields(descriptor);
    const collection = endpointCollection(descriptor);
    const item = collection && fields[collection.item_pointer];
    if (!item) return [];
    return (item.children || [])
      .map((pointer) => fields[pointer])
      .filter((entry) => roleFits(entry, role))
      .sort((a, b) => Number(!ROLE_RULES[role].names.includes(String(a.name).toLowerCase()))
        - Number(!ROLE_RULES[role].names.includes(String(b.name).toLowerCase())))
      .map((entry) => expandPointer(entry.pointer, { [collection.key_param]: endpointKey }));
  }

  /** Top-level (flat env var) pointers that can fill ``role``. */
  function flatCandidates(descriptor, role) {
    const fields = descriptorFields(descriptor);
    const suffixes = ROLE_RULES[role].suffixes;
    return ((descriptor && descriptor.root) || [])
      .map((pointer) => fields[pointer])
      .filter((entry) => roleFits(entry, role))
      .sort((a, b) => {
        const rank = (entry) => (suffixes.some((s) => String(entry.name).toUpperCase().endsWith(s)) ? 0 : 1);
        return rank(a) - rank(b);
      })
      .map((entry) => entry.pointer);
  }

  function rootByUpperName(descriptor) {
    const fields = descriptorFields(descriptor);
    const out = {};
    ((descriptor && descriptor.root) || []).forEach((pointer) => {
      const entry = fields[pointer];
      if (entry && entry.kind === 'field') out[String(entry.name).toUpperCase()] = entry;
    });
    return out;
  }

  function slotPointers(slot) {
    return Object.values((slot && slot.field_map) || {})
      .concat(Object.values((slot && slot.transport_fields) || {}))
      .filter((p) => typeof p === 'string' && p);
  }

  function humanize(name) {
    const acronyms = ['ai', 'api', 'id', 'llm', 'rag', 'sql', 'url', 'viz'];
    const words = String(name).split(/[_\-\s.]+/).filter(Boolean)
      .map((w) => (acronyms.includes(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()));
    if (words.length && words[0] === words[0].toLowerCase()) words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
    return words.join(' ') || String(name);
  }

  // ── Table cells ────────────────────────────────────────────────────────
  function healthHtml(env) {
    const status = env.health_status === 'ok' ? 'ok' : env.health_status === 'error' ? 'error' : 'unknown';
    const label = status === 'ok' ? 'Healthy' : status === 'error' ? 'Error' : 'Unknown';
    const checked = relTime(env.health_checked_at);
    const title = status === 'error' && env.health_error ? env.health_error : (checked ? `Checked ${checked}` : 'Not checked yet');
    return `<span class="env-health env-health--${status}" title="${esc(title)}"><span class="env-health-dot" aria-hidden="true"></span>${esc(label)}</span>`
      + (checked ? `<div class="env-meta">${esc(checked)}</div>` : '');
  }

  function slotStatusHtml(env) {
    if (!env.current_schema_id) return '<span class="env-empty">—</span>';
    const summary = env.model_slots || {};
    const counts = summary.counts || {};
    if (summary.needs_confirmation) {
      const pending = (counts.proposed || 0) + (counts.stale || 0);
      return `<span class="qym-tag qym-tag--warning env-nowrap" title="${esc(`${pending} slot(s) proposed or stale`)}">⚠ Needs grouping</span>`;
    }
    return `<span class="qym-tag qym-tag--success env-nowrap" title="${esc(`${counts.confirmed || 0} confirmed slot(s)`)}">✓ Grouped</span>`;
  }

  /**
   * Official preset version (plan §9, issues #27/#28/#31): the environment payload
   * carries ``official_preset_version`` (null until official defaults are published).
   */
  function officialPresetVersionHtml(env) {
    const version = env && env.official_preset_version;
    if (version == null || version === '') return '<span class="env-empty" title="No official defaults published yet">—</span>';
    return `<span class="qym-tag qym-tag--version">v${esc(version)}</span>`;
  }

  function schemaHtml(env) {
    if (!env.schema_hash) return '<span class="env-empty">—</span>';
    const fetched = relTime(env.schema_fetched_at);
    return `<span class="env-mono" title="${esc(env.schema_hash)}">${esc(shortHash(env.schema_hash))}</span>`
      + (fetched ? `<div class="env-meta" title="${esc(absTime(env.schema_fetched_at))}">fetched ${esc(fetched)}</div>` : '');
  }

  function renderEnvironmentRows(envs, options) {
    const canManage = !!(options && options.canManage);
    if (!envs.length) {
      return `<tr><td colspan="9"><div class="env-empty-state">No environments yet.${canManage
        ? ' Add one to launch experiments against an Evaluation Service deployment.'
        : ' A project manager can add one.'}</div></td></tr>`;
    }
    return envs.map((env) => {
      const id = esc(env.id);
      return `
        <tr data-env-row="${id}"${env.is_active ? '' : ' class="env-row--disabled"'}>
          <td>
            <button class="env-name-link" type="button" data-env-open="${id}">${esc(env.name)}</button>
            ${env.is_active ? '' : '<span class="qym-tag qym-tag--warning env-inline-tag">Disabled</span>'}
            ${env.description ? `<div class="env-meta env-ellipsis" title="${esc(env.description)}">${esc(env.description)}</div>` : ''}
          </td>
          <td><span class="env-url" title="${esc(env.base_url)}">${esc(env.base_url)}</span></td>
          <td>${healthHtml(env)}</td>
          <td>${schemaHtml(env)}</td>
          <td>${slotStatusHtml(env)}</td>
          <td>${officialPresetVersionHtml(env)}</td>
          <td><span class="qym-tag qym-tag--data">${esc(env.max_priority || '—')}</span></td>
          <td class="env-num">${esc(env.max_inflight_jobs == null ? '—' : env.max_inflight_jobs)}</td>
          <td class="env-actions-cell">
            <div class="env-row-actions">
              ${canRunOfficial(env) ? `<button class="btn btn-secondary env-btn-sm" type="button" data-env-run-official="${id}" title="${esc(`Launch a 1-job experiment with official defaults v${env.official_preset_version}`)}">Run official defaults</button>` : ''}
              <button class="btn btn-secondary env-btn-sm" type="button" data-env-open="${id}">${canManage ? 'Manage' : 'View'}</button>
              ${canManage ? `<button class="btn btn-secondary env-btn-sm" type="button" data-env-test="${id}">Test</button>` : ''}
            </div>
          </td>
        </tr>`;
    }).join('');
  }

  // ── Generated-form preview (step 2) ────────────────────────────────────
  function fieldTagsHtml(entry) {
    const tags = [];
    const kindLabel = entry.kind === 'collection' ? 'map' : entry.kind === 'role_table' ? 'role table' : entry.widget || entry.type;
    if (kindLabel) tags.push(`<span class="qym-tag qym-tag--data">${esc(kindLabel)}</span>`);
    if (entry.required) tags.push('<span class="qym-tag">Required</span>');
    if (entry.secret) tags.push('<span class="qym-tag qym-tag--warning">Secret</span>');
    if (entry.sweepable) tags.push('<span class="qym-tag qym-tag--accent">Sweepable</span>');
    return tags.join('');
  }

  function defaultHtml(entry) {
    if (entry.kind !== 'field') return '';
    if (entry.secret) return '<div class="env-field-default">Default hidden</div>';
    if (entry.has_default) {
      return `<div class="env-field-default">Default <span class="env-mono">${esc(JSON.stringify(entry.default))}</span></div>`;
    }
    return '<div class="env-field-default">Inherited from environment</div>';
  }

  function fieldExtraHtml(entry) {
    const bits = [];
    if (Array.isArray(entry.enum) && entry.enum.length) {
      bits.push(`Options <span class="env-mono">${esc(entry.enum.map((v) => JSON.stringify(v)).join(', '))}</span>`);
    }
    const bounds = entry.bounds || {};
    const boundText = Object.keys(bounds).map((k) => `${k} ${bounds[k]}`).join(', ');
    if (boundText) bits.push(`<span class="env-mono">${esc(boundText)}</span>`);
    if (entry.kind === 'collection') {
      const required = (entry.required_keys || []).join(', ');
      bits.push(`Keys are added per experiment${required ? `; required <span class="env-mono">${esc(required)}</span>` : ''}`);
    }
    if (entry.kind === 'role_table') {
      bits.push(`Roles <span class="env-mono">${esc((entry.rows || []).map((r) => r.key).join(', '))}</span>`);
    }
    if (entry.hints && entry.hints.text) bits.push(esc(entry.hints.text));
    return bits.length ? `<div class="env-field-extra">${bits.join(' · ')}</div>` : '';
  }

  function previewNodeHtml(fields, pointer, depth, seen) {
    const entry = fields[pointer];
    if (!entry || seen.has(pointer) || depth > 8) return '';
    seen.add(pointer);
    const name = entry.kind === 'role_table' ? `{${entry.row_param || 'role'}}` : entry.name;
    const label = entry.label && entry.label !== entry.name ? entry.label : '';
    let html = `
      <div class="env-field" style="--env-depth:${depth}">
        <div class="env-field-main">
          <div class="env-field-name" title="${esc(pointer)}">${esc(name)}</div>
          ${label ? `<div class="env-field-label">${esc(label)}</div>` : ''}
          ${entry.description ? `<div class="env-field-desc">${esc(entry.description)}</div>` : ''}
          ${fieldExtraHtml(entry)}
          ${defaultHtml(entry)}
        </div>
        <div class="env-field-tags">${fieldTagsHtml(entry)}</div>
      </div>`;
    (entry.children || []).forEach((child) => {
      // A collection's templated item is a plain wrapper: show its fields directly.
      const childEntry = fields[child];
      if (entry.kind === 'collection' && childEntry && childEntry.kind === 'object') {
        seen.add(child);
        (childEntry.children || []).forEach((grand) => { html += previewNodeHtml(fields, grand, depth + 1, seen); });
      } else {
        html += previewNodeHtml(fields, child, depth + 1, seen);
      }
    });
    return html;
  }

  function renderFormPreview(descriptor) {
    const fields = descriptorFields(descriptor);
    const groups = (descriptor && descriptor.groups) || [];
    const total = countFields(descriptor);
    const warnings = (descriptor && descriptor.warnings) || [];
    const seen = new Set();
    const groupHtml = groups.map((group, groupIndex) => {
      const pointers = group.pointers || [];
      let count = 0;
      const countIn = (p, guard) => {
        const entry = fields[p];
        if (!entry || guard.has(p)) return;
        guard.add(p);
        if (entry.kind === 'field') count += 1;
        (entry.children || []).forEach((c) => countIn(c, guard));
      };
      const guard = new Set();
      pointers.forEach((p) => countIn(p, guard));
      return `
        <details class="env-group"${groupIndex === 0 ? ' open' : ''}>
          <summary class="env-group-header">
            <span class="env-group-title">${esc(group.label)}</span>
            <span class="qym-tag qym-tag--count" title="Settings in this group">${esc(count)}</span>
          </summary>
          ${pointers.map((p) => previewNodeHtml(fields, p, 0, seen)).join('')}
        </details>`;
    }).join('');
    const warningHtml = warnings.length
      ? `<div class="env-callout env-callout--warning" role="note"><div><strong>${esc(warnings.length)} schema warning(s).</strong> These settings are edited as raw JSON:
          <ul class="env-list">${warnings.slice(0, 20).map((w) => `<li><span class="env-mono">${esc(w.pointer || '/')}</span> ${esc(w.message)}</li>`).join('')}</ul></div></div>`
      : '';
    return `
      <div class="env-preview">
        <div class="env-preview-summary">
          <span class="env-preview-count">${esc(total)} settings</span>
          <span class="env-meta">in ${esc(groups.length)} groups · read-only preview of the launch form</span>
        </div>
        ${warningHtml}
        ${groupHtml || '<div class="env-empty-state">The schema has no settings.</div>'}
      </div>`;
  }

  // ── Slot editor ("Group LLM settings", §7.2) ───────────────────────────
  const STATUS_TAGS = {
    confirmed: '<span class="qym-tag qym-tag--success">Confirmed</span>',
    proposed: '<span class="qym-tag qym-tag--info">Proposed</span>',
    stale: '<span class="qym-tag qym-tag--warning" title="Its fields changed in the new schema">Stale</span>',
    new: '<span class="qym-tag qym-tag--accent">New</span>',
  };

  function normalizeSlot(slot) {
    const fieldMap = {};
    ROLES.forEach((role) => { fieldMap[role] = (slot.field_map && slot.field_map[role]) || null; });
    return {
      slot_key: String(slot.slot_key || ''),
      kind: slot.kind || (String(slot.slot_key || '').startsWith('flat:') ? 'flat' : 'endpoint'),
      label: slot.label || '',
      field_map: fieldMap,
      transport_fields: Object.assign({}, slot.transport_fields || {}),
      required: !!slot.required,
      status: slot.status || 'new',
    };
  }

  /**
   * Render an editable (managers) or read-only list of slot cards into
   * ``options.container``. Actions: rename, change/unmap fields (split),
   * merge flat slots, remove/restore, add endpoint or flat slots manually,
   * and Confirm (PUT model-slots).
   */
  function createSlotEditor(options) {
    const opts = Object.assign({ canEdit: false, showActions: true, confirmLabel: 'Confirm grouping' }, options || {});
    const st = {
      slots: (opts.slots || []).map(normalizeSlot),
      removed: [],
      errors: {},
      general: '',
      notice: '',
      busy: false,
      schemaId: opts.schemaId || null,
      descriptor: opts.descriptor || { fields: {}, root: [] },
    };
    const root = document.createElement('div');
    root.className = 'env-slot-editor';
    opts.container.innerHTML = '';
    opts.container.appendChild(root);

    function usedPointers(exceptIndex) {
      const used = new Set();
      st.slots.forEach((slot, idx) => { if (idx !== exceptIndex) slotPointers(slot).forEach((p) => used.add(p)); });
      return used;
    }

    function candidatesFor(slot, idx, role) {
      const name = slot.slot_key.slice(slot.slot_key.indexOf(':') + 1);
      // A field fills one role of one slot only (validate_slots rejects sharing).
      const used = usedPointers(idx);
      Object.entries(slot.field_map).forEach(([r, p]) => { if (r !== role && p) used.add(p); });
      Object.values(slot.transport_fields).forEach((p) => used.add(p));
      const candidates = slot.kind === 'endpoint'
        ? endpointCandidates(st.descriptor, name, role)
        : flatCandidates(st.descriptor, role);
      return candidates.filter((p) => !used.has(p));
    }

    function roleRowHtml(slot, idx, role) {
      const value = slot.field_map[role];
      let control;
      if (opts.canEdit) {
        const candidates = candidatesFor(slot, idx, role);
        if (value && !candidates.includes(value)) candidates.unshift(value);
        const optionsHtml = (role === 'model' && value ? '' : `<option value="">${role === 'model' ? 'Pick a model field…' : 'Not mapped (plain input)'}</option>`)
          + candidates.map((p) => `<option value="${esc(p)}"${p === value ? ' selected' : ''}>${esc(p)}</option>`).join('');
        control = `<select class="qym-control qym-select env-slot-select" data-slot-role="${idx}" data-role="${role}" aria-label="${esc(`${ROLE_LABELS[role]} field for ${slot.label || slot.slot_key}`)}">${optionsHtml}</select>`;
      } else {
        control = value ? `<span class="env-slot-pointer">${esc(value)}</span>` : '<span class="env-empty">Not mapped</span>';
      }
      return `<div class="env-slot-row"><span class="env-slot-role">${esc(ROLE_LABELS[role])}</span>${control}</div>`;
    }

    function transportHtml(slot, idx) {
      const entries = Object.entries(slot.transport_fields);
      if (!entries.length) return '';
      return `<div class="env-slot-row"><span class="env-slot-role">Transport</span><div class="env-chip-list">${entries.map(([name, pointer]) => `
        <span class="qym-tag qym-tag--data env-transport" title="${esc(pointer)}">${esc(name)}${opts.canEdit
          ? `<button class="qym-icon-action env-transport-remove" type="button" data-slot-detach="${idx}" data-name="${esc(name)}" aria-label="${esc(`Unmap ${name}; it stays a plain input`)}" title="Unmap (stays a plain input)">&times;</button>`
          : ''}</span>`).join('')}</div></div>`;
    }

    function cardHtml(slot, idx) {
      const errors = st.errors[slot.slot_key] || [];
      const flatTargets = st.slots
        .map((other, j) => ({ other, j }))
        .filter(({ other, j }) => j !== idx && other.kind === 'flat' && slot.kind === 'flat');
      const title = opts.canEdit
        ? `<input class="qym-control qym-input env-slot-label" type="text" maxlength="200" data-slot-label="${idx}" value="${esc(slot.label)}" aria-label="${esc(`Name of slot ${slot.slot_key}`)}" placeholder="Slot name">`
        : `<span class="env-slot-title">${esc(slot.label || slot.slot_key)}</span>`;
      const footer = opts.canEdit && (flatTargets.length || !slot.required) ? `
        <div class="env-slot-footer">
          ${flatTargets.length ? `<select class="qym-control qym-select env-slot-merge" data-slot-merge="${idx}" aria-label="${esc(`Merge ${slot.label || slot.slot_key} into another slot`)}">
              <option value="">Merge into…</option>
              ${flatTargets.map(({ other, j }) => `<option value="${j}">${esc(other.label || other.slot_key)}</option>`).join('')}
            </select>` : ''}
          ${slot.required ? '' : `<button class="qym-inline-action qym-inline-action--danger" type="button" data-slot-remove="${idx}">Remove slot</button>`}
        </div>` : '';
      return `
        <article class="env-slot${errors.length ? ' has-error' : ''}" data-slot-key="${esc(slot.slot_key)}">
          <header class="env-slot-header">
            ${title}
            <span class="qym-tag qym-tag--data" title="Slot key">${esc(slot.slot_key)}</span>
            ${STATUS_TAGS[slot.status] || ''}
            ${slot.required ? '<span class="qym-tag" title="Required by the service">Required</span>' : ''}
          </header>
          <div class="env-slot-body">
            ${ROLES.map((role) => roleRowHtml(slot, idx, role)).join('')}
            ${transportHtml(slot, idx)}
          </div>
          ${footer}
          ${errors.length ? `<div class="env-slot-errors" role="alert">${errors.map((m) => `<div>${esc(m)}</div>`).join('')}</div>` : ''}
        </article>`;
    }

    function addFormHtml() {
      if (!opts.canEdit) return '';
      const collection = endpointCollection(st.descriptor);
      const used = usedPointers(-1);
      const flatModels = flatCandidates(st.descriptor, 'model').filter((p) => !used.has(p));
      return `
        <div class="env-add-slot">
          <div class="env-add-slot-title">Add a slot manually</div>
          ${collection ? `
          <div class="env-add-slot-row">
            <input class="qym-control qym-input" type="text" maxlength="100" data-add-endpoint-name placeholder="Endpoint name, e.g. fast" aria-label="New endpoint name">
            <button class="qym-inline-action qym-inline-action--neutral" type="button" data-add-endpoint>Add endpoint slot</button>
          </div>` : ''}
          <div class="env-add-slot-row">
            <select class="qym-control qym-select env-slot-select" data-add-flat-model aria-label="Model field for a new slot"${flatModels.length ? '' : ' disabled'}>
              <option value="">${flatModels.length ? 'Pick a model field…' : 'No unassigned model fields'}</option>
              ${flatModels.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
            </select>
            <button class="qym-inline-action qym-inline-action--neutral" type="button" data-add-flat${flatModels.length ? '' : ' disabled'}>Add slot from field</button>
          </div>
          <div class="env-hint">Unmapped LLM fields stay plain inputs on the launch form.</div>
        </div>`;
    }

    function render() {
      const removedHtml = st.removed.length
        ? `<div class="env-removed">Removed: ${st.removed.map((slot, i) => `<span class="env-removed-item"><span class="env-mono">${esc(slot.slot_key)}</span>${opts.canEdit ? ` <button class="env-link-btn" type="button" data-slot-restore="${i}">Restore</button>` : ''}</span>`).join(' ')}</div>`
        : '';
      const actions = opts.canEdit && opts.showActions ? `
        <div class="env-editor-actions">
          ${opts.onCancel ? `<button class="shell-btn shell-btn-secondary" type="button" data-slot-cancel>${esc(opts.cancelLabel || 'Cancel')}</button>` : ''}
          <button class="shell-btn shell-btn-primary" type="button" data-slot-confirm${st.busy ? ' disabled' : ''}>${esc(opts.confirmLabel)}</button>
        </div>` : '';
      root.innerHTML = `
        ${st.general ? `<div class="env-callout env-callout--error" role="alert"><div>${esc(st.general)}${st.generalReload ? ' <button class="env-link-btn" type="button" data-slot-reload>Reload slots</button>' : ''}</div></div>` : ''}
        ${st.notice ? `<div class="env-callout" role="status"><div>${esc(st.notice)}</div></div>` : ''}
        <div class="env-slots">${st.slots.length ? st.slots.map(cardHtml).join('') : '<div class="env-empty-state">No LLM slots detected in this schema.</div>'}</div>
        ${removedHtml}
        ${addFormHtml()}
        ${actions}`;
    }

    function clearErrors(key) {
      if (key) delete st.errors[key];
      st.general = '';
      st.generalReload = false;
    }

    function merge(srcIdx, dstIdx) {
      const src = st.slots[srcIdx];
      const dst = st.slots[dstIdx];
      if (!src || !dst) return;
      const dropped = [];
      ROLES.forEach((role) => {
        const pointer = src.field_map[role];
        if (!pointer) return;
        if (!dst.field_map[role]) dst.field_map[role] = pointer;
        else dropped.push(pointer);
      });
      Object.entries(src.transport_fields).forEach(([name, pointer]) => {
        if (!dst.transport_fields[name]) dst.transport_fields[name] = pointer;
        else dropped.push(pointer);
      });
      st.slots.splice(srcIdx, 1);
      clearErrors(dst.slot_key);
      st.notice = `Merged “${src.label || src.slot_key}” into “${dst.label || dst.slot_key}”.${dropped.length ? ` ${dropped.join(', ')} stay plain inputs.` : ''}`;
    }

    function addFlat(pointer) {
      const fields = descriptorFields(st.descriptor);
      const entry = fields[pointer];
      if (!entry) return;
      const name = String(entry.name);
      const upper = name.toUpperCase();
      const suffix = ROLE_RULES.model.suffixes.find((s) => upper.endsWith(s) && upper.length > s.length);
      const prefix = suffix ? name.slice(0, name.length - suffix.length) : name;
      const key = `flat:${prefix}`;
      if (st.slots.some((s) => s.slot_key === key)) {
        st.general = `A slot ${key} already exists.`;
        return;
      }
      const byName = rootByUpperName(st.descriptor);
      const used = usedPointers(-1);
      const slot = normalizeSlot({ slot_key: key, kind: 'flat', label: `${humanize(prefix)} model`, field_map: { model: pointer } });
      ['base_url', 'api_key'].forEach((role) => {
        for (const s of ROLE_RULES[role].suffixes) {
          const candidate = byName[`${prefix}${s}`.toUpperCase()];
          if (candidate && roleFits(candidate, role) && !used.has(candidate.pointer)) {
            slot.field_map[role] = candidate.pointer;
            used.add(candidate.pointer);
            break;
          }
        }
      });
      TRANSPORT.forEach((t) => {
        const candidate = byName[`${prefix}_${t}`.toUpperCase()];
        if (candidate && SCALAR_TYPES.includes(candidate.type) && !used.has(candidate.pointer)) {
          slot.transport_fields[t] = candidate.pointer;
          used.add(candidate.pointer);
        }
      });
      st.slots.push(slot);
      st.removed = st.removed.filter((s) => s.slot_key !== key); // The new slot supersedes it.
      clearErrors();
      st.notice = '';
    }

    async function addEndpoint(name) {
      const key = String(name || '').trim();
      if (!key) { st.general = 'Enter an endpoint name.'; return; }
      if (st.slots.some((s) => s.slot_key === `endpoint:${key}`)) { st.general = `A slot endpoint:${key} already exists.`; return; }
      const res = await request(envPath(opts.projectId, `/${encodeURIComponent(opts.env.id)}/model-slots?propose_endpoint=${encodeURIComponent(key)}`));
      if (!res.ok) { st.general = errorMessage(res.data, 'Could not propose the endpoint slot.'); return; }
      if (!res.data.proposal) { st.general = 'This schema has no endpoint map to add endpoints to.'; return; }
      st.slots.push(normalizeSlot(Object.assign({}, res.data.proposal, { status: 'new' })));
      st.removed = st.removed.filter((s) => s.slot_key !== `endpoint:${key}`);
      clearErrors();
      st.notice = '';
    }

    async function reload() {
      const [slotsRes, formRes] = await Promise.all([
        request(envPath(opts.projectId, `/${encodeURIComponent(opts.env.id)}/model-slots`)),
        request(envPath(opts.projectId, `/${encodeURIComponent(opts.env.id)}/form`)),
      ]);
      if (!slotsRes.ok || !formRes.ok) {
        st.general = errorMessage((slotsRes.ok ? formRes : slotsRes).data, 'Could not reload the slots.');
        return;
      }
      st.slots = (slotsRes.data.slots || []).map(normalizeSlot);
      st.removed = [];
      st.errors = {};
      st.schemaId = slotsRes.data.schema_id;
      st.descriptor = formRes.data.descriptor || st.descriptor;
      clearErrors();
      st.notice = 'Reloaded the slots of the current schema.';
    }

    /** PUT the slots; resolves to the response payload, or null on error. */
    async function confirm() {
      const missing = st.slots.filter((s) => !s.field_map.model);
      st.errors = {};
      if (missing.length) {
        missing.forEach((s) => { st.errors[s.slot_key] = ['Pick a model field, or remove this slot.']; });
        st.general = 'Every slot needs a model field.';
        render();
        return null;
      }
      st.busy = true;
      clearErrors();
      render();
      const body = {
        slots: st.slots.map((s) => ({
          slot_key: s.slot_key,
          kind: s.kind,
          label: String(s.label || '').trim(),
          field_map: s.field_map,
          transport_fields: s.transport_fields,
        })),
        schema_id: st.schemaId,
      };
      const res = await request(envPath(opts.projectId, `/${encodeURIComponent(opts.env.id)}/model-slots`), sendJson('PUT', body));
      st.busy = false;
      if (res.ok) {
        st.slots = (res.data.slots || []).map(normalizeSlot);
        st.removed = [];
        st.notice = '';
        render();
        return res.data;
      }
      const detail = res.data && res.data.detail;
      if (res.status === 422 && detail && Array.isArray(detail.errors)) {
        detail.errors.forEach((e) => {
          if (e && e.slot_key && st.slots.some((s) => s.slot_key === e.slot_key)) {
            (st.errors[e.slot_key] = st.errors[e.slot_key] || []).push(e.message);
          } else {
            st.general = [st.general, e && e.message].filter(Boolean).join(' ');
          }
        });
        if (!st.general) st.general = 'Fix the highlighted slots, then confirm again.';
      } else {
        st.general = errorMessage(res.data, 'Could not confirm the slots.');
        st.generalReload = res.status === 409;
      }
      render();
      return null;
    }

    root.addEventListener('input', (event) => {
      const target = event.target;
      if (target.dataset.slotLabel != null) {
        const slot = st.slots[Number(target.dataset.slotLabel)];
        if (slot) slot.label = target.value;
      }
    });

    root.addEventListener('change', (event) => {
      const target = event.target;
      if (target.dataset.slotRole != null) {
        const slot = st.slots[Number(target.dataset.slotRole)];
        if (!slot) return;
        slot.field_map[target.dataset.role] = target.value || null;
        clearErrors(slot.slot_key);
        render();
      } else if (target.dataset.slotMerge != null && target.value !== '') {
        merge(Number(target.dataset.slotMerge), Number(target.value));
        render();
      }
    });

    root.addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button || !root.contains(button)) return;
      const data = button.dataset;
      if (data.slotRemove != null) {
        const [slot] = st.slots.splice(Number(data.slotRemove), 1);
        if (slot) st.removed.push(slot);
        if (slot) clearErrors(slot.slot_key);
        st.notice = '';
        render();
      } else if (data.slotRestore != null) {
        const [slot] = st.removed.splice(Number(data.slotRestore), 1);
        if (slot && st.slots.some((s) => s.slot_key === slot.slot_key)) {
          st.general = `A slot ${slot.slot_key} already exists; remove it first to restore the old one.`;
          st.removed.push(slot);
        } else if (slot) {
          // Fields another slot claimed meanwhile cannot be shared.
          const used = usedPointers(-1);
          ROLES.forEach((role) => { if (slot.field_map[role] && used.has(slot.field_map[role])) slot.field_map[role] = null; });
          Object.keys(slot.transport_fields).forEach((n) => { if (used.has(slot.transport_fields[n])) delete slot.transport_fields[n]; });
          st.slots.push(slot);
        }
        render();
      } else if (data.slotDetach != null) {
        const slot = st.slots[Number(data.slotDetach)];
        if (slot) { delete slot.transport_fields[data.name]; clearErrors(slot.slot_key); }
        render();
      } else if (data.addEndpoint != null) {
        const input = root.querySelector('[data-add-endpoint-name]');
        const done = spinnerLabel(button, '');
        await addEndpoint(input ? input.value : '');
        done();
        render();
      } else if (data.addFlat != null) {
        const select = root.querySelector('[data-add-flat-model]');
        if (select && select.value) addFlat(select.value);
        render();
      } else if (data.slotReload != null) {
        await reload();
        render();
      } else if (data.slotCancel != null) {
        if (opts.onCancel) opts.onCancel();
      } else if (data.slotConfirm != null) {
        const result = await confirm();
        if (result && opts.onConfirmed) opts.onConfirmed(result);
      }
    });

    render();
    return {
      confirm,
      reload: async () => { await reload(); render(); },
      getSlots: () => clone(st.slots),
      isBusy: () => st.busy,
    };
  }

  // ── Add-environment dialog (3 steps) ───────────────────────────────────
  const STEPS = [
    { id: 1, label: 'Connect' },
    { id: 2, label: 'Review settings' },
    { id: 3, label: 'Group LLM settings' },
  ];

  function openAddDialog(options) {
    const opts = options || {};
    const existing = document.getElementById('env-add-dialog');
    if (existing) existing.remove();
    const st = { step: 1, env: null, slots: [], schemaId: null, descriptor: null, editor: null, changed: false };

    const backdrop = document.createElement('div');
    backdrop.id = 'env-add-dialog';
    backdrop.className = 'shell-modal-backdrop env-dialog-backdrop';
    backdrop.innerHTML = `
      <div class="shell-modal env-dialog" role="dialog" aria-modal="true" aria-labelledby="env-add-title">
        <div class="shell-modal-header">
          <div class="shell-modal-title" id="env-add-title">Add environment</div>
          <button class="shell-modal-close qym-icon-action" type="button" data-env-dialog-close aria-label="Close">&times;</button>
        </div>
        <div class="shell-modal-body env-dialog-body">
          <ol class="env-steps" aria-label="Steps">
            ${STEPS.map((s) => `<li class="env-step" data-step="${s.id}"><span class="env-step-num">${s.id}</span>${esc(s.label)}</li>`).join('')}
          </ol>
          <div data-step-panel="1">
            <div class="env-callout" role="note">
              <div>
                <strong>Ingest with this project's key.</strong> The deployment must send its runs to qym with an API key of
                <em>this</em> project (<span class="env-mono">QYM_API_KEY</span>), otherwise its results land in another project.
                <button class="env-link-btn" type="button" data-env-goto-keys>Create a project API key</button>
              </div>
            </div>
            <form class="env-connect-form" data-env-connect-form autocomplete="off" novalidate>
              <div class="shell-form-group">
                <label class="shell-form-label" for="env-add-name">Name</label>
                <input class="shell-form-input" id="env-add-name" name="name" type="text" maxlength="200" placeholder="e.g. staging" required>
              </div>
              <div class="shell-form-group">
                <label class="shell-form-label" for="env-add-url">Base URL</label>
                <input class="shell-form-input env-mono-input" id="env-add-url" name="base_url" type="url" maxlength="500" placeholder="https://evals.example.com/api" required>
                <div class="env-hint">Include the service's <span class="env-mono">EVAL_SERVER_PREFIX</span>; qym appends <span class="env-mono">/evals</span>. A URL registered in another project is refused.</div>
              </div>
              <div class="shell-form-group">
                <label class="shell-form-label" for="env-add-key">API key</label>
                <input class="shell-form-input env-mono-input" id="env-add-key" name="api_key" type="password" maxlength="4096" autocomplete="new-password" spellcheck="false" required>
                <div class="env-hint">Stored encrypted; only its last four characters are shown afterwards.</div>
              </div>
              <div class="env-error" data-env-connect-error role="alert"></div>
            </form>
          </div>
          <div data-step-panel="2" hidden></div>
          <div data-step-panel="3" hidden></div>
        </div>
        <div class="shell-modal-footer" data-env-dialog-footer></div>
      </div>`;
    document.body.appendChild(backdrop);

    const $ = (selector) => backdrop.querySelector(selector);
    const panel = (n) => backdrop.querySelector(`[data-step-panel="${n}"]`);

    function close() {
      document.removeEventListener('keydown', onKey);
      backdrop.remove();
      if (st.changed && opts.onChange) opts.onChange(st.env);
    }

    function onKey(event) {
      if (event.key === 'Escape' && document.body.contains(backdrop)) { event.preventDefault(); close(); }
    }

    function renderFooter() {
      const footer = $('[data-env-dialog-footer]');
      if (st.step === 1) {
        footer.innerHTML = `
          <button class="shell-btn shell-btn-secondary" type="button" data-env-dialog-close>Cancel</button>
          <button class="shell-btn shell-btn-primary" type="button" data-env-connect>Test &amp; connect</button>`;
      } else if (st.step === 2) {
        footer.innerHTML = `
          <span class="env-footer-note">“${esc(st.env && st.env.name)}” is saved.</span>
          <button class="shell-btn shell-btn-secondary" type="button" data-env-dialog-close>Close</button>
          <button class="shell-btn shell-btn-primary" type="button" data-env-next>Next: group LLM settings</button>`;
      } else {
        footer.innerHTML = `
          <button class="shell-btn shell-btn-secondary" type="button" data-env-back>Back</button>
          <button class="shell-btn shell-btn-secondary" type="button" data-env-skip title="The launch form shows LLM fields as raw inputs until you confirm">Skip for now</button>
          <button class="shell-btn shell-btn-primary" type="button" data-env-confirm>Confirm</button>`;
      }
    }

    function showStep(step) {
      st.step = step;
      backdrop.querySelectorAll('.env-step').forEach((li) => {
        const n = Number(li.dataset.step);
        li.classList.toggle('is-done', n < step);
        if (n === step) li.setAttribute('aria-current', 'step');
        else li.removeAttribute('aria-current');
      });
      [1, 2, 3].forEach((n) => { panel(n).hidden = n !== step; });
      renderFooter();
    }

    async function connect(button) {
      const errorEl = $('[data-env-connect-error]');
      const name = $('#env-add-name').value.trim();
      const baseUrl = $('#env-add-url').value.trim();
      const keyInput = $('#env-add-key');
      const apiKey = keyInput.value.trim();
      errorEl.textContent = '';
      if (!name || !baseUrl || !apiKey) {
        errorEl.textContent = 'Name, base URL and API key are required.';
        return;
      }
      const done = spinnerLabel(button, 'Connecting…');
      const res = await request(envPath(opts.projectId), sendJson('POST', { name, base_url: baseUrl, api_key: apiKey }));
      done();
      if (!res.ok) {
        errorEl.textContent = errorMessage(res.data, 'Could not connect to the Evaluation Service.');
        return;
      }
      keyInput.value = ''; // The key now lives only (encrypted) on the server.
      st.env = res.data.environment;
      st.slots = res.data.slots || [];
      st.schemaId = st.env.current_schema_id;
      st.changed = true;
      backdrop.querySelectorAll('[data-env-connect-form] input').forEach((input) => { input.disabled = true; });
      toast(`Connected “${st.env.name}”`, 'success');
      showStep(2);
      await loadPreview();
    }

    async function loadPreview() {
      const target = panel(2);
      target.innerHTML = '<div class="env-loading"><span class="env-spinner" aria-hidden="true"></span>Loading the generated form…</div>';
      const res = await request(envPath(opts.projectId, `/${encodeURIComponent(st.env.id)}/form`));
      if (!res.ok) {
        target.innerHTML = `<div class="env-callout env-callout--error" role="alert"><div>${esc(errorMessage(res.data, 'Could not load the generated form.'))}</div></div>`;
        return;
      }
      st.descriptor = res.data.descriptor || {};
      st.schemaId = res.data.schema_id || st.schemaId;
      target.innerHTML = renderFormPreview(st.descriptor);
    }

    function showGrouping() {
      showStep(3);
      if (st.editor) return;
      const target = panel(3);
      target.innerHTML = `
        <p class="env-step-intro">One card per LLM the service can call. Confirm the grouping so the launch form can bind project models to each slot; fields left out stay plain inputs.</p>
        <div data-env-editor></div>`;
      st.editor = createSlotEditor({
        container: target.querySelector('[data-env-editor]'),
        projectId: opts.projectId,
        env: st.env,
        descriptor: st.descriptor || { fields: {}, root: [] },
        schemaId: st.schemaId,
        slots: st.slots,
        canEdit: true,
        showActions: false,
      });
    }

    backdrop.addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const data = button.dataset;
      if (data.envDialogClose != null) close();
      else if (data.envGotoKeys != null) { close(); if (opts.onGotoApiKeys) opts.onGotoApiKeys(); }
      else if (data.envConnect != null) await connect(button);
      else if (data.envNext != null) {
        if (!st.descriptor) await loadPreview();
        showGrouping();
      } else if (data.envBack != null) showStep(2);
      else if (data.envSkip != null) {
        toast(`“${st.env.name}” saved. Group its LLM settings from the environment drawer.`, 'info');
        close();
      } else if (data.envConfirm != null && st.editor) {
        const done = spinnerLabel(button, 'Confirming…');
        const result = await st.editor.confirm();
        done();
        if (result) {
          toast(`LLM settings grouped for “${st.env.name}”`, 'success');
          close();
        }
      }
    });
    backdrop.querySelector('[data-env-connect-form]').addEventListener('submit', (event) => {
      event.preventDefault();
      connect(backdrop.querySelector('[data-env-connect]'));
    });
    document.addEventListener('keydown', onKey);
    showStep(1);
    setTimeout(() => { const input = $('#env-add-name'); if (input) input.focus(); }, 50);
    return { close };
  }

  // ── Detail drawer ──────────────────────────────────────────────────────
  function diffHtml(diff) {
    if (!diff) return '';
    if (!diff.changed) {
      return `<div class="env-callout" role="status"><div>Schema unchanged <span class="env-mono">${esc(shortHash(diff.schema_hash))}</span>.</div></div>`;
    }
    const list = (items, cls, marker, fmt) => {
      if (!items.length) return '';
      const shown = items.slice(0, DIFF_LIMIT).map((item) => `<li class="env-diff-line env-diff-line--${cls}"><span aria-hidden="true">${marker}</span> ${fmt(item)}</li>`).join('');
      const more = items.length > DIFF_LIMIT ? `<li class="env-meta">and ${esc(items.length - DIFF_LIMIT)} more</li>` : '';
      return shown + more;
    };
    const added = diff.added || [];
    const removed = diff.removed || [];
    const changed = diff.changed_types || [];
    const first = !diff.previous_schema_id;
    return `
      <div class="env-diff" role="status">
        <div class="env-diff-summary">${first ? 'First schema stored' : 'Schema changed'} · <span class="env-mono">${esc(shortHash(diff.schema_hash))}</span> ·
          ${esc(added.length)} added · ${esc(removed.length)} removed · ${esc(changed.length)} type changes</div>
        <ul class="env-diff-list">
          ${list(added, 'added', '+', (p) => esc(p))}
          ${list(removed, 'removed', '−', (p) => esc(p))}
          ${list(changed, 'changed', '~', (c) => `${esc(c.pointer)} <span class="env-meta">${esc(c.from)} → ${esc(c.to)}</span>`)}
        </ul>
      </div>`;
  }

  function openEnvironmentDrawer(options) {
    const opts = options || {};
    if (!window.QymShell || !window.QymShell.openDrawer) return null;
    const canManage = !!opts.canManage;
    const st = { env: opts.env, slots: [], schemaId: null, descriptor: null, loadError: '', diff: null, editing: false, editor: null, keysTouched: false };

    /** Loose client-side mirror of normalize_environment_url, for comparison only. */
    function normalizeUrl(value) {
      let url = String(value || '').trim();
      try {
        const parsed = new URL(url);
        const port = parsed.port && !((parsed.protocol === 'https:' && parsed.port === '443') || (parsed.protocol === 'http:' && parsed.port === '80')) ? `:${parsed.port}` : '';
        url = `${parsed.protocol}//${parsed.hostname.toLowerCase()}${port}${parsed.pathname}`;
      } catch (_) { /* compare the raw text */ }
      url = url.replace(/\/+$/, '');
      while (/\/evals$/i.test(url)) url = url.replace(/\/evals$/i, '').replace(/\/+$/, '');
      return url;
    }
    function urlChanged(value) { return normalizeUrl(value) !== normalizeUrl(st.env.base_url); }
    const drawer = window.QymShell.openDrawer({ title: st.env.name, subtitle: st.env.base_url, width: 640 });
    drawer.el.querySelector('.shell-drawer').classList.add('env-drawer');

    function notifyChange() { if (opts.onChange) opts.onChange(st.env); }

    async function loadDetails() {
      const id = encodeURIComponent(st.env.id);
      const [envRes, slotsRes, formRes] = await Promise.all([
        request(envPath(opts.projectId, `/${id}`)),
        request(envPath(opts.projectId, `/${id}/model-slots`)),
        request(envPath(opts.projectId, `/${id}/form`)),
      ]);
      if (envRes.ok) st.env = envRes.data;
      st.loadError = '';
      if (slotsRes.ok && formRes.ok) {
        st.slots = slotsRes.data.slots || [];
        st.schemaId = slotsRes.data.schema_id;
        st.descriptor = formRes.data.descriptor || {};
      } else {
        st.slots = [];
        st.descriptor = null;
        st.loadError = errorMessage((slotsRes.ok ? formRes : slotsRes).data, 'Could not load the schema.');
      }
    }

    function statusSection() {
      const env = st.env;
      const keyText = env.api_key_set ? `<span class="env-mono">${esc(env.api_key_hint || 'set')}</span>` : '<span class="env-warning-text">Not set</span>';
      return `
        <section class="env-section">
          <div class="env-section-head">
            <div><div class="env-section-title">Status</div></div>
            <div class="env-section-actions">
              ${canManage && !env.is_active ? '<button class="qym-inline-action qym-inline-action--accent" type="button" data-drawer-reactivate>Re-enable</button>' : ''}
              ${canManage ? '<button class="qym-inline-action qym-inline-action--neutral" type="button" data-drawer-test>Test connection</button>' : ''}
            </div>
          </div>
          <dl class="env-kv">
            <dt>State</dt><dd>${env.is_active ? 'Active' : '<span class="qym-tag qym-tag--warning">Disabled</span>'}</dd>
            <dt>Health</dt><dd>${healthHtml(env)}${env.health_status === 'error' && env.health_error ? `<div class="env-error-text">${esc(env.health_error)}</div>` : ''}</dd>
            <dt>API key</dt><dd>${keyText}</dd>
            <dt>Official defaults</dt><dd>${officialPresetVersionHtml(env)}</dd>
            <dt>Created</dt><dd><span class="env-mono">${esc(absTime(env.created_at) || '—')}</span></dd>
          </dl>
        </section>`;
    }

    function schemaSection() {
      const env = st.env;
      return `
        <section class="env-section">
          <div class="env-section-head">
            <div>
              <div class="env-section-title">Schema</div>
              <div class="env-section-desc">The launch form is generated from the service's env-overrides schema.</div>
            </div>
            <div class="env-section-actions">
              ${canManage ? '<button class="qym-inline-action qym-inline-action--neutral" type="button" data-drawer-refresh>Refresh schema</button>' : ''}
            </div>
          </div>
          <dl class="env-kv">
            <dt>Hash</dt><dd>${env.schema_hash ? `<span class="env-mono" title="${esc(env.schema_hash)}">${esc(shortHash(env.schema_hash))}</span>` : '—'}</dd>
            <dt>Fetched</dt><dd><span class="env-mono" title="${esc(absTime(env.schema_fetched_at))}">${esc(relTime(env.schema_fetched_at) || '—')}</span></dd>
            <dt>Settings</dt><dd><span class="env-mono">${st.descriptor ? esc(countFields(st.descriptor)) : '—'}</span></dd>
          </dl>
          <div data-drawer-diff>${diffHtml(st.diff)}</div>
        </section>`;
    }

    function slotsSection() {
      const needs = st.slots.some((s) => s.status !== 'confirmed');
      const banner = needs
        ? `<div class="env-callout env-callout--warning" role="note"><div>Group LLM settings to pick project models. Until then the launch form shows LLM fields as raw inputs.</div></div>`
        : '';
      return `
        <section class="env-section">
          <div class="env-section-head">
            <div>
              <div class="env-section-title">LLM model slots</div>
              <div class="env-section-desc">Which schema fields a project model fills at launch.</div>
            </div>
            <div class="env-section-actions">
              ${canManage && st.descriptor && !st.editing ? `<button class="qym-inline-action ${needs ? 'qym-inline-action--accent' : 'qym-inline-action--neutral'}" type="button" data-drawer-edit-slots>${needs ? 'Group LLM settings' : 'Edit grouping'}</button>` : ''}
            </div>
          </div>
          ${st.loadError ? `<div class="env-callout env-callout--error" role="alert"><div>${esc(st.loadError)}</div></div>` : banner}
          <div data-drawer-slots></div>
        </section>`;
    }

    /** Shown while HIGH is the max priority: HIGH launches preempt everyone (§5.3). */
    function highWarningHtml(maxPriority) {
      if (maxPriority !== 'HIGH') return '';
      return `<div class="env-callout env-callout--warning" role="note"><div>${esc(highPriorityWarning(st.env.name))}</div></div>`;
    }

    function settingsSection() {
      const env = st.env;
      const disabled = canManage ? '' : ' disabled';
      const priorityOptions = (selected) => PRIORITIES.map((p) => `<option value="${p}"${p === selected ? ' selected' : ''}>${p}</option>`).join('');
      return `
        <section class="env-section">
          <div class="env-section-head"><div>
            <div class="env-section-title">Ranking</div>
            <div class="env-section-desc">How best runs on this environment are ranked (plan §10.2).</div>
          </div></div>
          <div class="env-form-grid">
            <div class="shell-form-group">
              <label class="shell-form-label" for="env-drawer-metric">Ranking metric</label>
              <input class="shell-form-input env-mono-input" id="env-drawer-metric" type="text" maxlength="200" value="${esc(env.ranking_metric || '')}" placeholder="Project default"${disabled}>
            </div>
            <div class="shell-form-group">
              <label class="shell-form-label" for="env-drawer-k">k</label>
              <input class="shell-form-input env-mono-input" id="env-drawer-k" type="number" min="1" max="1000" step="1" value="${esc(env.ranking_k == null ? '' : env.ranking_k)}" placeholder="—"${disabled}>
            </div>
          </div>
        </section>
        <section class="env-section">
          <div class="env-section-head"><div>
            <div class="env-section-title">Policies</div>
            <div class="env-section-desc">Limits applied to experiments launched on this environment.</div>
          </div></div>
          <div class="env-form-grid">
            <div class="shell-form-group">
              <label class="shell-form-label" for="env-drawer-max-priority">Max priority</label>
              <select class="shell-form-input" id="env-drawer-max-priority"${disabled}>${priorityOptions(env.max_priority)}</select>
            </div>
            <div class="shell-form-group">
              <label class="shell-form-label" for="env-drawer-default-priority">Default priority</label>
              <select class="shell-form-input" id="env-drawer-default-priority"${disabled}>${priorityOptions(env.default_priority)}</select>
            </div>
            <div class="shell-form-group">
              <label class="shell-form-label" for="env-drawer-inflight">Max in-flight jobs</label>
              <input class="shell-form-input env-mono-input" id="env-drawer-inflight" type="number" min="1" max="1000" step="1" value="${esc(env.max_inflight_jobs)}"${disabled}>
            </div>
          </div>
          <div data-drawer-high-warning>${highWarningHtml(env.max_priority)}</div>
          <label class="shell-form-checkbox" for="env-drawer-connection-keys">
            <input type="checkbox" id="env-drawer-connection-keys"${env.allow_connection_keys ? ' checked' : ''}${disabled}>
            <span class="shell-form-checkbox-copy">
              <span class="shell-form-checkbox-label">Allow connection keys</span>
              <span class="shell-form-checkbox-help" data-drawer-keys-help>${esc(KEYS_HELP)}</span>
            </span>
          </label>
        </section>
        ${canManage ? `
        <section class="env-section">
          <div class="env-section-head"><div>
            <div class="env-section-title">Connection</div>
            <div class="env-section-desc">Changing the URL or key resets health until the next test.</div>
          </div></div>
          <div class="shell-form-group">
            <label class="shell-form-label" for="env-drawer-name">Name</label>
            <input class="shell-form-input" id="env-drawer-name" type="text" maxlength="200" value="${esc(env.name)}">
          </div>
          <div class="shell-form-group">
            <label class="shell-form-label" for="env-drawer-url">Base URL</label>
            <input class="shell-form-input env-mono-input" id="env-drawer-url" type="url" maxlength="500" value="${esc(env.base_url)}">
          </div>
          <div class="shell-form-group">
            <label class="shell-form-label" for="env-drawer-key">API key</label>
            <input class="shell-form-input env-mono-input" id="env-drawer-key" type="password" maxlength="4096" autocomplete="new-password" spellcheck="false" placeholder="${esc(env.api_key_set ? `Leave blank to keep ${env.api_key_hint || 'the stored key'}` : 'Paste the service API key')}">
          </div>
        </section>` : ''}
        <div class="env-error" data-drawer-error role="alert"></div>`;
    }

    function renderSlots() {
      const target = drawer.body.querySelector('[data-drawer-slots]');
      if (!target) return;
      if (!st.descriptor) { target.innerHTML = ''; return; }
      st.editor = createSlotEditor({
        container: target,
        projectId: opts.projectId,
        env: st.env,
        descriptor: st.descriptor,
        schemaId: st.schemaId,
        slots: st.slots,
        canEdit: canManage && st.editing,
        onCancel: () => { st.editing = false; renderSection('slots'); },
        onConfirmed: (payload) => {
          st.slots = payload.slots || [];
          st.schemaId = payload.schema_id || st.schemaId;
          st.editing = false;
          toast(`LLM settings grouped for “${st.env.name}”`, 'success');
          refreshEnv().then(() => { renderSection('slots'); notifyChange(); });
        },
      });
    }

    /** Official defaults and saved presets (#30): eval_official_defaults.js fills it. */
    function presetsSection() {
      return '<div data-drawer-presets></div>';
    }

    function renderPresets() {
      const target = drawer.body.querySelector('[data-drawer-presets]');
      if (!target || !window.QymOfficialDefaults) return;
      window.QymOfficialDefaults.renderDrawerSection(target, {
        projectId: opts.projectId,
        projectSlug: opts.projectSlug || projectSlugFromPath(),
        env: st.env,
        // Only the settings page hosts the editor; elsewhere the history is read-only.
        onEdit: opts.onEditOfficial ? (payload) => {
          drawer.close();
          opts.onEditOfficial(Object.assign({ env: st.env }, payload));
        } : null,
      });
    }

    const SECTIONS = { status: statusSection, schema: schemaSection, slots: slotsSection, presets: presetsSection, settings: settingsSection };

    /** Re-render one section only, so unsaved inputs elsewhere survive. */
    function renderSection(name) {
      const el = drawer.body.querySelector(`[data-sec="${name}"]`);
      if (!el) return;
      if (name === 'settings') st.keysTouched = false;
      el.innerHTML = SECTIONS[name]();
      if (name === 'slots') renderSlots();
      if (name === 'presets') renderPresets();
    }

    function render() {
      drawer.setTitle(st.env.name);
      drawer.setSubtitle(st.env.base_url);
      st.keysTouched = false;
      drawer.setBody(Object.keys(SECTIONS).map((name) => `<div class="env-section-slot" data-sec="${name}">${SECTIONS[name]()}</div>`).join(''));
      renderSlots();
      renderPresets();
      drawer.setFooter(canManage ? `
        <button class="shell-btn shell-btn-danger env-footer-start" type="button" data-drawer-delete>Delete environment</button>
        <button class="shell-btn shell-btn-secondary" type="button" data-drawer-close>Close</button>
        <button class="shell-btn shell-btn-primary" type="button" data-drawer-save>Save changes</button>` : null);
    }

    /** After an environment update: refresh everything but an open slot editor. */
    function renderEnvSections() {
      drawer.setTitle(st.env.name);
      drawer.setSubtitle(st.env.base_url);
      ['status', 'schema', 'presets', 'settings'].forEach(renderSection);
      if (!st.editing) renderSection('slots');
    }

    async function refreshEnv() {
      const res = await request(envPath(opts.projectId, `/${encodeURIComponent(st.env.id)}`));
      if (res.ok) st.env = res.data;
    }

    function setError(message) {
      const el = drawer.body.querySelector('[data-drawer-error]');
      if (el) el.textContent = message || '';
    }

    function readInt(id, label) {
      const raw = drawer.body.querySelector(id).value.trim();
      if (!raw) return { value: null };
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1 || value > 1000) return { error: `${label} must be a whole number from 1 to 1000.` };
      return { value };
    }

    async function save(button) {
      const q = (id) => drawer.body.querySelector(id);
      const k = readInt('#env-drawer-k', 'k');
      const inflight = readInt('#env-drawer-inflight', 'Max in-flight jobs');
      if (k.error || inflight.error) { setError(k.error || inflight.error); return; }
      if (inflight.value == null) { setError('Max in-flight jobs is required.'); return; }
      const name = q('#env-drawer-name').value.trim();
      const baseUrl = q('#env-drawer-url').value.trim();
      if (!name || !baseUrl) { setError('Name and base URL are required.'); return; }
      const body = {
        name,
        base_url: baseUrl,
        ranking_metric: q('#env-drawer-metric').value.trim() || null,
        ranking_k: k.value,
        max_priority: q('#env-drawer-max-priority').value,
        default_priority: q('#env-drawer-default-priority').value,
        max_inflight_jobs: inflight.value,
      };
      // A moved URL without an explicit re-opt-in omits the flag, so the backend
      // turns connection keys off for the new host.
      if (!urlChanged(baseUrl) || st.keysTouched) {
        body.allow_connection_keys = q('#env-drawer-connection-keys').checked;
      }
      const keyInput = q('#env-drawer-key');
      const apiKey = keyInput.value.trim();
      if (apiKey) body.api_key = apiKey; // Omitted: the stored key is kept.
      setError('');
      const done = spinnerLabel(button, 'Saving…');
      const res = await request(envPath(opts.projectId, `/${encodeURIComponent(st.env.id)}`), sendJson('PUT', body));
      done();
      if (!res.ok) { setError(errorMessage(res.data, 'Could not save the environment.')); return; }
      keyInput.value = '';
      st.env = res.data;
      toast(`Saved “${st.env.name}”`, 'success');
      renderEnvSections();
      notifyChange();
    }

    async function test(button) {
      const done = spinnerLabel(button, 'Testing…');
      const res = await request(envPath(opts.projectId, `/${encodeURIComponent(st.env.id)}/test`), sendJson('POST'));
      done();
      if (!res.ok) toast(errorMessage(res.data, 'Test failed'), 'error');
      else if (res.data.ok) toast(res.data.schema_changed ? `“${st.env.name}” is healthy; its schema changed, refresh it to update the form.` : `“${st.env.name}” is healthy`, 'success');
      else toast(`“${st.env.name}” failed: ${res.data.error || 'unreachable'}`, 'error');
      await refreshEnv();
      renderSection('status');
      notifyChange();
    }

    async function refreshSchema(button) {
      const done = spinnerLabel(button, 'Refreshing…');
      const res = await request(envPath(opts.projectId, `/${encodeURIComponent(st.env.id)}/schema/refresh`), sendJson('POST'));
      done();
      if (!res.ok) {
        toast(errorMessage(res.data, 'Schema refresh failed'), 'error');
        await refreshEnv();
        renderSection('status');
        notifyChange();
        return;
      }
      st.diff = res.data;
      await loadDetails();
      st.editing = canManage && !!res.data.needs_confirmation;
      ['status', 'schema', 'slots', 'presets'].forEach(renderSection);
      notifyChange();
    }

    async function remove() {
      const ok = await confirmDialog({
        title: 'Delete environment?',
        description: [
          `Delete “${st.env.name}” and its stored schemas and LLM slots.`,
          'If experiments or presets use it, it is disabled instead so their history stays intact.',
        ],
        confirmLabel: 'Delete environment',
        confirmClass: 'shell-btn-danger',
      });
      if (!ok) return;
      const res = await request(envPath(opts.projectId, `/${encodeURIComponent(st.env.id)}`), sendJson('DELETE'));
      if (!res.ok) { setError(errorMessage(res.data, 'Could not delete the environment.')); return; }
      toast(res.data.deleted ? `Deleted “${st.env.name}”` : `“${st.env.name}” is in use, so it was disabled`, 'success');
      drawer.close();
      notifyChange();
    }

    async function reactivate(button) {
      const done = spinnerLabel(button, '');
      const res = await request(envPath(opts.projectId, `/${encodeURIComponent(st.env.id)}`), sendJson('PUT', { is_active: true }));
      done();
      if (!res.ok) { toast(errorMessage(res.data, 'Could not re-enable the environment.'), 'error'); return; }
      st.env = res.data;
      renderEnvSections();
      notifyChange();
    }

    // The connection-key opt-in was given for the stored host (backend rule): while
    // the URL input points elsewhere, show it off unless the manager re-ticks it.
    drawer.el.addEventListener('input', (event) => {
      if (event.target.id !== 'env-drawer-url' || st.keysTouched) return;
      const checkbox = drawer.body.querySelector('#env-drawer-connection-keys');
      const help = drawer.body.querySelector('[data-drawer-keys-help]');
      if (!checkbox) return;
      const moved = urlChanged(event.target.value);
      checkbox.checked = moved ? false : !!st.env.allow_connection_keys;
      if (help) help.textContent = moved && st.env.allow_connection_keys ? KEYS_HELP_MOVED : KEYS_HELP;
    });
    drawer.el.addEventListener('change', (event) => {
      if (event.target.id === 'env-drawer-connection-keys') st.keysTouched = true;
      if (event.target.id === 'env-drawer-max-priority') {
        const slot = drawer.body.querySelector('[data-drawer-high-warning]');
        if (slot) slot.innerHTML = highWarningHtml(event.target.value);
      }
    });

    drawer.el.addEventListener('click', async (event) => {
      const button = event.target.closest('button');
      if (!button || !drawer.el.contains(button)) return;
      const data = button.dataset;
      if (data.drawerTest != null) await test(button);
      else if (data.drawerRefresh != null) await refreshSchema(button);
      else if (data.drawerEditSlots != null) { st.editing = true; renderSection('slots'); }
      else if (data.drawerSave != null) await save(button);
      else if (data.drawerDelete != null) await remove();
      else if (data.drawerClose != null) drawer.close();
      else if (data.drawerReactivate != null) await reactivate(button);
    });

    drawer.setBody('<div class="env-loading"><span class="env-spinner" aria-hidden="true"></span>Loading…</div>');
    loadDetails().then(() => {
      st.editing = canManage && !!opts.editSlots && !!st.descriptor;
      render();
    });
    return drawer;
  }

  // ── "Run official defaults" (plan §9.2, issue #31) ─────────────────────
  // services/eval_priority.PREEMPTION_ACK_REQUIRED
  const PREEMPTION_ACK_REQUIRED = 'preemption_acknowledgement_required';

  function canRunOfficial(env) {
    return !!(env && env.is_active && env.current_schema_id && env.official_preset_id && env.official_preset_version != null);
  }

  function projectSlugFromPath() {
    const match = window.location.pathname.match(/\/projects\/([^/]+)(?:\/|$)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function experimentsUrl(slug, query) {
    const root = (window.__QYM_ROOT_PATH__ || '').replace(/\/$/, '');
    return `${root}/projects/${encodeURIComponent(slug)}/experiments?${query}`;
  }

  function navigateTo(url) {
    if (window.QymShell && window.QymShell.navigateTo) window.QymShell.navigateTo(url);
    else window.location.href = url;
  }

  /**
   * Why a re-mapped official version cannot launch in one click (null when it can).
   *
   * Temporary models: official defaults never hold one (publishing refuses them,
   * plan §9.1), and a key is never stored in a preset (§7.5). A temporary binding
   * found here is therefore stale data. It is not quietly switched to Inherit
   * (that would run a different model than the official defaults name): the launch
   * form opens instead, where the key can be entered or the slot changed.
   */
  function officialLaunchBlocker(env, version, remap) {
    const label = `Official defaults v${version.version}`;
    if (!remap || remap.ok === false || (remap.errors || []).length) {
      return `${label} need changes for the current schema of “${env.name}”.`;
    }
    const config = remap.config || {};
    const evaluator = config.evaluator || {};
    if (typeof evaluator.dataset !== 'string' || !evaluator.dataset) {
      return `${label} do not name a dataset; pick one.`;
    }
    const bindings = config.slot_bindings || {};
    if (Object.keys(bindings).some((key) => bindings[key] && typeof bindings[key] === 'object' && bindings[key].temporary)) {
      return `${label} use a temporary model, which needs its API key.`;
    }
    const models = (version.warnings || []).filter((w) => w && (w.rule === 'connection_missing' || w.rule === 'connection_unavailable'));
    if (models.length) return models[0].message || 'A model of the official defaults is not available.';
    return null;
  }

  /**
   * One click: a 1-job experiment on ``env`` with ``base_source = {kind: official,
   * preset_version_id}`` and the current official version re-mapped onto the
   * environment's current schema (§9.2, §9.3). When it cannot launch as is (no
   * dataset, re-map errors, a missing model, HIGH default for a non-manager,
   * validation errors) the launch form opens on that environment instead, where
   * Official defaults is the default base. HIGH asks for the §5.3 acknowledgement.
   */
  async function runOfficialDefaults(options) {
    const opts = options || {};
    const env = opts.env || {};
    const slug = opts.projectSlug || projectSlugFromPath();
    const review = (reason) => {
      toast(`${reason} Opening the launch form.`, 'info');
      navigateTo(experimentsUrl(slug, `new=1&env=${encodeURIComponent(env.id)}`));
      return null;
    };
    if (!canRunOfficial(env)) {
      toast(`No official defaults are published for “${env.name || 'this environment'}”.`, 'error');
      return null;
    }
    const res = await request(envPath(opts.projectId, `/${encodeURIComponent(env.id)}/presets/${encodeURIComponent(env.official_preset_id)}/versions/${encodeURIComponent(env.official_preset_version)}?remap=current`));
    if (!res.ok) {
      toast(errorMessage(res.data, 'Could not load the official defaults'), 'error');
      return null;
    }
    const version = res.data.version || {};
    const remap = res.data.remap;
    const blocker = officialLaunchBlocker(env, version, remap);
    if (blocker) return review(blocker);
    if ((remap.dropped || []).length) {
      const ok = await confirmDialog({
        title: 'Launch official defaults?',
        description: [remap.summary || 'Some settings are no longer supported.', 'Those settings keep the environment’s own values.'],
        confirmLabel: 'Launch anyway',
        cancelLabel: 'Don’t launch',
      });
      if (!ok) return null;
    }
    const body = {
      name: `${env.name} · official v${version.version}`.slice(0, 200),
      environment_ids: [env.id],
      spec: remap.config,
      base_source: { kind: 'official', preset_version_id: version.id },
    };
    const confirmHigh = (description) => confirmDialog({
      title: 'Launch at HIGH priority?',
      description,
      confirmLabel: 'Launch at HIGH',
      cancelLabel: 'Don’t launch',
      confirmClass: 'shell-btn-danger',
    });
    if (env.default_priority === 'HIGH') {
      if (!opts.canManage) return review(`“${env.name}” launches at HIGH by default, which needs a project manager; pick a priority.`);
      if (!(await confirmHigh([highPriorityWarning(env.name)]))) return null;
      body.acknowledge_preemption = true;
    }
    const send = () => request(`v1/projects/${encodeURIComponent(opts.projectId)}/experiments`, sendJson('POST', body));
    let launch = await send();
    let detail = launch.data && launch.data.detail;
    if (!launch.ok && launch.status === 422 && detail && detail.code === PREEMPTION_ACK_REQUIRED) {
      if (!(await confirmHigh([errorMessage(launch.data, highPriorityWarning(env.name))]))) return null;
      body.acknowledge_preemption = true;
      launch = await send();
      detail = launch.data && launch.data.detail;
    }
    if (launch.ok && launch.data && launch.data.id) {
      toast(`Launched official defaults v${version.version} on “${env.name}”`, 'success');
      if (opts.onLaunched) opts.onLaunched(launch.data);
      else navigateTo(experimentsUrl(slug, `experiment=${encodeURIComponent(launch.data.id)}`));
      return launch.data;
    }
    if (launch.status === 422 && detail && Array.isArray(detail.errors) && detail.errors.length) {
      return review(`Official defaults v${version.version} do not validate:${detail.errors[0].message || 'invalid value'}.`);
    }
    toast(errorMessage(launch.data, 'Failed to launch the official defaults'), 'error');
    return null;
  }

  // ── Settings panel controller ──────────────────────────────────────────
  const panels = new WeakMap();

  function mountEnvironmentsPanel(options) {
    const opts = options || {};
    let ctl = panels.get(opts.tbody);
    if (!ctl) {
      ctl = { envs: [], opts };
      panels.set(opts.tbody, ctl);
      opts.tbody.addEventListener('click', async (event) => {
        const button = event.target.closest('button');
        if (!button) return;
        const env = ctl.envs.find((e) => e.id === (button.dataset.envOpen || button.dataset.envTest || button.dataset.envRunOfficial));
        if (!env) return;
        if (button.dataset.envRunOfficial) {
          if (button.disabled) return;
          const done = spinnerLabel(button, '');
          try {
            await runOfficialDefaults({ projectId: ctl.opts.projectId, projectSlug: ctl.opts.projectSlug, env, canManage: ctl.opts.canManage });
          } finally {
            done();
          }
        } else if (button.dataset.envOpen) {
          openEnvironmentDrawer({
            projectId: ctl.opts.projectId, projectSlug: ctl.opts.projectSlug, env, canManage: ctl.opts.canManage,
            onChange: () => ctl.reload(), onEditOfficial: ctl.opts.onEditOfficial,
          });
        } else if (button.dataset.envTest && ctl.opts.canManage) {
          const done = spinnerLabel(button, '');
          const res = await request(envPath(ctl.opts.projectId, `/${encodeURIComponent(env.id)}/test`), sendJson('POST'));
          done();
          if (!res.ok) toast(errorMessage(res.data, 'Test failed'), 'error');
          else if (res.data.ok) toast(`“${env.name}” is healthy`, 'success');
          else toast(`“${env.name}” failed: ${res.data.error || 'unreachable'}`, 'error');
          await ctl.reload();
        }
      });
      if (opts.addButton) {
        opts.addButton.addEventListener('click', () => {
          if (!ctl.opts.canManage) return;
          openAddDialog({
            projectId: ctl.opts.projectId,
            onGotoApiKeys: ctl.opts.onGotoApiKeys,
            onChange: () => ctl.reload(),
          });
        });
      }
    }
    ctl.opts = opts;
    ctl.reload = async () => {
      const res = await request(envPath(ctl.opts.projectId));
      if (!res.ok) {
        ctl.opts.tbody.innerHTML = `<tr><td colspan="9"><div class="env-error-text">${esc(errorMessage(res.data, 'Could not load environments.'))}</div></td></tr>`;
        return;
      }
      ctl.envs = res.data.environments || [];
      ctl.opts.tbody.innerHTML = renderEnvironmentRows(ctl.envs, { canManage: ctl.opts.canManage });
    };
    if (opts.addButton) opts.addButton.hidden = !opts.canManage;
    if (opts.note) {
      opts.note.textContent = opts.canManage
        ? 'Register Evaluation Service deployments; experiments launch jobs on them.'
        : 'Only project managers and admins can add or change environments.';
    }
    ctl.reload();
    return ctl;
  }

  window.QymEvalEnvironments = {
    mountEnvironmentsPanel,
    openAddDialog,
    openEnvironmentDrawer,
    createSlotEditor,
    renderFormPreview,
    renderEnvironmentRows,
    officialPresetVersionHtml,
    runOfficialDefaults,
    canRunOfficial,
    HIGH_PRIORITY_WARNING,
    highPriorityWarning,
    // Exposed for tests and the Experiments page.
    _internal: { esc, expandPointer, endpointCandidates, flatCandidates, countFields, errorMessage },
  };
})();
