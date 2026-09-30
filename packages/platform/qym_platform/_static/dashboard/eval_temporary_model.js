/*
 * "+ Temporary model" inline form (plan §7.5, issue #12).
 *
 * Exposes window.QymTemporaryModel for the launch form's model pickers (#23):
 *
 *   createForm({ keysAllowed, keysReason, canSaveToProject, onAdd, onCancel }) → HTMLElement
 *     onAdd({ binding, secretRef, apiKey, saveToProject }) receives
 *       binding    {temporary: {label, model, base_url, api_key?: {$secret: ref}}}
 *       secretRef  the ref to send as `secrets[ref] = apiKey` (null when no key)
 *   renderChip(binding) → HTML string for the picker's chip (styled apart from
 *     saved connections).
 *
 * Security: the key only lives in its password input and in the object handed to
 * onAdd, which puts it in the launch request's `secrets`. It is never rendered,
 * logged or kept in the binding (only a {$secret: ref} placeholder is). The
 * server validates the base URL; this form only checks that it looks absolute.
 */
(function () {
  'use strict';
  if (window.QymTemporaryModel) return;

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  let counter = 0;
  function newRef() {
    counter += 1;
    const rand = Math.random().toString(36).slice(2, 10);
    return `tmp-${Date.now().toString(36)}-${counter}-${rand}`;
  }

  function field(id, label, type, placeholder, extra) {
    return `
      <label class="tmpm-field" for="${id}">
        <span class="shell-form-label">${esc(label)}</span>
        <input id="${id}" class="qym-control qym-input" type="${type}"
               placeholder="${esc(placeholder)}" ${extra || ''}>
      </label>`;
  }

  function createForm(options) {
    const opts = options || {};
    const keysAllowed = opts.keysAllowed !== false;
    const uid = `tmpm-${newRef()}`;
    const root = document.createElement('div');
    root.className = 'tmpm-form';
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Temporary model');
    root.innerHTML = `
      <div class="tmpm-grid">
        ${field(`${uid}-label`, 'Label', 'text', 'mini trial', 'maxlength="200"')}
        ${field(`${uid}-model`, 'Model', 'text', 'gpt-4o-mini', 'maxlength="200" required')}
        ${field(`${uid}-url`, 'Base URL', 'url', 'https://api.example.com/v1', 'maxlength="500"')}
        ${field(`${uid}-key`, 'API key', 'password', keysAllowed ? 'sk-…' : 'Not accepted by this environment',
          `autocomplete="off" spellcheck="false"${keysAllowed ? '' : ' disabled'}`)}
      </div>
      <p class="tmpm-note">${esc(keysAllowed
        ? 'Used for this experiment only. The key is encrypted, never shown again, and deleted once every job has finished.'
        : (opts.keysReason || 'This environment does not accept model API keys.'))}</p>
      ${opts.canSaveToProject ? `
        <label class="shell-form-checkbox">
          <input type="checkbox" data-role="save">
          <span class="shell-form-checkbox-copy">
            <span class="shell-form-checkbox-label">Save to project models</span>
            <span class="shell-form-checkbox-help">Adds it to the project's model list instead of keeping it temporary.</span>
          </span>
        </label>` : ''}
      <div class="tmpm-error" role="alert" hidden></div>
      <div class="tmpm-actions">
        <button type="button" class="qym-inline-action qym-inline-action--neutral" data-role="cancel">Cancel</button>
        <button type="button" class="qym-inline-action qym-inline-action--accent" data-role="add">Add model</button>
      </div>`;

    const $ = (sel) => root.querySelector(sel);
    const error = $('.tmpm-error');
    function fail(message) {
      error.textContent = message;
      error.hidden = false;
    }

    $('[data-role="cancel"]').addEventListener('click', () => {
      $(`#${uid}-key`).value = '';
      if (typeof opts.onCancel === 'function') opts.onCancel();
    });

    $('[data-role="add"]').addEventListener('click', () => {
      error.hidden = true;
      const model = $(`#${uid}-model`).value.trim();
      const label = $(`#${uid}-label`).value.trim() || model;
      const baseUrl = $(`#${uid}-url`).value.trim().replace(/\/+$/, '');
      const keyInput = $(`#${uid}-key`);
      const apiKey = keysAllowed ? keyInput.value.trim() : '';
      const save = !!(root.querySelector('[data-role="save"]') || {}).checked;
      if (!model) return fail('Enter a model name.');
      if (baseUrl && !/^https?:\/\/[^\s/]+/i.test(baseUrl)) {
        return fail('The base URL must start with http:// or https://.');
      }
      if (save && (!baseUrl || !apiKey)) {
        return fail('A base URL and an API key are needed to save it to project models.');
      }
      const temporary = { label, model };
      if (baseUrl) temporary.base_url = baseUrl;
      const secretRef = apiKey ? newRef() : null;
      if (secretRef) temporary.api_key = { $secret: secretRef };
      keyInput.value = '';
      if (typeof opts.onAdd === 'function') {
        opts.onAdd({ binding: { temporary }, secretRef, apiKey: apiKey || null, saveToProject: save });
      }
    });
    return root;
  }

  function renderChip(binding) {
    const t = (binding && binding.temporary) || {};
    const label = t.label || t.model || 'Temporary model';
    return `<span class="qym-tag qym-tag--warning tmpm-chip" title="Temporary model, used by this experiment only">`
      + `<span>${esc(label)}</span>`
      + (t.model && t.model !== label ? `<span class="tmpm-chip-model">${esc(t.model)}</span>` : '')
      + '</span>';
  }

  window.QymTemporaryModel = { createForm, renderChip };
})();
