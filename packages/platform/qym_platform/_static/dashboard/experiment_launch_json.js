/*
 * Structured editor for JSON-valued settings of the launch form (experiment_launch.js).
 *
 *   window.QymLaunchJson.container(value, encoding) → object | array | null
 *   window.QymLaunchJson.editor({ el, value, label, attrs, onChange, onRaw }) → node
 *
 * The form descriptor only says "array"/"object"/"json" for these settings (no item
 * schema), so fields are inferred from the value itself:
 *   - object → one input per key (nested objects and lists recurse), "+ Add key";
 *   - list of scalars → one input per item, "+ Add item";
 *   - list of objects sharing the same keys → a table with one row per item and an
 *     "All items" row: a value typed there is written into every item;
 *   - any other list → one card per item.
 * `encoding: 'string'` covers string settings whose value is JSON text: container()
 * parses it, and the form serializes edits back to a string.
 *
 * Scalars keep their type: numbers stay numbers and booleans use a true/false select.
 * New keys, new items and null values read typed text as JSON when it parses
 * (`3`, `true`, `[1, 2]`), otherwise as a string.
 *
 * Every edit calls onChange(copy) and dispatches one bubbling `input` event from the
 * editor root (native events of the inner controls stop at the root), so the form
 * handles the editor like any other control. onRaw() switches to the raw JSON view.
 *
 * Security: nodes are built with el()/textContent only; no value is parsed as HTML.
 */
(function () {
  'use strict';
  if (window.QymLaunchJson) return;

  const MAX_DEPTH = 6; // deeper values are edited as JSON text

  function isObject(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function isContainer(v) { return v !== null && typeof v === 'object'; }
  function copy(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
  function kindOf(v) {
    if (v === null) return 'null';
    if (Array.isArray(v)) return 'array';
    return typeof v; // object | string | number | boolean
  }
  function isScalar(v) { return !isContainer(v); }

  /** The object or list held by a value (or by its JSON text), else null. */
  function container(value, encoding) {
    if (encoding === 'string') {
      if (typeof value !== 'string') return null;
      const text = value.trim();
      if (text[0] !== '{' && text[0] !== '[') return null;
      try {
        const parsed = JSON.parse(text);
        return isContainer(parsed) ? parsed : null;
      } catch (_) { return null; }
    }
    return isContainer(value) ? value : null;
  }

  /** Keys of a non-empty list of objects that all have the same (non-empty) key set. */
  function uniformKeys(list) {
    if (!list.length || !list.every(isObject)) return null;
    const keys = Object.keys(list[0]);
    if (!keys.length) return null;
    const signature = keys.slice().sort().join('\u0000');
    return list.every((item) => Object.keys(item).sort().join('\u0000') === signature) ? keys : null;
  }

  /** Typed text → value for a control of `kind` ({value} or {error}). */
  function parseText(kind, text) {
    if (kind === 'string') return { value: text };
    const trimmed = text.trim();
    if (kind === 'number') {
      if (!trimmed) return { error: 'Enter a number' };
      const num = Number(trimmed);
      return Number.isFinite(num) ? { value: num } : { error: 'Enter a number' };
    }
    // null / auto: JSON when it parses, otherwise the text itself.
    if (kind === 'null' && !trimmed) return { value: null };
    if (!trimmed) return { value: '' };
    try { return { value: JSON.parse(trimmed) }; } catch (_) { return { value: text }; }
  }

  function editor(options) {
    const el = options.el;
    const onChange = options.onChange || function () {};
    let doc = copy(options.value);
    const root = el('div', Object.assign({ className: 'xlj-editor', 'data-xl-structured': '1', role: 'group', 'aria-label': options.label || null }, options.attrs || {}));
    // Inner controls' native events stop here; commit() sends the one the form reads.
    ['input', 'change'].forEach((type) => root.addEventListener(type, (e) => {
      if (e.target !== root) e.stopImmediatePropagation();
    }));

    function getAt(path) { return path.reduce((node, key) => node[key], doc); }
    function setAt(path, value) {
      if (!path.length) { doc = value; return; }
      getAt(path.slice(0, -1))[path[path.length - 1]] = value;
    }
    function commit() {
      onChange(copy(doc));
      root.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function restructure() { commit(); render(); }
    function labelFor(path) { return [options.label || ''].concat(path.map(String)).filter(Boolean).join(' · '); }

    function linkButton(text, onClick, title, ariaLabel) {
      return el('button', { type: 'button', className: 'xl-link-btn', text, title: title || null, 'aria-label': ariaLabel || null, onClick });
    }

    /** One scalar input; `onValue(v)` runs on every valid edit. */
    function scalarControl(kind, value, label, onValue, placeholder) {
      if (kind === 'boolean') {
        const select = el('select', { className: 'qym-control qym-select xlj-control', 'aria-label': label }, [
          el('option', { value: 'true', selected: value === true, text: 'true' }),
          el('option', { value: 'false', selected: value === false, text: 'false' }),
        ]);
        select.addEventListener('change', () => onValue(select.value === 'true'));
        return select;
      }
      const mono = kind === 'number' || kind === 'null' || kind === 'auto';
      const input = el('input', {
        className: 'qym-control qym-input xlj-control' + (mono ? ' xl-mono' : ''), type: 'text', spellcheck: 'false',
        inputmode: kind === 'number' ? 'decimal' : null, 'aria-label': label,
        placeholder: placeholder || (kind === 'null' ? 'null' : null),
      });
      input.value = value == null ? '' : (typeof value === 'string' ? value : JSON.stringify(value));
      input.addEventListener('input', () => {
        const parsed = parseText(kind, input.value);
        input.classList.toggle('xlj-invalid', !!parsed.error);
        if (parsed.error) { input.setAttribute('aria-invalid', 'true'); input.title = parsed.error; return; }
        input.removeAttribute('aria-invalid');
        input.removeAttribute('title');
        onValue(parsed.value);
      });
      return input;
    }

    /** A nested value too deep (or inside a table cell) edited as JSON text. */
    function jsonControl(value, label, onValue) {
      const area = el('textarea', { className: 'xl-textarea xlj-json', spellcheck: 'false', 'aria-label': label, rows: '2' });
      area.value = JSON.stringify(value);
      area.addEventListener('input', () => {
        let parsed;
        try { parsed = JSON.parse(area.value); } catch (_) {
          area.classList.add('xlj-invalid');
          area.setAttribute('aria-invalid', 'true');
          return;
        }
        area.classList.remove('xlj-invalid');
        area.removeAttribute('aria-invalid');
        onValue(parsed);
      });
      return area;
    }

    function valueControl(path, value, depth, compact) {
      const label = labelFor(path);
      const write = (v) => { setAt(path, v); commit(); };
      if (isContainer(value)) {
        if (compact || depth >= MAX_DEPTH) return jsonControl(value, label, write);
        return Array.isArray(value) ? renderList(path, value, depth) : renderObject(path, value, depth);
      }
      return scalarControl(kindOf(value), value, label, write);
    }

    function addRow(placeholder, onAdd, buttonText) {
      const input = el('input', { className: 'qym-control qym-input xl-mono', type: 'text', maxlength: '200', placeholder, 'aria-label': placeholder });
      const error = el('span', { className: 'xl-error-text', role: 'alert' });
      const add = () => {
        error.textContent = '';
        const message = onAdd(input.value);
        if (message) error.textContent = message;
      };
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      return el('div', { className: 'xl-row' }, [input, el('button', { type: 'button', className: 'qym-inline-action qym-inline-action--neutral', text: buttonText, onClick: add }), error]);
    }

    function renderObject(path, obj, depth) {
      const leaves = [];
      const nested = [];
      Object.keys(obj).forEach((key) => {
        const childPath = path.concat([key]);
        const remove = linkButton('Remove', () => { delete getAt(path)[key]; restructure(); }, null, 'Remove ' + key);
        const head = el('div', { className: 'xlj-key' }, [el('span', { className: 'xlj-key-name', text: key }), el('span', { className: 'xl-spacer' }), remove]);
        const value = obj[key];
        if (isContainer(value) && depth + 1 < MAX_DEPTH) {
          nested.push(el('div', { className: 'xlj-nested' }, [head, valueControl(childPath, value, depth + 1)]));
        } else {
          leaves.push(el('div', { className: 'xlj-entry' }, [head, valueControl(childPath, value, depth + 1)]));
        }
      });
      const out = [];
      if (!leaves.length && !nested.length) out.push(el('div', { className: 'xl-hint', text: 'No keys.' }));
      if (leaves.length) out.push(el('div', { className: 'xlj-fields' }, leaves));
      return el('div', { className: 'xlj-object' }, out.concat(nested).concat([
        addRow('new key', (raw) => {
          const key = raw.trim();
          if (!key) return 'Enter a key.';
          if (Object.prototype.hasOwnProperty.call(getAt(path), key)) return 'Already present.';
          getAt(path)[key] = null; // typed text is read as JSON when it parses
          restructure();
          return '';
        }, '+ Add key'),
      ]));
    }

    function renderList(path, list, depth) {
      const keys = uniformKeys(list);
      const addItem = el('button', {
        type: 'button', className: 'qym-inline-action qym-inline-action--neutral', text: '+ Add item',
        title: list.length ? 'Adds a copy of the last item' : null,
        onClick: () => {
          const current = getAt(path);
          current.push(current.length ? copy(current[current.length - 1]) : null);
          restructure();
        },
      });
      const removeItem = (index) => linkButton('Remove', () => { getAt(path).splice(index, 1); restructure(); }, null, 'Remove item ' + (index + 1));
      const head = el('div', { className: 'xlj-list-head' }, [el('span', { className: 'qym-tag qym-tag--count', text: list.length + (list.length === 1 ? ' item' : ' items') })]);
      let body;
      if (keys) body = renderTable(path, list, keys, depth, removeItem);
      else if (list.every(isScalar)) {
        body = el('div', { className: 'xlj-items' }, list.map((item, i) => el('div', { className: 'xlj-item-row' }, [
          el('span', { className: 'xlj-index', text: String(i + 1) }),
          scalarControl(kindOf(item), item, labelFor(path.concat([i])), (v) => { setAt(path.concat([i]), v); commit(); }),
          removeItem(i),
        ])));
      } else {
        body = el('div', { className: 'xlj-items' }, list.map((item, i) => el('div', { className: 'xlj-nested' }, [
          el('div', { className: 'xlj-key' }, [el('span', { className: 'xlj-key-name', text: 'Item ' + (i + 1) }), el('span', { className: 'xl-spacer' }), removeItem(i)]),
          valueControl(path.concat([i]), item, depth + 1),
        ])));
      }
      return el('div', { className: 'xlj-list' }, [head, body, el('div', { className: 'xl-row' }, [addItem])]);
    }

    /** Same-key objects: one row per item, plus "All items" for global values. */
    function renderTable(path, list, keys, depth, removeItem) {
      const cells = {}; // key → [control per item] (scalar columns only)
      const globals = {}; // key → the "All items" control
      const columnKind = (key) => {
        const kinds = list.map((item) => kindOf(item[key]));
        const first = kinds[0];
        return kinds.every((k) => k === first) && (first === 'string' || first === 'number' || first === 'boolean') ? first : 'auto';
      };
      const scalarColumn = (key) => list.every((item) => isScalar(item[key]));
      const shared = (key) => {
        const items = getAt(path);
        const first = JSON.stringify(items[0][key]);
        return items.every((item) => JSON.stringify(item[key]) === first) ? { value: items[0][key] } : null;
      };
      function refreshGlobal(key) {
        const control = globals[key];
        if (!control || control.tagName === 'SELECT' || document.activeElement === control) return;
        const common = shared(key);
        control.value = common ? (typeof common.value === 'string' ? common.value : JSON.stringify(common.value)) : '';
      }
      function globalCell(key) {
        if (!scalarColumn(key)) return el('td', { className: 'xlj-all-cell' }, [el('span', { className: 'xl-hint', text: '—' })]);
        const kind = columnKind(key);
        const common = shared(key);
        const label = labelFor(path.concat(['*', key])) + ' (all items)';
        const apply = (v) => {
          getAt(path).forEach((item) => { item[key] = copy(v); });
          (cells[key] || []).forEach((control) => {
            if (control.tagName === 'SELECT') control.value = String(v);
            else control.value = typeof v === 'string' ? v : JSON.stringify(v);
            control.classList.remove('xlj-invalid');
          });
          commit();
        };
        let control;
        if (kind === 'boolean') {
          control = el('select', { className: 'qym-control qym-select xlj-control', 'aria-label': label }, [
            el('option', { value: '', text: common ? 'Same: ' + String(common.value) : 'Mixed' }),
            el('option', { value: 'true', text: 'true' }),
            el('option', { value: 'false', text: 'false' }),
          ]);
          control.addEventListener('change', () => { if (control.value) apply(control.value === 'true'); });
        } else {
          control = scalarControl(kind, common ? common.value : null, label, apply, common ? null : 'Mixed');
          if (!common) control.value = '';
        }
        globals[key] = control;
        return el('td', { className: 'xlj-all-cell' }, [control]);
      }
      const head = el('tr', null, [el('th', { text: '#' })].concat(keys.map((k) => el('th', { className: 'xl-mono', text: k }))).concat([el('th', { text: '' })]));
      const allRow = el('tr', { className: 'xlj-all-row' }, [el('td', { className: 'xlj-all-label', text: 'All items', title: 'A value set here is written into every item' })]
        .concat(keys.map(globalCell)).concat([el('td')]));
      const rows = list.map((item, i) => el('tr', null, [el('td', { className: 'xlj-index', text: String(i + 1) })].concat(keys.map((key) => {
        const cellPath = path.concat([i, key]);
        const value = item[key];
        let control;
        if (isContainer(value)) control = jsonControl(value, labelFor(cellPath), (v) => { setAt(cellPath, v); commit(); });
        else {
          control = scalarControl(kindOf(value), value, labelFor(cellPath), (v) => { setAt(cellPath, v); commit(); refreshGlobal(key); });
          (cells[key] = cells[key] || []).push(control);
        }
        return el('td', null, [control]);
      })).concat([el('td', null, [removeItem(i)])])));
      return el('div', { className: 'xl-table-wrap' }, [el('table', { className: 'xlj-table' }, [el('thead', null, [head]), el('tbody', null, [allRow].concat(rows))])]);
    }

    function render() {
      const toolbar = el('div', { className: 'xlj-toolbar' }, [
        el('span', { className: 'xl-hint', text: Array.isArray(doc) ? 'List' : 'Object' }),
        el('span', { className: 'xl-spacer' }),
        options.onRaw ? linkButton('Edit as JSON', options.onRaw, 'Edit the whole value as raw JSON') : null,
      ]);
      root.replaceChildren(toolbar, Array.isArray(doc) ? renderList([], doc, 0) : renderObject([], doc, 0));
    }

    render();
    return root;
  }

  window.QymLaunchJson = { container, uniformKeys, editor };
})();
