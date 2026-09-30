/*
 * Experiment detail matrix (plan §12.2, issue #35), used by experiments.js.
 *
 *   rows    = combinations (combo_index, labelled like the run names)
 *   columns = environments
 *   cell    = the current (non-superseded) attempt: status, headline metric,
 *             run link, cancel/retry (from the page) and "Save as preset".
 *
 * Also: "Compare selected" (opens compare.html with repeated runs= ids) and a
 * param-vs-metric chart (one swept param on x, a metric on y, one series per
 * environment). Earlier attempts stay in the page's job history below.
 *
 * Save as preset posts the job's secret-free qym_config (schema_hash, evaluator,
 * slot_bindings, env_overrides) as a saved preset on that environment:
 *   POST /v1/projects/{pid}/eval-environments/{env_id}/presets
 * Temporary models are saved without their key (the preset API drops it).
 *
 * Security: every node is built with el()/createElementNS and text goes through
 * textContent, so no server string is ever parsed as HTML.
 */
(function () {
  'use strict';

  const SERIES_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)'];
  // A sixth environment and beyond fold into one neutral "other" colour (never cycled).
  const OTHER_COLOR = 'var(--text-muted)';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CHART = { width: 640, height: 240, left: 52, right: 16, top: 12, bottom: 40 };

  // Per experiment, kept across polling re-renders.
  const memory = {};

  function viewState(experimentId) {
    if (!memory[experimentId]) memory[experimentId] = { selected: [], param: null, metric: null, saving: {} };
    return memory[experimentId];
  }

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

  function svg(tag, attrs, style) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs || {}).forEach((key) => node.setAttribute(key, String(attrs[key])));
    Object.keys(style || {}).forEach((key) => { node.style[key] = style[key]; });
    return node;
  }

  function svgText(attrs, text, className) {
    const node = svg('text', attrs);
    node.setAttribute('class', className || 'exp-mx-axis');
    node.textContent = String(text);
    return node;
  }

  function formatMetric(value) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    if (abs >= 1000) return value.toFixed(0);
    if (abs >= 100) return value.toFixed(1);
    return value.toFixed(3);
  }

  function formatParam(value) {
    if (value === null || value === undefined) return 'inherit';
    if (typeof value !== 'object') return String(value);
    if (value.temporary && typeof value.temporary === 'object') {
      return String(value.temporary.model || value.temporary.label || 'temporary');
    }
    if (value.connection_id) return String(value.model || value.name || value.connection_id);
    if (value.inherit === true) return 'inherit';
    try { return JSON.stringify(value); } catch (_) { return '?'; }
  }

  function usableRun(job) {
    return !!(job && job.run_id && !(job.run && job.run.deleted));
  }

  function currentJobs(detail) {
    return (detail.jobs || []).filter((job) => !job.superseded);
  }

  // ── Matrix ──────────────────────────────────────────────────────────────
  function combos(detail) {
    const byIndex = {};
    (detail.jobs || []).forEach((job) => {
      if (!byIndex[job.combo_index]) byIndex[job.combo_index] = { index: job.combo_index, label: '', sweep: {} };
      const combo = byIndex[job.combo_index];
      if (job.combo_label && !combo.label) combo.label = job.combo_label;
      const sweep = job.params && job.params.sweep;
      if (sweep && typeof sweep === 'object' && !Object.keys(combo.sweep).length) combo.sweep = sweep;
    });
    return Object.keys(byIndex).map(Number).sort((a, b) => a - b).map((i) => byIndex[i]);
  }

  function environments(detail) {
    const envs = (detail.environments || []).map((env) => ({ id: env.id, name: env.name, active: env.is_active !== false }));
    (detail.jobs || []).forEach((job) => {
      if (!envs.some((env) => env.id === job.environment_id)) {
        envs.push({ id: job.environment_id, name: job.environment_name || job.environment_id, active: true });
      }
    });
    return envs;
  }

  function cellJobs(detail) {
    const cells = {};
    (detail.jobs || []).forEach((job) => {
      const key = job.combo_index + '|' + job.environment_id;
      const cell = cells[key] || (cells[key] = { current: null, earlier: [] });
      if (job.superseded) cell.earlier.push(job);
      else cell.current = job;
    });
    return cells;
  }

  function renderCell(ctx, view, cell, env) {
    const td = el('td', { className: 'exp-mx-cell' });
    const job = cell && cell.current;
    if (!job) {
      td.appendChild(el('span', { className: 'exp-muted', text: '—' }));
      return td;
    }
    td.setAttribute('data-exp-cell', job.id);

    const top = el('div', { className: 'exp-mx-cell-top' });
    if (usableRun(job)) {
      const box = el('input', {
        type: 'checkbox',
        className: 'exp-mx-check',
        'data-exp-select': job.run_id,
        'aria-label': 'Select run for comparison',
        checked: view.selected.indexOf(job.run_id) >= 0,
      });
      box.addEventListener('change', () => {
        const at = view.selected.indexOf(job.run_id);
        if (box.checked && at < 0) view.selected.push(job.run_id);
        if (!box.checked && at >= 0) view.selected.splice(at, 1);
        ctx.rerender();
      });
      top.appendChild(box);
    }
    top.appendChild(ctx.badge(job.status));
    if (cell.earlier.length) {
      const earlier = el('button', {
        type: 'button',
        className: 'exp-mx-attempts',
        'data-exp-attempts': job.id,
        title: 'Show earlier attempts in the job history',
        text: '↻ ' + cell.earlier.length + ' earlier',
      });
      earlier.addEventListener('click', () => ctx.showAttempts(job));
      top.appendChild(earlier);
    }
    td.appendChild(top);

    const headline = job.run && job.run.headline_metric;
    if (headline && typeof headline.mean === 'number') {
      td.appendChild(el('div', { className: 'exp-mx-metric' }, [
        el('span', { className: 'exp-mx-value', text: formatMetric(headline.mean) }),
        el('span', { className: 'exp-mx-metric-name', title: headline.name + (headline.direction === 'minimize' ? ' (lower is better)' : ''), text: headline.name }),
      ]));
    }

    if (usableRun(job)) {
      td.appendChild(el('a', {
        className: 'exp-run-link exp-mx-run',
        href: ctx.runUrl(job.run_id),
        title: job.run_name || job.run_id,
        text: job.run_name || job.run_id,
      }));
    } else if (job.run_id) {
      td.appendChild(el('div', { className: 'exp-sub', text: 'Run deleted' }));
    }
    if (job.error) td.appendChild(el('div', { className: 'exp-sub exp-error-text', title: job.error, text: job.error }));
    else if (job.wait_reason && !ctx.isTerminal(job.status)) td.appendChild(el('div', { className: 'exp-sub', text: job.wait_reason }));

    const actions = ctx.jobActions(job);
    actions.classList.add('exp-mx-actions');
    actions.appendChild(savePresetButton(ctx, view, job, env));
    td.appendChild(actions);
    return td;
  }

  function renderMatrix(ctx, view) {
    const detail = ctx.detail;
    const envs = environments(detail);
    const rows = combos(detail);
    const cells = cellJobs(detail);
    const liveRuns = currentJobs(detail).filter(usableRun).map((job) => job.run_id);
    view.selected = view.selected.filter((id) => liveRuns.indexOf(id) >= 0);

    const compare = el('button', {
      type: 'button',
      className: 'qym-inline-action qym-inline-action--accent',
      'data-exp-compare': '1',
      disabled: view.selected.length < 2,
      title: view.selected.length < 2 ? 'Select at least two runs' : 'Open the selected runs side by side',
      text: 'Compare selected (' + view.selected.length + ')',
    });
    compare.addEventListener('click', () => openCompare(ctx, view.selected));
    const selectAll = el('button', {
      type: 'button',
      className: 'qym-inline-action qym-inline-action--neutral',
      disabled: !liveRuns.length || view.selected.length === liveRuns.length,
      text: 'Select all runs',
    });
    selectAll.addEventListener('click', () => { view.selected = liveRuns.slice(); ctx.rerender(); });
    const clear = el('button', {
      type: 'button',
      className: 'qym-inline-action qym-inline-action--neutral',
      disabled: !view.selected.length,
      text: 'Clear',
    });
    clear.addEventListener('click', () => { view.selected = []; ctx.rerender(); });

    const card = el('section', { className: 'exp-card', 'data-exp-matrix': '1' }, [
      el('div', { className: 'exp-card-header' }, [
        el('div', null, [
          el('h2', { className: 'exp-section-title', text: 'Matrix' }),
          el('p', { className: 'exp-section-description', text: rows.length + ' combination' + (rows.length === 1 ? '' : 's') + ' × ' + envs.length + ' environment' + (envs.length === 1 ? '' : 's') + '. Each cell is the latest attempt.' }),
        ]),
        el('div', { className: 'exp-mx-toolbar' }, [selectAll, clear, compare]),
      ]),
    ]);

    const head = el('tr', null, [el('th', { className: 'exp-mx-combo-head', text: 'Combination' })].concat(
      envs.map((env) => el('th', { title: env.name, text: env.name + (env.active ? '' : ' (disabled)') }))
    ));
    const body = el('tbody', null, rows.map((combo) => {
      const label = el('td', { className: 'exp-mx-combo' }, [
        el('div', { className: 'exp-mx-combo-label', title: combo.label || '', text: combo.label || (rows.length === 1 ? 'Configuration' : 'Combination') }),
        el('div', { className: 'exp-sub exp-mono', text: '#' + combo.index }),
      ]);
      return el('tr', { 'data-combo-index': combo.index }, [label].concat(
        envs.map((env) => renderCell(ctx, view, cells[combo.index + '|' + env.id], env))
      ));
    }));
    card.appendChild(el('div', { className: 'exp-table-wrap' }, el('table', { className: 'qdt-table exp-mx-table' }, [el('thead', null, head), body])));
    return card;
  }

  function openCompare(ctx, runIds) {
    if (runIds.length < 2) return;
    try {
      sessionStorage.removeItem('compareCohorts');
      sessionStorage.setItem('compareRuns', JSON.stringify(runIds));
    } catch (_) { /* the URL carries the runs */ }
    ctx.navigate(ctx.appRoot() + 'compare?' + runIds.map((id) => 'runs=' + encodeURIComponent(id)).join('&'));
  }

  // ── Save as preset ──────────────────────────────────────────────────────
  function presetConfig(job) {
    const source = job.qym_config || {};
    const config = {};
    ['schema_hash', 'evaluator', 'slot_bindings', 'env_overrides'].forEach((key) => {
      if (source[key] !== undefined && source[key] !== null) config[key] = source[key];
    });
    return config;
  }

  function temporaryModels(config) {
    const bindings = config.slot_bindings || {};
    return Object.keys(bindings)
      .filter((slot) => bindings[slot] && typeof bindings[slot] === 'object' && bindings[slot].temporary)
      .map((slot) => formatParam(bindings[slot]) + ' (' + slot + ')');
  }

  function savePresetButton(ctx, view, job, env) {
    const busy = !!view.saving[job.id];
    const reason = !job.qym_config
      ? 'This job has no stored configuration'
      : (env && !env.active ? 'The environment is disabled' : null);
    const btn = el('button', {
      type: 'button',
      className: 'qym-inline-action qym-inline-action--neutral',
      'data-exp-save-preset': job.id,
      disabled: !!reason || busy,
      title: reason || 'Save this cell’s configuration as a preset on ' + (job.environment_name || 'its environment'),
      text: busy ? 'Saving…' : 'Save as preset',
    });
    btn.addEventListener('click', (event) => { event.stopPropagation(); savePreset(ctx, view, job); });
    return btn;
  }

  async function askPresetName(job, defaultName, temporary) {
    const description = ['Saves combination #' + job.combo_index + ' on ' + (job.environment_name || 'this environment') + ' as a saved preset (without its sweep).'];
    temporary.forEach((name) => {
      description.push('Temporary model ' + name + ' is saved without its key; it is asked for again at launch.');
    });
    const shell = window.QymShell;
    if (shell && shell.openFormDialog) {
      const result = await shell.openFormDialog({
        title: 'Save as preset',
        description: description,
        fields: [
          { name: 'name', label: 'Preset name', value: defaultName, required: true },
          { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, placeholder: 'Optional' },
        ],
        confirmLabel: 'Save preset',
      });
      return result && result.confirmed ? result.values : null;
    }
    const name = window.prompt(description.join('\n') + '\n\nPreset name', defaultName);
    return name ? { name: name, notes: '' } : null;
  }

  async function savePreset(ctx, view, job) {
    if (view.saving[job.id]) return;
    const config = presetConfig(job);
    const label = job.combo_label ? ' · ' + job.combo_label : '';
    const defaultName = ((ctx.detail.name || 'Experiment') + label).slice(0, 200);
    const values = await askPresetName(job, defaultName, temporaryModels(config));
    if (!values || !ctx.isActive()) return;
    view.saving[job.id] = true;
    ctx.rerender();
    const res = await ctx.postJson(
      'v1/projects/' + encodeURIComponent(ctx.projectId) + '/eval-environments/' + encodeURIComponent(job.environment_id) + '/presets',
      { kind: 'saved', name: String(values.name || '').trim(), notes: String(values.notes || '').trim() || null, config: config }
    );
    delete view.saving[job.id];
    if (!ctx.isActive()) return;
    ctx.rerender();
    if (!res.ok) {
      const detail = res.data && res.data.detail;
      const first = detail && Array.isArray(detail.errors) && detail.errors[0];
      ctx.toast((first && first.message) || ctx.errorMessage(res.data, 'Failed to save the preset'), 'error');
      return;
    }
    const warnings = (res.data.warnings || []).map((w) => w && w.message).filter(Boolean);
    ctx.toast('Saved preset “' + ((res.data.preset && res.data.preset.name) || values.name) + '”', 'success');
    if (warnings.length) ctx.toast(warnings.slice(0, 2).join(' '), 'info');
  }

  // ── Param-vs-metric chart ───────────────────────────────────────────────
  function metricNames(jobs) {
    const counts = {};
    const order = [];
    jobs.forEach((job) => {
      const means = (job.run && job.run.metric_means) || {};
      Object.keys(means).forEach((name) => {
        if (typeof means[name] !== 'number') return;
        if (!(name in counts)) { counts[name] = 0; order.push(name); }
      });
      const headline = job.run && job.run.headline_metric;
      if (headline && headline.name in counts) counts[headline.name] += 1;
    });
    return order.sort((a, b) => counts[b] - counts[a]);
  }

  function chartPoints(ctx, pointer, metric) {
    const envs = environments(ctx.detail);
    const points = [];
    currentJobs(ctx.detail).forEach((job) => {
      if (!usableRun(job)) return;
      const value = ((job.run && job.run.metric_means) || {})[metric];
      const sweep = (job.params && job.params.sweep) || {};
      if (typeof value !== 'number' || !Number.isFinite(value) || !(pointer in sweep)) return;
      const envIndex = envs.findIndex((env) => env.id === job.environment_id);
      points.push({ job: job, x: sweep[pointer], y: value, env: envs[envIndex], envIndex: envIndex });
    });
    return { envs: envs, points: points };
  }

  function seriesColor(index) {
    return index < SERIES_COLORS.length ? SERIES_COLORS[index] : OTHER_COLOR;
  }

  function niceTicks(min, max) {
    const ticks = [];
    for (let i = 0; i <= 4; i += 1) ticks.push(min + ((max - min) * i) / 4);
    return ticks;
  }

  function drawChart(data, key, metric) {
    const numeric = data.points.every((p) => typeof p.x === 'number' && Number.isFinite(p.x));
    const categories = [];
    if (!numeric) {
      data.points.forEach((p) => { const c = formatParam(p.x); if (categories.indexOf(c) < 0) categories.push(c); });
    }
    const xs = numeric ? data.points.map((p) => p.x) : [];
    const ys = data.points.map((p) => p.y);
    let yMin = Math.min.apply(null, ys);
    let yMax = Math.max.apply(null, ys);
    const pad = yMax === yMin ? (Math.abs(yMax) * 0.1 || 0.5) : (yMax - yMin) * 0.08;
    yMin -= pad; yMax += pad;
    const xMin = numeric ? Math.min.apply(null, xs) : 0;
    const xMax = numeric ? Math.max.apply(null, xs) : 0;
    const plotW = CHART.width - CHART.left - CHART.right;
    const plotH = CHART.height - CHART.top - CHART.bottom;
    const xPos = (value) => {
      if (numeric) return CHART.left + (xMax === xMin ? plotW / 2 : ((value - xMin) / (xMax - xMin)) * plotW);
      const i = categories.indexOf(formatParam(value));
      return CHART.left + (categories.length === 1 ? plotW / 2 : (i / (categories.length - 1)) * plotW);
    };
    const yPos = (value) => CHART.top + plotH - ((value - yMin) / (yMax - yMin)) * plotH;

    const root = svg('svg', { viewBox: '0 0 ' + CHART.width + ' ' + CHART.height, role: 'img', 'aria-label': metric + ' by ' + key });
    root.setAttribute('class', 'exp-mx-svg');
    niceTicks(yMin, yMax).forEach((tick) => {
      const y = yPos(tick);
      root.appendChild(svg('line', { x1: CHART.left, x2: CHART.width - CHART.right, y1: y, y2: y }, { stroke: 'var(--border-subtle)', strokeWidth: '1' }));
      root.appendChild(svgText({ x: CHART.left - 6, y: y + 4, 'text-anchor': 'end' }, formatMetric(tick)));
    });
    const xTicks = numeric
      ? Array.from(new Set(xs)).sort((a, b) => a - b).map((v) => ({ value: v, label: String(v) }))
      : categories.map((c) => ({ value: c, label: c }));
    xTicks.forEach((tick) => {
      const x = numeric ? xPos(tick.value) : CHART.left + (categories.length === 1 ? plotW / 2 : (categories.indexOf(tick.label) / (categories.length - 1)) * plotW);
      const label = tick.label.length > 18 ? tick.label.slice(0, 17) + '…' : tick.label;
      root.appendChild(svgText({ x: x, y: CHART.height - CHART.bottom + 16, 'text-anchor': 'middle' }, label));
    });
    root.appendChild(svg('line', { x1: CHART.left, x2: CHART.width - CHART.right, y1: CHART.top + plotH, y2: CHART.top + plotH }, { stroke: 'var(--border-default)', strokeWidth: '1' }));
    root.appendChild(svgText({ x: CHART.left + plotW / 2, y: CHART.height - 4, 'text-anchor': 'middle' }, key, 'exp-mx-axis exp-mx-axis-title'));

    data.envs.forEach((env, envIndex) => {
      const own = data.points.filter((p) => p.envIndex === envIndex);
      if (!own.length) return;
      const color = seriesColor(envIndex);
      // Line through the mean per x value (other swept params may repeat an x).
      const byX = {};
      own.forEach((p) => { const k = numeric ? String(p.x) : formatParam(p.x); (byX[k] = byX[k] || { x: p.x, ys: [] }).ys.push(p.y); });
      const line = Object.keys(byX).map((k) => byX[k])
        .map((g) => ({ px: xPos(g.x), py: yPos(g.ys.reduce((a, b) => a + b, 0) / g.ys.length) }))
        .sort((a, b) => a.px - b.px);
      if (line.length > 1) {
        root.appendChild(svg('polyline', { points: line.map((p) => p.px + ',' + p.py).join(' '), fill: 'none' }, { stroke: color, strokeWidth: '2', strokeLinejoin: 'round' }));
      }
      own.forEach((p) => {
        const dot = svg('circle', { cx: xPos(p.x), cy: yPos(p.y), r: 4 }, { fill: color, stroke: 'var(--bg-surface)', strokeWidth: '2' });
        const title = svg('title');
        title.textContent = env.name + ' · ' + key + '=' + formatParam(p.x) + ' · ' + metric + ' ' + formatMetric(p.y)
          + (p.job.combo_label ? ' · ' + p.job.combo_label : '');
        dot.appendChild(title);
        root.appendChild(dot);
      });
    });
    return root;
  }

  function renderChart(ctx, view) {
    const keys = ctx.detail.sweep_keys || {};
    const pointers = Object.keys(keys);
    if (!pointers.length) return null;
    const metrics = metricNames(currentJobs(ctx.detail).filter(usableRun));
    if (pointers.indexOf(view.param) < 0) view.param = pointers[0];
    if (metrics.indexOf(view.metric) < 0) view.metric = metrics[0] || null;

    const paramSelect = el('select', { className: 'qym-control qym-select', 'aria-label': 'Swept setting', 'data-exp-chart-param': '1' },
      pointers.map((p) => el('option', { value: p, title: p, text: keys[p], selected: p === view.param })));
    paramSelect.addEventListener('change', () => { view.param = paramSelect.value; ctx.rerender(); });
    const metricSelect = el('select', { className: 'qym-control qym-select', 'aria-label': 'Metric', 'data-exp-chart-metric': '1', disabled: !metrics.length },
      metrics.length ? metrics.map((m) => el('option', { value: m, text: m, selected: m === view.metric })) : [el('option', { text: 'No metrics yet' })]);
    metricSelect.addEventListener('change', () => { view.metric = metricSelect.value; ctx.rerender(); });

    const card = el('section', { className: 'exp-card', 'data-exp-chart': '1' }, [
      el('div', { className: 'exp-card-header' }, [
        el('div', null, [
          el('h2', { className: 'exp-section-title', text: 'Setting vs metric' }),
          el('p', { className: 'exp-section-description', text: 'Mean metric of each finished run against one swept setting, one line per environment.' }),
        ]),
        el('div', { className: 'exp-mx-toolbar' }, [
          el('span', { className: 'exp-toolbar-label', text: 'X axis' }), paramSelect,
          el('span', { className: 'exp-toolbar-label', text: 'Metric' }), metricSelect,
        ]),
      ]),
    ]);
    const data = view.metric ? chartPoints(ctx, view.param, view.metric) : { envs: [], points: [] };
    if (!data.points.length) {
      card.appendChild(el('div', { className: 'exp-empty' }, [
        el('p', { className: 'exp-empty-body', text: 'Nothing to plot yet: points appear as runs finish and report scores.' }),
      ]));
      return card;
    }
    const legend = el('div', { className: 'exp-mx-legend' });
    data.envs.forEach((env, i) => {
      if (!data.points.some((p) => p.envIndex === i)) return;
      const swatch = el('span', { className: 'exp-mx-swatch', 'aria-hidden': 'true' });
      swatch.style.background = seriesColor(i);
      legend.appendChild(el('span', { className: 'exp-mx-legend-item' }, [swatch, env.name]));
    });
    card.appendChild(el('div', { className: 'exp-mx-chart' }, [drawChart(data, keys[view.param], view.metric), legend]));
    return card;
  }

  window.QymExperimentMatrix = {
    /**
     * ctx: { detail, projectId, badge(status), jobActions(job), runUrl(id), appRoot(),
     *        navigate(url), postJson(path, body), toast(msg, type), errorMessage(data, fb),
     *        isTerminal(status), isActive(), rerender(), showAttempts(job) }
     * Returns the section nodes to mount, in order.
     */
    render: function (ctx) {
      const view = viewState(ctx.detail.id);
      return [renderMatrix(ctx, view), renderChart(ctx, view)].filter(Boolean);
    },
  };
})();
