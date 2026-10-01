/*
 * Sweeps in the new-experiment launch form (plan §8.3, §12.2, issue #34).
 *
 * Mounted by experiment_launch.js into its [data-xl-sweeps] host, unless the
 * form is mounted with `sweeps: false` (e.g. the official-defaults editor mode):
 *
 *   window.QymLaunchSweeps.mount(host, api)
 *     → { sweepable, toggle, editor, modelToggle, modelCard, checkValues,
 *         bindingKey, checkLinks, localErrors, jobEstimate, previewAxes,
 *         onSpecChange, teardown }
 *
 * `api` is the launch form's sweepsApi(). There is no sweep state here: a swept
 * value is stored in the launch form's own state as the §8.1 spec value
 * {"sweep": [v1, v2, …]}, so the spec, the Raw JSON tab and the dry run all see
 * the same thing:
 *   - settings: st.values[pointer] (role table cells too);
 *   - evaluation inputs: the Advanced panel's config (it calls editor()/toggle());
 *   - models: st.bindings[slot] = { kind: 'raw', value: { sweep: [binding, …] } }
 *     where a binding is {connection_id}, {temporary} or {inherit: true};
 *   - linked groups: st.links (the spec's "links", one source of truth with the
 *     Advanced panel's Raw JSON tab).
 *
 * Widgets: "+ values" turns a field into chips. Numbers add typed values or a
 * start/stop/step range expanded here, so the spec is always an explicit list.
 * Booleans become [true, false] in one click. Enums and endpoint references are
 * a multi-select. Model cards get "+ models": a multi-select of project models,
 * Inherit and temporary models. The Sweeps card lists the axes, links values
 * (zipped: equal lengths enforced) and shows the run count against the cap.
 *
 * Security: nodes are built with api.el()/textContent, never parsed HTML.
 * Temporary-model keys never pass through here: a new key goes straight to
 * api.rememberSecret(ref, key) and only {"$secret": ref} is kept in the spec.
 */
(function () {
  'use strict';
  if (window.QymLaunchSweeps) return;

  const RANGE_MAX = 100; // values one range may add
  const SECTIONS = ['slot_bindings', 'evaluator', 'env_overrides'];
  const SCALAR_TYPES = ['integer', 'number', 'boolean', 'enum', 'string'];
  const EMPTY_MESSAGE = 'Add at least one value, or switch back to a single value';

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }
  /** A {"sweep": …} value (services/eval_config.is_sweep). */
  function isSweep(value) {
    return isPlainObject(value) && Object.keys(value).length === 1 && Object.prototype.hasOwnProperty.call(value, 'sweep');
  }
  function clone(value) {
    return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  }
  function sameJson(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  function formatValue(value) {
    if (value === null || value === undefined) return 'inherit';
    if (typeof value === 'string') return value === '' ? '""' : value;
    return JSON.stringify(value);
  }
  function decimals(num) {
    const text = String(num);
    if (text.indexOf('e-') >= 0) return Number(text.split('e-')[1]) || 0;
    const dot = text.indexOf('.');
    return dot < 0 ? 0 : text.length - dot - 1;
  }

  /** Fields whose values may be swept: single scalar settings (never keys). */
  function sweepable(entry) {
    if (!entry || entry.kind !== 'field' || entry.secret || entry.widget === 'secret') return false;
    if (entry.widget === 'endpoint-ref') return true;
    return SCALAR_TYPES.indexOf(entry.type) >= 0;
  }

  /** One sweep value against its field; null when valid (null itself = inherit). */
  function valueProblem(entry, value) {
    if (value === null) return null;
    if (entry.widget === 'endpoint-ref') return typeof value === 'string' && value ? null : 'Must be an endpoint name';
    if (entry.type === 'integer') return typeof value === 'number' && Number.isInteger(value) ? null : 'Must be a whole number';
    if (entry.type === 'number') return typeof value === 'number' && Number.isFinite(value) ? null : 'Must be a number';
    if (entry.type === 'boolean') return typeof value === 'boolean' ? null : 'Must be true or false';
    if (entry.type === 'string') return typeof value === 'string' ? null : 'Must be a string';
    if (entry.type === 'enum') return (entry.enum || []).some((v) => sameJson(v, value)) ? null : 'Must be one of the listed values';
    return 'This setting cannot be swept';
  }

  /** Problems of a {"sweep": […]} value: [{ index, message }] (index null: the list). */
  function checkValues(entry, value) {
    if (!sweepable(entry)) return [{ index: null, message: 'This setting cannot be swept' }];
    const values = isPlainObject(value) ? value.sweep : null;
    if (!Array.isArray(values) || !values.length) return [{ index: null, message: 'A sweep needs a non-empty list of values' }];
    const problems = [];
    const seen = {};
    values.forEach((v, i) => {
      const problem = valueProblem(entry, v);
      if (problem) { problems.push({ index: i, message: problem }); return; }
      const key = JSON.stringify(v);
      if (seen[key]) problems.push({ index: i, message: 'Duplicate value' });
      seen[key] = true;
    });
    return problems;
  }

  /** Comparable key of one swept model binding (names and key refs left out). */
  function bindingKey(item) {
    if (!isPlainObject(item)) return 'x:' + JSON.stringify(item);
    if (item.inherit === true) return 'inherit';
    if (isPlainObject(item.temporary)) {
      const t = {};
      ['label', 'model', 'base_url'].forEach((k) => { if (item.temporary[k] != null) t[k] = item.temporary[k]; });
      return 't:' + JSON.stringify(t);
    }
    if (typeof item.connection_id === 'string') return 'c:' + item.connection_id;
    return 'x:' + JSON.stringify(item);
  }

  function mount(host, api) {
    const el = api.el;
    const st = api.state;

    const xs = {
      active: true,
      selected: {}, // pointer → true: unlinked axes picked for "Link selected"
      linkError: '',
      tempFormFor: null, // slot key whose "+ Temporary model" form is open
      frame: null,
    };

    // ── Finding sweeps in the spec (mirrors services/eval_sweeps.py) ──────
    function findSweeps(node, pointer, out) {
      if (isSweep(node)) { out.push({ pointer, values: Array.isArray(node.sweep) ? node.sweep : [] }); return out; }
      if (Array.isArray(node)) node.forEach((child, i) => findSweeps(child, pointer + '/' + i, out));
      else if (isPlainObject(node)) Object.keys(node).forEach((key) => findSweeps(node[key], pointer + '/' + api.escSeg(key), out));
      return out;
    }

    /** Swept values of a spec in axis order: [{ pointer, values }]. */
    function sweepsOf(spec) {
      const out = [];
      SECTIONS.forEach((section) => { if (spec && spec[section] != null) findSweeps(spec[section], '/' + section, out); });
      return out;
    }

    /** Linked groups that still point at swept values (claimed once, 2+ members). */
    function cleanLinks(links, swept) {
      if (!Array.isArray(links)) return [];
      const claimed = {};
      const groups = [];
      links.forEach((group) => {
        if (!Array.isArray(group)) return;
        const members = group.filter((p) => typeof p === 'string' && swept[p] && !claimed[p]);
        if (members.length < 2) return;
        members.forEach((p) => { claimed[p] = true; });
        groups.push(members);
      });
      return groups;
    }

    /** Grid axes: [{ pointers, lengths, length, linked, group }] (a linked group sits at its first member). */
    function axesOf(spec) {
      const found = sweepsOf(spec);
      const byPointer = {};
      found.forEach((f) => { byPointer[f.pointer] = f; });
      const groups = cleanLinks(spec && spec.links, byPointer);
      const groupOf = {};
      groups.forEach((group, g) => group.forEach((p) => { groupOf[p] = g; }));
      const axes = [];
      const done = {};
      found.forEach((f) => {
        if (groupOf[f.pointer] === undefined) {
          axes.push({ pointers: [f.pointer], lengths: [f.values.length], length: f.values.length, linked: false, group: null });
          return;
        }
        const g = groupOf[f.pointer];
        if (done[g]) return;
        done[g] = true;
        const pointers = found.filter((x) => groupOf[x.pointer] === g).map((x) => x.pointer);
        const lengths = pointers.map((p) => byPointer[p].values.length);
        axes.push({ pointers, lengths, length: Math.min.apply(null, lengths), linked: true, group: g });
      });
      return { axes, groups, found };
    }

    function comboCount(axes) {
      return axes.reduce((n, axis) => n * axis.length, 1);
    }

    /** Runs this form would create: ∏ axis lengths × environments. */
    function jobEstimate() {
      return comboCount(axesOf(api.buildSpec()).axes) * st.selected.length;
    }

    /** Linked groups written in a document (Raw JSON): errors like the service's. */
    function checkLinks(doc) {
      const errors = [];
      const links = doc.links;
      if (links == null) return errors;
      if (!Array.isArray(links)) return [{ pointer: '/links', message: 'links must be a list of lists of pointers' }];
      const swept = {};
      sweepsOf(doc).forEach((f) => { swept[f.pointer] = f.values.length; });
      const claimed = {};
      links.forEach((group, g) => {
        const where = '/links/' + g;
        if (!Array.isArray(group) || !group.every((p) => typeof p === 'string')) {
          errors.push({ pointer: where, message: 'A linked group is a list of pointers' });
          return;
        }
        if (group.length < 2) errors.push({ pointer: where, message: 'A linked group needs two or more values' });
        group.forEach((p, m) => {
          if (swept[p] === undefined) errors.push({ pointer: where + '/' + m, message: p + ' is not a swept value' });
          else if (claimed[p] !== undefined) errors.push({ pointer: where + '/' + m, message: p + ' is already linked in /links/' + claimed[p] });
          else claimed[p] = g;
        });
        const lengths = group.filter((p) => swept[p] !== undefined).map((p) => swept[p]);
        if (lengths.some((n) => n !== lengths[0])) {
          errors.push({ pointer: where, message: 'Linked values need the same number of values (got ' + lengths.join(', ') + ')' });
        }
      });
      return errors;
    }

    /** Problems the service would reject: empty sweeps and uneven linked groups. */
    function localErrors() {
      const errors = [];
      const spec = api.buildSpec();
      const model = axesOf(spec);
      model.found.forEach((f) => {
        if (!f.values.length) errors.push({ pointer: f.pointer, message: pointerLabel(f.pointer) + ': ' + EMPTY_MESSAGE });
      });
      model.axes.forEach((axis) => {
        if (!axis.linked || axis.lengths.every((n) => n === axis.lengths[0])) return;
        errors.push({
          pointer: '/links/' + axis.group,
          message: 'Linked values need the same number of values: ' + axis.pointers.map((p, i) => pointerLabel(p) + ' has ' + axis.lengths[i]).join(', '),
        });
      });
      return errors;
    }

    // ── Labels ─────────────────────────────────────────────────────────────
    function pointerLabel(pointer) {
      const segments = api.splitPointer(pointer);
      if (segments[0] === 'slot_bindings' && segments.length === 2) {
        const slot = api.unionSlots().find((s) => s.slot_key === segments[1]);
        return (slot ? slot.label : segments[1]) + ' model';
      }
      if (segments[0] === 'evaluator') return segments.slice(segments[1] === 'config' ? 2 : 1).join('.');
      return segments.slice(1).join('.');
    }

    function slotOf(pointer) {
      const segments = api.splitPointer(pointer);
      if (segments[0] !== 'slot_bindings' || segments.length !== 2) return null;
      return api.unionSlots().find((s) => s.slot_key === segments[1]) || { slot_key: segments[1], envs: [] };
    }

    function bindingText(slot, item) {
      if (!isPlainObject(item)) return formatValue(item);
      if (item.inherit === true) return 'Inherit';
      if (isPlainObject(item.temporary)) return 'Temporary: ' + (item.temporary.label || item.temporary.model || 'model');
      if (typeof item.connection_id === 'string') {
        const conn = slot ? api.slotConnections(slot).find((c) => c.id === item.connection_id) : null;
        return (conn && conn.name) || item.name || item.model || item.connection_id;
      }
      return formatValue(item);
    }

    function valueText(pointer, value) {
      const slot = slotOf(pointer);
      return slot ? bindingText(slot, value) : formatValue(value);
    }

    // ── "+ values" and the chip editor ─────────────────────────────────────
    /**
     * The "+ values" affordance of a field: o = { entry, label, get, set, disabled }.
     * Booleans become [true, false] at once; other fields start from their value.
     */
    function toggle(o) {
      if (!sweepable(o.entry) || o.disabled) return null;
      return el('button', {
        type: 'button', className: 'xl-link-btn xs-toggle', 'data-xs-toggle': '1',
        title: 'Sweep several values: one run per value',
        'aria-label': 'Sweep values of ' + o.label,
        text: '+ values',
        onClick: (e) => {
          const current = o.get();
          let start = [];
          if (o.entry.type === 'boolean') start = [true, false];
          else if (current !== undefined && current !== null && !isSweep(current)) start = [current];
          o.set({ sweep: start });
          e.currentTarget.blur(); // let the Advanced panel re-render the table it sits in
          api.refresh();
        },
      });
    }

    function choiceOptions(o) {
      if (o.entry.widget === 'endpoint-ref') return (o.options || []).map((v) => ({ value: v, text: v }));
      if (o.entry.type === 'boolean') return [{ value: true, text: 'true' }, { value: false, text: 'false' }];
      if (o.entry.type === 'enum') return (o.entry.enum || []).map((v) => ({ value: v, text: formatValue(v) }));
      return null;
    }

    function parseTyped(entry, raw) {
      const text = String(raw).trim();
      if (!text) return { empty: true };
      if (entry.type === 'integer' || entry.type === 'number') {
        const num = Number(text);
        if (!Number.isFinite(num)) return { error: 'Enter numbers' };
        if (entry.type === 'integer' && !Number.isInteger(num)) return { error: 'Enter whole numbers' };
        return { value: num };
      }
      return { value: text };
    }

    /** start/stop/step → explicit values (client-side, so the spec stays a list). */
    function expandRange(entry, startRaw, stopRaw, stepRaw) {
      const start = Number(String(startRaw).trim());
      const stop = Number(String(stopRaw).trim());
      const step = Number(String(stepRaw).trim());
      if (![startRaw, stopRaw, stepRaw].every((v) => String(v).trim()) || ![start, stop, step].every(Number.isFinite)) {
        return { error: 'Enter a start, stop and step' };
      }
      if (entry.type === 'integer' && ![start, stop, step].every(Number.isInteger)) return { error: 'Use whole numbers' };
      if (step <= 0) return { error: 'The step must be above 0' };
      if (stop < start) return { error: 'Stop must not be below start' };
      const count = Math.floor((stop - start) / step + 1e-9) + 1;
      if (count > RANGE_MAX) return { error: 'That range has ' + count + ' values; the most is ' + RANGE_MAX };
      const places = Math.max(decimals(start), decimals(step));
      const values = [];
      for (let i = 0; i < count; i += 1) values.push(Number((start + i * step).toFixed(places)));
      return { values };
    }

    /**
     * Chips for a swept field: o = { entry, pointer, label, get, set, options,
     * onChange }. Each edit writes { sweep: [...] } through o.set, then fires an
     * `input` event on the editor (the form's leaf listeners) and o.onChange.
     */
    function editor(o) {
      const root = el('div', {
        className: 'xs-editor', 'data-xs-sweep': '1', 'data-xl-pointer': o.pointer,
        role: 'group', 'aria-label': o.label + ' (swept values)', tabindex: '-1',
      });
      const ui = { range: false, message: '' };
      function values() {
        const current = o.get();
        return isSweep(current) && Array.isArray(current.sweep) ? current.sweep : [];
      }
      function commit(list) {
        o.set({ sweep: list });
        draw();
        root.dispatchEvent(new Event('input'));
        if (o.onChange) o.onChange();
      }
      function add(list) {
        const next = values().slice();
        let skipped = 0;
        list.forEach((v) => {
          if (next.some((x) => sameJson(x, v))) skipped += 1;
          else next.push(v);
        });
        ui.message = skipped ? skipped + ' duplicate value' + (skipped === 1 ? ' was' : 's were') + ' skipped' : '';
        commit(next);
      }
      function stop(e) { e.stopPropagation(); } // typing is not an edit until a value is added

      function draw() {
        const list = values();
        const children = [];
        const options = choiceOptions(o);
        if (options) {
          const chosen = (v) => list.some((x) => sameJson(x, v));
          const chips = options.map((opt) => el('button', {
            type: 'button', className: 'qym-chip xs-chip', 'aria-pressed': chosen(opt.value) ? 'true' : 'false',
            'data-xs-option': JSON.stringify(opt.value),
            onClick: () => {
              const on = !chosen(opt.value);
              // Keep the option order; values the options do not list stay last.
              const next = options.filter((x) => (x.value === opt.value ? on : chosen(x.value))).map((x) => x.value)
                .concat(list.filter((v) => !options.some((x) => sameJson(x.value, v))));
              ui.message = '';
              commit(next);
              const again = Array.from(root.querySelectorAll('[data-xs-option]'))
                .find((n) => n.getAttribute('data-xs-option') === JSON.stringify(opt.value));
              if (again) again.focus(); // the chips were redrawn
            },
          }, [el('span', { className: 'xs-chip-value', text: opt.text })]));
          list.filter((v) => !options.some((x) => sameJson(x.value, v))).forEach((v) => chips.push(valueChip(v)));
          children.push(el('div', { className: 'xs-chips', role: 'group', 'aria-label': o.label + ' values' }, chips));
        } else {
          children.push(el('div', { className: 'xs-chips', role: 'list', 'aria-label': o.label + ' values' },
            list.length ? list.map(valueChip) : [el('span', { className: 'xl-hint', text: 'No values yet' })]));
          const numeric = o.entry.type === 'integer' || o.entry.type === 'number';
          const input = el('input', {
            className: 'qym-control qym-input xs-add' + (numeric ? ' xl-mono' : ''), type: 'text', spellcheck: 'false',
            inputmode: numeric ? 'decimal' : null,
            placeholder: numeric ? 'Add values: 0.5, 0.7' : 'Add a value',
            'aria-label': 'Add values to ' + o.label, 'data-xs-add': '1',
            onInput: stop,
            onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addTyped(input); } },
          });
          const row = [input, el('button', { type: 'button', className: 'qym-inline-action qym-inline-action--neutral', text: 'Add', onClick: () => addTyped(input) })];
          if (numeric) {
            row.push(el('button', {
              type: 'button', className: 'xl-link-btn', 'data-xs-range-toggle': '1', 'aria-expanded': ui.range ? 'true' : 'false',
              text: ui.range ? 'Hide range' : 'Range…',
              onClick: () => { ui.range = !ui.range; ui.message = ''; draw(); },
            }));
          }
          children.push(el('div', { className: 'xs-row' }, row));
          if (numeric && ui.range) children.push(rangeRow());
        }
        children.push(el('div', { className: 'xs-row' }, [
          el('span', { className: 'xl-hint xl-mono', 'data-xs-count': '1', text: list.length + ' value' + (list.length === 1 ? '' : 's') }),
          ui.message ? el('span', { className: 'xl-hint', role: 'status', text: ui.message }) : null,
          el('span', { className: 'xl-spacer' }),
          el('button', {
            type: 'button', className: 'xl-link-btn', 'data-xs-single': '1', text: 'Single value',
            title: 'Stop sweeping: keep the first value',
            onClick: (e) => {
              const first = values()[0];
              o.set(first === undefined || first === null ? undefined : first);
              e.currentTarget.blur();
              api.refresh();
            },
          }),
        ]));
        if (!list.length) children.push(el('div', { className: 'xl-error-text', role: 'alert', text: EMPTY_MESSAGE + '.' }));
        root.replaceChildren.apply(root, children);
      }

      function valueChip(v) {
        return el('span', { className: 'qym-chip xs-chip', role: 'listitem', 'data-xs-value': JSON.stringify(v) }, [
          el('span', { className: 'xs-chip-value', text: formatValue(v) }),
          el('button', {
            type: 'button', className: 'qym-chip__remove xs-chip-remove', 'aria-label': 'Remove ' + formatValue(v), text: '×',
            onClick: () => { ui.message = ''; commit(values().filter((x) => !sameJson(x, v))); },
          }),
        ]);
      }

      function addTyped(input) {
        const numeric = o.entry.type === 'integer' || o.entry.type === 'number';
        const parts = numeric ? String(input.value).split(/[\s,;]+/) : [input.value];
        const parsed = [];
        for (const part of parts) {
          const result = parseTyped(o.entry, part);
          if (result.empty) continue;
          if (result.error) { ui.message = result.error; draw(); return; }
          parsed.push(result.value);
        }
        if (!parsed.length) return;
        add(parsed);
        const next = root.querySelector('[data-xs-add]');
        if (next) next.focus();
      }

      function rangeRow() {
        const field = (name, label) => el('input', {
          className: 'qym-control qym-input xl-mono xs-range-input', type: 'text', inputmode: 'decimal', spellcheck: 'false',
          placeholder: label, 'aria-label': label + ' of the range for ' + o.label, 'data-xs-range': name, onInput: stop,
        });
        const start = field('start', 'Start');
        const end = field('stop', 'Stop');
        const step = field('step', 'Step');
        return el('div', { className: 'xs-row xs-range', 'data-xs-range-row': '1' }, [
          start, end, step,
          el('button', {
            type: 'button', className: 'qym-inline-action qym-inline-action--neutral', 'data-xs-range-add': '1', text: 'Add range',
            onClick: () => {
              const result = expandRange(o.entry, start.value, end.value, step.value);
              if (result.error) { ui.message = result.error; draw(); return; }
              ui.range = false;
              add(result.values);
            },
          }),
        ]);
      }

      draw();
      return root;
    }

    // ── Models: a multi-select per slot ────────────────────────────────────
    function modelToggle(slot) {
      return el('button', {
        type: 'button', className: 'qym-inline-action qym-inline-action--neutral', 'data-xs-model-toggle': slot.slot_key,
        title: 'Run the experiment once per model', text: '+ models',
        onClick: () => {
          const b = st.bindings[slot.slot_key];
          let first = null;
          if (b && b.kind === 'connection') first = { connection_id: b.id };
          else if (b && b.kind === 'temporary') first = clone(b.binding);
          api.setBinding(slot.slot_key, { kind: 'raw', value: { sweep: first ? [first] : [] } });
        },
      });
    }

    function setItems(slot, items, focusKey) {
      api.setBinding(slot.slot_key, { kind: 'raw', value: { sweep: items } });
      if (!focusKey) return;
      const node = Array.from(api.root.querySelectorAll('[data-xs-model-item]'))
        .find((n) => n.getAttribute('data-xs-model-item') === slot.slot_key + '|' + focusKey);
      if (node) node.focus();
    }

    /** The card body of a swept slot, or null when the slot is not swept. */
    function modelCard(slot, parts) {
      const b = st.bindings[slot.slot_key];
      if (!b || b.kind !== 'raw' || !isSweep(b.value)) return null;
      const items = Array.isArray(b.value.sweep) ? b.value.sweep : [];
      const keys = items.map(bindingKey);
      const chosen = (key) => keys.indexOf(key) >= 0;
      const toggleItem = (key, item) => {
        const next = chosen(key) ? items.filter((x) => bindingKey(x) !== key) : items.concat([item]);
        setItems(slot, next, key);
      };
      const chip = (key, item, text, extra) => el('button', Object.assign({
        type: 'button', className: 'qym-chip xs-chip', 'aria-pressed': chosen(key) ? 'true' : 'false',
        'data-xs-model-item': slot.slot_key + '|' + key,
        onClick: () => toggleItem(key, item),
      }, extra || {}), [el('span', { text })]);

      const connections = api.slotConnections(slot);
      const chips = [chip('inherit', { inherit: true }, 'Inherit', { title: 'The worker\'s own setting' })];
      connections.forEach((conn) => {
        const key = 'c:' + conn.id;
        chips.push(chip(key, { connection_id: conn.id }, conn.name + (conn.model ? ' · ' + conn.model : ''), {
          disabled: !conn.available && !chosen(key),
          title: conn.available ? null : conn.reasons.join('; '),
        }));
      });
      // Swept values the lists above do not show: temporary models, gone models.
      items.forEach((item) => {
        const key = bindingKey(item);
        if (key === 'inherit' || connections.some((c) => 'c:' + c.id === key)) return;
        const temporary = isPlainObject(item) && isPlainObject(item.temporary);
        chips.push(el('span', { className: 'qym-chip xs-chip', role: 'listitem', 'data-xs-model-extra': key }, [
          el('span', { text: bindingText(slot, item) }),
          temporary && !(item.temporary.api_key && item.temporary.api_key.$secret) ? api.tag('no API key', null) : null,
          !temporary ? api.tag('not available', 'warning') : null,
          el('button', {
            type: 'button', className: 'qym-chip__remove xs-chip-remove', 'aria-label': 'Remove ' + bindingText(slot, item), text: '×',
            onClick: () => setItems(slot, items.filter((x) => bindingKey(x) !== key)),
          }),
        ]));
      });
      const children = [
        parts.head,
        el('div', { className: 'xl-hint', text: 'Fills ' + (parts.fills || 'no fields') + '. Each selected model is one value of the sweep: one run per model.' }),
        el('div', {
          className: 'xs-chips', role: 'group', 'aria-label': slot.label + ' models to sweep',
          'data-xl-pointer': '/slot_bindings/' + api.escSeg(slot.slot_key), tabindex: '-1',
        }, chips),
      ];
      if (!items.length) children.push(el('div', { className: 'xl-error-text', role: 'alert', text: 'Pick at least one model, or switch back to a single model.' }));
      if (xs.tempFormFor === slot.slot_key && window.QymTemporaryModel) {
        const tempKeys = api.temporaryKeys();
        children.push(window.QymTemporaryModel.createForm({
          keysAllowed: tempKeys.allowed,
          keysReason: tempKeys.reason,
          canSaveToProject: false, // a swept temporary model is not saved to project models
          onAdd: (result) => {
            xs.tempFormFor = null;
            if (result.secretRef && result.apiKey) api.rememberSecret(result.secretRef, result.apiKey);
            // The same model again replaces the earlier one (and its key).
            const key = bindingKey(result.binding);
            setItems(slot, chosen(key) ? items.map((x) => (bindingKey(x) === key ? result.binding : x)) : items.concat([result.binding]));
          },
          onCancel: () => { xs.tempFormFor = null; api.renderModels(); },
        }));
      }
      children.push(el('div', { className: 'xs-row' }, [
        el('span', { className: 'xl-hint xl-mono', text: items.length + ' model' + (items.length === 1 ? '' : 's') }),
        window.QymTemporaryModel && xs.tempFormFor !== slot.slot_key ? el('button', {
          type: 'button', className: 'qym-inline-action qym-inline-action--neutral', text: '+ Temporary model',
          onClick: () => { xs.tempFormFor = slot.slot_key; api.renderModels(); },
        }) : null,
        el('span', { className: 'xl-spacer' }),
        el('button', {
          type: 'button', className: 'xl-link-btn', 'data-xs-model-single': slot.slot_key, text: 'Single model',
          title: 'Stop sweeping: keep the first model',
          onClick: () => api.setBinding(slot.slot_key, singleBinding(items[0])),
        }),
      ]));
      return el('div', { className: 'xl-model-card xs-model-card', 'data-xl-model-card': slot.slot_key, 'data-xs-model-sweep': '1' }, children);
    }

    /** The form binding for one swept value (collapsing a model sweep). */
    function singleBinding(item) {
      if (!isPlainObject(item) || item.inherit === true) return null;
      if (isPlainObject(item.temporary)) {
        const ref = isPlainObject(item.temporary.api_key) ? item.temporary.api_key.$secret : null;
        return { kind: 'temporary', binding: clone(item), secretRef: ref || null, needsKey: !ref };
      }
      return typeof item.connection_id === 'string' ? { kind: 'connection', id: item.connection_id } : null;
    }

    // ── Sweeps card: axes, linked groups, run count ───────────────────────
    function maxJobs() {
      return api.maxJobs();
    }

    function axisRow(model, axis) {
      const members = axis.pointers.map((p, i) => {
        const found = model.found.find((f) => f.pointer === p);
        const shown = found.values.slice(0, 4).map((v) => valueText(p, v)).join(', ') + (found.values.length > 4 ? ', …' : '');
        return el('div', { className: 'xs-axis-member' }, [
          el('span', { className: 'xs-axis-name xl-mono', text: pointerLabel(p) }),
          api.tag('× ' + axis.lengths[i], 'count'),
          el('span', { className: 'xl-hint xs-axis-values', text: shown || 'no values' }),
        ]);
      });
      const uneven = axis.linked && axis.lengths.some((n) => n !== axis.lengths[0]);
      const lead = axis.linked
        ? api.tag('linked', 'accent', 'Zipped: the n-th values run together')
        : el('input', {
          type: 'checkbox', 'aria-label': 'Select ' + pointerLabel(axis.pointers[0]) + ' to link',
          'data-xs-link-pick': axis.pointers[0], checked: !!xs.selected[axis.pointers[0]],
          onChange: (e) => {
            if (e.target.checked) xs.selected[axis.pointers[0]] = true;
            else delete xs.selected[axis.pointers[0]];
            xs.linkError = '';
            render();
          },
        });
      return el('li', { className: 'xs-axis' + (axis.linked ? ' xs-axis--linked' : ''), 'data-xs-axis': axis.pointers.join(' ') }, [
        el('div', { className: 'xs-axis-lead' }, [lead]),
        el('div', { className: 'xs-axis-body' }, members.concat(uneven ? [el('div', { className: 'xl-error-text', role: 'alert', text: 'Linked values need the same number of values.' })] : [])),
        axis.linked ? el('button', {
          type: 'button', className: 'xl-link-btn', 'data-xs-unlink': String(axis.group), text: 'Unlink',
          onClick: () => {
            const groups = cleanLinks(st.links, sweptSet());
            groups.splice(axis.group, 1);
            st.links = groups.length ? groups : undefined;
            api.schedulePreview();
            render();
          },
        }) : null,
      ]);
    }

    function sweptSet() {
      const swept = {};
      sweepsOf(api.buildSpec()).forEach((f) => { swept[f.pointer] = true; });
      return swept;
    }

    function linkSelected(model) {
      const picked = model.found.filter((f) => xs.selected[f.pointer]).map((f) => f.pointer);
      if (picked.length < 2) return;
      const lengths = picked.map((p) => model.found.find((f) => f.pointer === p).values.length);
      if (lengths.some((n) => n !== lengths[0])) {
        xs.linkError = 'Linked values need the same number of values (' + picked.map((p, i) => pointerLabel(p) + ' has ' + lengths[i]).join(', ') + ').';
        render();
        return;
      }
      st.links = model.groups.concat([picked]);
      xs.selected = {};
      xs.linkError = '';
      api.schedulePreview();
      render();
    }

    function render() {
      if (!xs.active) return;
      const spec = api.buildSpec();
      const model = axesOf(spec);
      Object.keys(xs.selected).forEach((p) => {
        if (!model.axes.some((a) => !a.linked && a.pointers[0] === p)) delete xs.selected[p];
      });
      if (!model.found.length) {
        host.hidden = true;
        host.replaceChildren();
        return;
      }
      host.hidden = false;
      const envs = st.selected.length;
      const combos = comboCount(model.axes);
      const runs = combos * envs;
      const cap = maxJobs();
      const math = model.axes.map((a) => String(a.length)).join(' × ') + ' = ' + combos + ' combination' + (combos === 1 ? '' : 's')
        + ' × ' + envs + ' environment' + (envs === 1 ? '' : 's') + ' = ' + runs + ' run' + (runs === 1 ? '' : 's');
      const picked = Object.keys(xs.selected).length;
      const body = [
        el('div', { className: 'xs-row' }, [
          el('span', { className: 'xs-math xl-mono', 'data-xs-math': '1', text: math }),
          cap != null ? el('span', { className: 'xl-hint', text: 'limit ' + cap }) : null,
        ]),
      ];
      if (cap != null && runs > cap) {
        body.push(el('div', { className: 'xl-callout xl-callout--error', role: 'alert', 'data-xs-over-cap': '1', text: runs + ' runs is over the limit of ' + cap + '. Remove values, link them, or pick fewer environments.' }));
      }
      body.push(el('ul', { className: 'xs-axes', 'aria-label': 'Sweep axes' }, model.axes.map((axis) => axisRow(model, axis))));
      body.push(el('div', { className: 'xs-row' }, [
        el('button', {
          type: 'button', className: 'qym-inline-action qym-inline-action--neutral', 'data-xs-link': '1',
          disabled: picked < 2, text: 'Link selected',
          onClick: () => linkSelected(model),
        }),
        el('span', { className: 'xl-hint', text: picked < 2 ? 'Select two or more swept values to vary them together.' : picked + ' selected' }),
      ]));
      if (xs.linkError) body.push(el('div', { className: 'xl-error-text', role: 'alert', text: xs.linkError }));
      host.replaceChildren(el('section', { className: 'xl-card', 'data-xs-card': '1', 'data-xl-pointer': '/links', tabindex: '-1' }, [
        el('div', { className: 'xl-card-header' }, [el('div', null, [
          el('h2', { className: 'xl-section-title', text: 'Sweeps' }),
          el('p', { className: 'xl-section-description', text: 'Every swept value is an axis of the grid. Linked values vary together (zipped), e.g. model X with temperature 0.2 and model Y with 0.7.' }),
        ])]),
        el('div', { className: 'xl-card-body' }, body),
      ]));
    }

    function scheduleRender() {
      if (xs.frame || !xs.active) return;
      xs.frame = requestAnimationFrame(() => { xs.frame = null; render(); });
    }

    /** Drop links whose values stopped being swept, then refresh the card. */
    function onSpecChange() {
      if (st.links) {
        const groups = cleanLinks(st.links, sweptSet());
        if (!sameJson(groups, st.links)) st.links = groups.length ? groups : undefined;
      }
      scheduleRender();
    }

    /** "Preview N runs": the dry run's axes (secret-free summaries). */
    function previewAxes(preview) {
      const axes = (preview && preview.axes) || [];
      if (!axes.length) return null;
      return el('ul', { className: 'xs-preview-axes', 'aria-label': 'Swept values', 'data-xs-preview-axes': '1' }, axes.map((axis) => el('li', null, [
        el('span', { className: 'xl-mono', text: (axis.pointers || []).map(pointerLabel).join(' + ') }),
        el('span', { className: 'xl-hint xl-mono', text: ' × ' + axis.length }),
        axis.linked ? el('span', { className: 'xl-hint', text: ' · linked' }) : null,
      ])));
    }

    function teardown() {
      xs.active = false;
      if (xs.frame) cancelAnimationFrame(xs.frame);
      xs.frame = null;
      host.replaceChildren();
    }

    host.className = 'xs-host';
    render();
    return {
      sweepable, toggle, editor, modelToggle, modelCard, checkValues, bindingKey, checkLinks,
      localErrors, jobEstimate, previewAxes, onSpecChange, teardown,
    };
  }

  window.QymLaunchSweeps = { mount, sweepable, checkValues, bindingKey };
})();
