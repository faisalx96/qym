/*
 * Experiments page (plan §12.2, issue #22): /projects/{slug}/experiments
 *
 *   list    → /projects/{slug}/experiments
 *   detail  → /projects/{slug}/experiments?experiment=<id>
 *   new     → /projects/{slug}/experiments?new=1  (launch form, experiment_launch.js)
 *
 * Consumes the experiments API (api/experiments.py):
 *   GET  /v1/projects/{pid}/experiments[?status=&mine=&limit=&offset=]
 *   GET  /v1/projects/{pid}/experiments/{xid}
 *   POST /v1/projects/{pid}/experiments/{xid}/cancel
 *   POST /v1/projects/{pid}/experiments/{xid}/jobs/{jid}/cancel
 *   POST /v1/projects/{pid}/experiments/{xid}/jobs/{jid}/retry
 * and the environments list (names for the Environments column).
 *
 * The detail view mounts the combination × environment matrix and the
 * param-vs-metric chart from experiment_matrix.js (#35) above the job history;
 * cancel/retry (single, all, and "Retry failed") stay in this file. The launch
 * form (#23) lives in experiment_launch.js (window.QymExperimentLaunch); this file
 * only routes to it (?new=1).
 *
 * The list carries an Experiments | Queue tab pair (the queue page, #25, lives in
 * eval_queue.js); the detail view shows a queue strip for this experiment from
 *   GET /v1/projects/{pid}/eval-queue?experiment_id=<id>
 *
 * Security: every node is built with el()/textContent, so no server string
 * (names, emails, errors, params) is ever parsed as HTML; there is no innerHTML.
 *
 * The shell re-executes this script on every client-side navigation, so each
 * run mounts fresh and tears its timers down on qym:before-navigate.
 */
(function () {
  'use strict';

  const TERMINAL = ['SUCCEEDED', 'FAILED', 'CANCELLED', 'TIMED_OUT'];
  const RETRYABLE = ['FAILED', 'CANCELLED', 'TIMED_OUT', 'BLOCKED'];
  const QUEUED_HERE = ['QUEUED', 'BLOCKED'];
  const LIVE_EXPERIMENT = ['QUEUED', 'RUNNING'];
  const PAGE_SIZE = 50;
  const POLL_MIN_MS = 5000;
  const POLL_MAX_MS = 60000;
  // services/eval_priority.PREEMPTION_ACK_REQUIRED: a HIGH retry needs acknowledge_preemption.
  const PREEMPTION_ACK_REQUIRED = 'preemption_acknowledgement_required';

  const EXPERIMENT_TONES = {
    QUEUED: 'neutral', RUNNING: 'info', COMPLETED: 'success',
    PARTIAL: 'warning', FAILED: 'danger', CANCELLED: 'warning',
  };
  const JOB_TONES = {
    QUEUED: 'neutral', SUBMITTING: 'info', SUBMITTED: 'info', RUNNING: 'info',
    SUCCEEDED: 'success', FAILED: 'danger', TIMED_OUT: 'danger',
    BLOCKED: 'warning', CANCELLING: 'warning', CANCELLED: 'warning',
  };
  const BASE_LABELS = {
    official: 'Official defaults', best_run: 'Best run', saved: 'Saved preset',
    blank: 'Blank', clone: 'Clone',
  };

  const root = document.getElementById('exp-root');
  if (!root) return;

  const state = {
    active: true,
    slug: '',
    project: null,
    me: null,
    experimentId: null,
    creating: false,
    launch: null,
    environments: {},
    // list
    list: null,
    page: 1,
    status: '',
    mine: false,
    // detail
    detail: null,
    crumbLabel: null,
    showSuperseded: false,
    denied: false,
    queueStrip: null,
    busy: {},
    // polling
    pollTimer: null,
    pollDelay: POLL_MIN_MS,
    lastFingerprint: '',
    generation: 0,
  };

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
    if (typeof window.__QYM_ROOT_PATH__ === 'string') {
      return window.__QYM_ROOT_PATH__.replace(/\/+$/, '') + '/';
    }
    const idx = window.location.pathname.indexOf('/projects/');
    return idx >= 0 ? window.location.pathname.slice(0, idx + 1) : '/';
  }

  function apiUrl(path) {
    return window.location.origin + appRoot() + String(path || '').replace(/^\/+/, '');
  }

  function projectPage(suffix) {
    return appRoot() + 'projects/' + encodeURIComponent(state.slug) + (suffix || '');
  }

  function experimentUrl(id) {
    return projectPage('/experiments') + (id ? '?experiment=' + encodeURIComponent(id) : '');
  }

  function queuePageUrl(experimentId) {
    return projectPage('/experiments/queue') + (experimentId ? '?experiment=' + encodeURIComponent(experimentId) : '');
  }

  function runUrl(runId) {
    return projectPage('/runs/' + encodeURIComponent(runId));
  }

  function experimentsPath(suffix) {
    return 'v1/projects/' + encodeURIComponent(state.project.id) + '/experiments' + (suffix || '');
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

  function postJson(path, body) {
    return request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
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

  function relTime(value) {
    if (!value) return '—';
    const stamp = new Date(value);
    if (Number.isNaN(stamp.getTime())) return '—';
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

  function titleCase(status) {
    const text = String(status || '').toLowerCase().replace(/_/g, ' ');
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  function badge(status, tones) {
    const tone = tones[status] || 'neutral';
    return el('span', { className: 'qym-badge qym-badge--' + tone, text: titleCase(status || 'unknown') });
  }

  function tag(text, modifier, title) {
    return el('span', { className: 'qym-tag' + (modifier ? ' qym-tag--' + modifier : ''), title: title || null, text: text });
  }

  function isTerminal(status) {
    return TERMINAL.indexOf(status) >= 0;
  }

  function baseSourceLabel(base) {
    const kind = base && base.kind;
    return BASE_LABELS[kind] || (kind ? titleCase(kind) : 'Blank');
  }

  function environmentNames(ids) {
    return (ids || []).map((id) => state.environments[id] || id);
  }

  function bestScore(experiment) {
    const value = experiment && experiment.best_score;
    if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(3);
    if (value && typeof value === 'object' && typeof value.value === 'number') return value.value.toFixed(3);
    return '—';
  }

  function jobCountsNode(counts) {
    counts = counts || {};
    let ok = 0; let bad = 0; let live = 0; let cancelled = 0;
    Object.keys(counts).forEach((status) => {
      const n = Number(counts[status]) || 0;
      if (status === 'SUCCEEDED') ok += n;
      else if (status === 'FAILED' || status === 'TIMED_OUT') bad += n;
      else if (status === 'CANCELLED') cancelled += n;
      else live += n;
    });
    const wrap = el('span', { className: 'exp-counts' });
    wrap.appendChild(tag('✓ ' + ok, 'success', ok + ' succeeded'));
    wrap.appendChild(tag('✗ ' + bad, 'danger', bad + ' failed or timed out'));
    if (live) wrap.appendChild(tag('● ' + live, 'info', live + ' queued or running'));
    if (cancelled) wrap.appendChild(tag('⊘ ' + cancelled, 'warning', cancelled + ' cancelled'));
    return wrap;
  }

  function paramsSummary(params) {
    if (!params || typeof params !== 'object') return '';
    return Object.keys(params).map((key) => {
      const value = params[key];
      const text = value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
      return key + '=' + text;
    }).join(', ');
  }

  function canControl(experiment) {
    if (state.denied) return false;
    const me = state.me || {};
    if (me.role === 'ADMIN') return true;
    if (state.project && state.project.role === 'MANAGER') return true;
    return !!(experiment && me.id && experiment.created_by_user_id === me.id);
  }

  /** "Promote to official" (#39) opens the official defaults editor: managers only. */
  function canPromote() {
    if (state.denied) return false;
    const me = state.me || {};
    return me.role === 'ADMIN' || !!(state.project && state.project.role === 'MANAGER');
  }

  const CONTROL_HINT = "Only the experiment's creator or a project manager can do this";

  // ── Polling (pauses while the tab is hidden) ───────────────────────────
  function clearPoll() {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }

  function needsPolling() {
    if (state.experimentId) {
      return !!(state.detail && (state.detail.jobs || []).some((job) => !isTerminal(job.status)));
    }
    return !!(state.list && (state.list.experiments || []).some((x) => LIVE_EXPERIMENT.indexOf(x.status) >= 0));
  }

  function schedulePoll(changed) {
    clearPoll();
    if (!state.active || !needsPolling()) {
      state.pollDelay = POLL_MIN_MS;
      return;
    }
    state.pollDelay = changed ? POLL_MIN_MS : Math.min(POLL_MAX_MS, Math.round(state.pollDelay * 1.5));
    if (document.hidden) return; // resumed by visibilitychange
    state.pollTimer = setTimeout(() => {
      state.pollTimer = null;
      refresh({ silent: true });
    }, state.pollDelay);
  }

  function onVisibility() {
    if (!state.active) return;
    if (document.hidden) {
      clearPoll();
    } else if (needsPolling()) {
      state.pollDelay = POLL_MIN_MS;
      refresh({ silent: true });
    }
  }

  function fingerprint(payload) {
    try { return JSON.stringify(payload); } catch (_) { return String(Date.now()); }
  }

  // ── Loading ────────────────────────────────────────────────────────────
  function renderMessage(className, text) {
    root.replaceChildren(el('div', { className: className, text: text }));
  }

  async function loadContext() {
    const ctx = window.QymShell && window.QymShell.getPageContext ? window.QymShell.getPageContext() : null;
    const match = window.location.pathname.match(/\/projects\/([^/]+)\/experiments\/?$/);
    state.slug = (ctx && ctx.projectSlug) || (match ? decodeURIComponent(match[1]) : '');
    const params = new URLSearchParams(window.location.search);
    state.experimentId = params.get('experiment') || null;
    state.creating = !state.experimentId && params.get('new') === '1';
    state.status = params.get('status') || '';
    state.mine = params.get('mine') === '1';

    const [project, me] = await Promise.all([
      request('v1/projects/by-slug/' + encodeURIComponent(state.slug)),
      window.__QYM_USER__ && window.__QYM_USER__.id
        ? Promise.resolve({ ok: true, data: window.__QYM_USER__ })
        : request('v1/me'),
    ]);
    if (!project.ok) throw new Error(errorMessage(project.data, 'Project not found'));
    state.project = project.data;
    state.me = me.ok ? me.data : null;

    const envs = await request('v1/projects/' + encodeURIComponent(state.project.id) + '/eval-environments');
    if (envs.ok) {
      (envs.data.environments || []).forEach((env) => { state.environments[env.id] = env.name; });
    }
  }

  async function refresh(opts) {
    opts = opts || {};
    const generation = ++state.generation;
    if (state.experimentId) {
      const res = await request(experimentsPath('/' + encodeURIComponent(state.experimentId)));
      if (!state.active || generation !== state.generation) return;
      if (!res.ok) {
        if (opts.silent) { schedulePoll(false); return; }
        renderMessage('exp-error', res.status === 404 ? 'Experiment not found.' : errorMessage(res.data, 'Failed to load the experiment'));
        return;
      }
      applyDetail(res.data);
    } else {
      const query = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String((state.page - 1) * PAGE_SIZE) });
      if (state.status) query.set('status', state.status);
      if (state.mine) query.set('mine', 'true');
      const res = await request(experimentsPath('?' + query.toString()));
      if (!state.active || generation !== state.generation) return;
      if (!res.ok) {
        if (opts.silent) { schedulePoll(false); return; }
        renderMessage('exp-error', errorMessage(res.data, 'Failed to load experiments'));
        return;
      }
      const print = fingerprint(res.data);
      const changed = print !== state.lastFingerprint;
      state.lastFingerprint = print;
      state.list = res.data;
      if (changed || !opts.silent) renderList();
      schedulePoll(changed);
    }
  }

  function applyDetail(detail) {
    const print = fingerprint(detail);
    const changed = print !== state.lastFingerprint;
    state.lastFingerprint = print;
    state.detail = detail;
    if (changed || !root.querySelector('[data-exp-detail]')) renderDetail();
    schedulePoll(changed);
    refreshQueueStrip();
  }

  // ── Queue strip (plan §12.3): where this experiment's pending jobs stand ──
  async function refreshQueueStrip() {
    const x = state.detail;
    if (!x || !(x.jobs || []).some((job) => !isTerminal(job.status))) {
      if (state.queueStrip) { state.queueStrip = null; replaceQueueStrip(); }
      return;
    }
    const generation = state.generation;
    const query = '?experiment_id=' + encodeURIComponent(x.id) + '&limit=1000';
    const res = await request('v1/projects/' + encodeURIComponent(state.project.id) + '/eval-queue' + query);
    if (!state.active || generation !== state.generation || !res.ok) return;
    state.queueStrip = res.data;
    replaceQueueStrip();
  }

  function replaceQueueStrip() {
    const current = root.querySelector('[data-exp-queue-strip]');
    if (current) current.replaceWith(queueStripNode());
  }

  function queueStripNode() {
    const node = el('div', { className: 'exp-queue-strip', 'data-exp-queue-strip': '1' });
    const jobs = (state.queueStrip && state.queueStrip.jobs) || [];
    if (!jobs.length || !state.detail) { node.hidden = true; return node; }
    const byEnv = {};
    jobs.forEach((job) => {
      const key = job.environment_id;
      const env = byEnv[key] || (byEnv[key] = { name: job.environment_name || key, queued: 0, running: 0, blocked: 0, position: null });
      if (job.status === 'QUEUED') {
        env.queued += 1;
        if (job.queue_position != null && (env.position === null || job.queue_position < env.position)) env.position = job.queue_position;
      } else if (job.status === 'BLOCKED') env.blocked += 1;
      else env.running += 1;
    });
    node.appendChild(el('span', { className: 'exp-queue-strip-label', text: 'Queue' }));
    Object.keys(byEnv).forEach((key) => {
      const env = byEnv[key];
      const parts = [];
      if (env.queued) parts.push(env.queued + ' queued');
      if (env.running) parts.push(env.running + ' running');
      if (env.blocked) parts.push(env.blocked + ' blocked');
      if (env.position !== null) parts.push('position ' + env.position);
      node.appendChild(el('span', { className: 'exp-queue-strip-env', 'data-exp-queue-env': key }, [
        el('span', { className: 'exp-queue-strip-name', text: env.name }),
        ' ' + parts.join(' · '),
      ]));
    });
    node.appendChild(el('a', { className: 'exp-queue-strip-link', href: queuePageUrl(state.detail.id), text: 'Open in queue →' }));
    return node;
  }

  // ── List view ──────────────────────────────────────────────────────────
  function newExperimentButton() {
    return el('button', {
      className: 'qym-inline-action qym-inline-action--accent',
      type: 'button',
      'data-exp-new': '1',
      text: '+ New experiment',
      onClick: () => navigate(projectPage('/experiments?new=1')),
    });
  }

  function mountLaunchForm() {
    if (!window.QymExperimentLaunch) {
      renderMessage('exp-error', 'The launch form failed to load.');
      return;
    }
    if (window.QymShell && window.QymShell.setBreadcrumbs) {
      const project = window.QymShell.getProject ? window.QymShell.getProject() : null;
      const crumbs = [];
      if (project) crumbs.push({ label: project.name, projectSwitcher: true });
      crumbs.push({ label: 'Experiments', href: experimentUrl(null) });
      crumbs.push({ label: 'New experiment', current: true });
      try { window.QymShell.setBreadcrumbs(crumbs); } catch (_) { /* shell owns the fallback */ }
    }
    state.launch = window.QymExperimentLaunch.mount({
      root,
      project: state.project,
      me: state.me,
      slug: state.slug,
      listUrl: experimentUrl(null),
      onCancel: () => navigate(experimentUrl(null)),
      onLaunched: (experiment) => navigate(experimentUrl(experiment.id)),
    });
  }

  function sectionTabs() {
    return el('nav', { className: 'qym-tabs exp-tabs', role: 'tablist', 'aria-label': 'Experiments sections', 'data-exp-tabs': '1' }, [
      el('a', { className: 'qym-tabs__tab exp-tab active', role: 'tab', 'aria-selected': 'true', 'aria-current': 'page', href: experimentUrl(null), text: 'Experiments' }),
      el('a', { className: 'qym-tabs__tab exp-tab', role: 'tab', 'aria-selected': 'false', href: queuePageUrl(null), text: 'Queue' }),
    ]);
  }

  function renderList() {
    const data = state.list || { experiments: [], total: 0 };
    const experiments = data.experiments || [];

    const header = el('div', { className: 'exp-header' }, [
      el('div', { className: 'exp-header-text' }, [
        el('h1', { className: 'exp-title', text: 'Experiments' }),
        el('p', { className: 'exp-description', text: 'Launch Evaluation Service runs across environments and follow their jobs.' }),
        el('div', { className: 'exp-meta' }, [
          el('span', { text: (data.total || 0) + ' experiment' + (data.total === 1 ? '' : 's') }),
        ]),
      ]),
      el('div', { className: 'exp-header-actions' }, [newExperimentButton()]),
    ]);

    const statusSelect = el('select', { className: 'qym-control qym-select', 'aria-label': 'Status', 'data-exp-status': '1' },
      [el('option', { value: '', text: 'All statuses' })].concat(
        Object.keys(EXPERIMENT_TONES).map((s) => el('option', { value: s, text: titleCase(s), selected: s === state.status }))
      ));
    statusSelect.addEventListener('change', () => {
      state.status = statusSelect.value;
      state.page = 1;
      syncListUrl();
      refresh();
    });
    const mineBox = el('input', { type: 'checkbox', 'data-exp-mine': '1', checked: state.mine });
    mineBox.addEventListener('change', () => {
      state.mine = mineBox.checked;
      state.page = 1;
      syncListUrl();
      refresh();
    });
    const toolbar = el('div', { className: 'exp-toolbar' }, [
      el('span', { className: 'exp-toolbar-label', text: 'Status' }),
      statusSelect,
      el('label', { className: 'exp-check' }, [mineBox, 'Created by me']),
      el('span', { className: 'exp-toolbar-spacer' }),
      needsPolling() ? el('span', { className: 'exp-poll-note', text: 'Auto-refreshing while experiments run' }) : null,
    ]);

    const card = el('section', { className: 'exp-card' });
    if (!experiments.length) {
      card.appendChild(el('div', { className: 'exp-empty' }, [
        el('h2', { className: 'exp-empty-title', text: state.status || state.mine ? 'No matching experiments' : 'No experiments yet' }),
        el('p', { className: 'exp-empty-body', text: state.status || state.mine
          ? 'Try a different status or include experiments created by others.'
          : 'Experiments launch evaluation jobs on this project’s environments. Register an environment in Project Settings → Environments first.' }),
      ]));
    } else {
      const host = el('div', { className: 'exp-table-wrap', 'data-exp-list': '1' });
      card.appendChild(host);
      renderListTable(host, experiments);
      const pager = el('div', { className: 'exp-footer' });
      card.appendChild(pager);
      if ((data.total || 0) > PAGE_SIZE && window.QymUIComponents && window.QymUIComponents.renderPagination) {
        const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
        window.QymUIComponents.renderPagination(pager, {
          page: state.page,
          pageCount: pageCount,
          pageSize: PAGE_SIZE,
          total: data.total,
          noun: 'experiments',
          onPageChange: (page) => { state.page = page; refresh(); },
        });
      }
    }

    root.replaceChildren(header, sectionTabs(), toolbar, card);
  }

  const LIST_COLUMNS = [
    { id: 'name', label: 'Name', width: 220, flex: 2 },
    { id: 'status', label: 'Status', width: 110 },
    { id: 'environments', label: 'Environments', width: 170, flex: 1 },
    { id: 'base', label: 'Base source', width: 130 },
    { id: 'jobs', label: 'Jobs', width: 170 },
    { id: 'best', label: 'Best score', width: 100, className: 'exp-num' },
    { id: 'creator', label: 'Creator', width: 170 },
    { id: 'age', label: 'Age', width: 100 },
  ];

  function renderListTable(host, experiments) {
    const render = (window.QymDataTable && window.QymDataTable.render) ? window.QymDataTable.render : null;
    const renderRow = (x) => {
      const envNames = environmentNames(x.environment_ids);
      const link = el('a', { className: 'exp-name', href: experimentUrl(x.id), text: x.name || x.id });
      const nameCell = el('td', { title: x.name || '' }, [link]);
      if (x.description) nameCell.appendChild(el('div', { className: 'exp-sub', text: x.description }));
      const tr = el('tr', { 'data-experiment-id': x.id }, [
        nameCell,
        el('td', null, [badge(x.status, EXPERIMENT_TONES)]),
        el('td', { title: envNames.join(', '), text: envNames.length ? envNames.join(', ') : '—' }),
        el('td', { text: baseSourceLabel(x.base_source) }),
        el('td', null, [jobCountsNode(x.job_counts)]),
        el('td', { className: 'exp-num', text: bestScore(x) }),
        el('td', { title: x.created_by_email || '', text: x.created_by_email || '—' }),
        el('td', { className: 'exp-mono', title: absTime(x.created_at), text: relTime(x.created_at) }),
      ]);
      tr.addEventListener('click', (event) => {
        if (event.target.closest('a,button,input,select')) return;
        navigate(experimentUrl(x.id));
      });
      return tr;
    };
    if (render) {
      render({ host: host, columns: LIST_COLUMNS, rows: experiments, storageKey: 'experiments.list.v1', minWidth: 1000, renderRow: renderRow });
      return;
    }
    const table = el('table', { className: 'qdt-table' }, [
      el('thead', null, el('tr', null, LIST_COLUMNS.map((c) => el('th', { text: c.label })))),
      el('tbody', null, experiments.map(renderRow)),
    ]);
    host.appendChild(table);
  }

  function syncListUrl() {
    const params = new URLSearchParams();
    if (state.status) params.set('status', state.status);
    if (state.mine) params.set('mine', '1');
    const query = params.toString();
    history.replaceState(history.state, '', projectPage('/experiments') + (query ? '?' + query : ''));
  }

  function navigate(url) {
    if (window.QymShell && window.QymShell.navigateTo) window.QymShell.navigateTo(url);
    else window.location.href = url;
  }

  // ── Detail view ────────────────────────────────────────────────────────
  function setDetailBreadcrumbs(detail) {
    if (!window.QymShell || !window.QymShell.setBreadcrumbs) return;
    const label = detail.name || detail.id;
    if (state.crumbLabel === label) return; // re-rendering would close an open project switcher
    state.crumbLabel = label;
    const project = window.QymShell.getProject ? window.QymShell.getProject() : null;
    const crumbs = [];
    if (project) crumbs.push({ label: project.name, projectSwitcher: true });
    crumbs.push({ label: 'Experiments', href: experimentUrl(null) });
    crumbs.push({ label: label, current: true });
    try { window.QymShell.setBreadcrumbs(crumbs); } catch (_) { /* shell owns the fallback */ }
  }

  function renderDetail() {
    const x = state.detail;
    if (!x) return;
    setDetailBreadcrumbs(x);
    const jobs = x.jobs || [];
    const current = jobs.filter((job) => !job.superseded);
    const live = current.filter((job) => !isTerminal(job.status));
    const allowed = canControl(x);

    const cancelAll = el('button', {
      className: 'qym-inline-action qym-inline-action--danger',
      type: 'button',
      'data-exp-cancel-all': '1',
      disabled: !live.length || !allowed || state.busy.all,
      title: !allowed ? CONTROL_HINT : (live.length ? 'Cancel every queued or running job' : 'No jobs left to cancel'),
      text: state.busy.all ? 'Cancelling…' : 'Cancel experiment',
    });
    cancelAll.addEventListener('click', () => cancelExperiment());

    const retryable = current.filter((job) => RETRYABLE.indexOf(job.status) >= 0);
    const retryAllBtn = el('button', {
      className: 'qym-inline-action qym-inline-action--neutral',
      type: 'button',
      'data-exp-retry-all': '1',
      disabled: !retryable.length || !allowed || state.busy.retryAll,
      title: !allowed ? CONTROL_HINT : (retryable.length ? 'Queue a new attempt of every failed, cancelled or blocked job' : 'No jobs to retry'),
      text: state.busy.retryAll ? 'Retrying…' : 'Retry failed (' + retryable.length + ')',
    });
    retryAllBtn.addEventListener('click', () => retryAll());

    const envNames = (x.environments || []).map((env) => env.name + (env.is_active ? '' : ' (disabled)'));
    const metaParts = [
      x.created_by_email ? 'Created by ' + x.created_by_email : null,
      relTime(x.created_at),
      'Priority ' + titleCase(x.priority),
      'Base: ' + baseSourceLabel(x.base_source),
      envNames.length ? envNames.join(', ') : null,
    ].filter(Boolean);
    const meta = el('div', { className: 'exp-meta' });
    metaParts.forEach((part, i) => {
      if (i) meta.appendChild(el('span', { className: 'exp-meta-sep', 'aria-hidden': 'true', text: '·' }));
      meta.appendChild(el('span', { text: part, title: i === 1 ? absTime(x.created_at) : null }));
    });

    const header = el('div', { className: 'exp-header', 'data-exp-detail': '1' }, [
      el('div', { className: 'exp-header-text' }, [
        el('a', { className: 'exp-back', href: experimentUrl(null), text: '← All experiments' }),
        el('h1', { className: 'exp-title', text: x.name || x.id }),
        el('p', { className: 'exp-description', text: x.description || 'Jobs launched by this experiment, one per combination and environment.' }),
        meta,
      ]),
      el('div', { className: 'exp-header-actions' }, [badge(x.status, EXPERIMENT_TONES), retryAllBtn, cancelAll]),
    ]);

    const counts = x.job_counts || {};
    const sum = (list) => list.reduce((n, s) => n + (Number(counts[s]) || 0), 0);
    const stats = el('div', { className: 'qym-stat-strip exp-stats' }, [
      ['Jobs', current.length],
      ['Succeeded', sum(['SUCCEEDED'])],
      ['Failed', sum(['FAILED', 'TIMED_OUT'])],
      ['In progress', live.length],
      ['Cancelled', sum(['CANCELLED'])],
    ].map((pair) => el('div', { className: 'qym-stat-strip__item' }, [
      el('div', { className: 'qym-stat-strip__label', text: pair[0] }),
      el('div', { className: 'qym-stat-strip__value', text: String(pair[1]) }),
    ])));

    const supersededCount = jobs.length - current.length;
    const toggle = el('input', { type: 'checkbox', 'data-exp-superseded': '1', checked: state.showSuperseded });
    toggle.addEventListener('change', () => { state.showSuperseded = toggle.checked; renderDetail(); });

    const card = el('section', { className: 'exp-card' }, [
      el('div', { className: 'exp-card-header' }, [
        el('div', null, [
          el('h2', { className: 'exp-section-title', text: 'Job history' }),
          el('p', { className: 'exp-section-description', text: live.length
            ? 'Refreshing automatically while jobs are queued or running.'
            : 'Every job has finished.' }),
        ]),
        supersededCount ? el('label', { className: 'exp-check' }, [toggle, 'Show earlier attempts (' + supersededCount + ')']) : null,
      ]),
    ]);
    const visible = state.showSuperseded ? jobs : current;
    if (!visible.length) {
      card.appendChild(el('div', { className: 'exp-empty' }, [
        el('p', { className: 'exp-empty-body', text: 'This experiment has no jobs.' }),
      ]));
    } else {
      const host = el('div', { className: 'exp-table-wrap', 'data-exp-jobs': '1' });
      card.appendChild(host);
      renderJobsTable(host, visible, allowed);
    }

    const matrix = jobs.length && window.QymExperimentMatrix ? window.QymExperimentMatrix.render(matrixContext(x, allowed)) : [];
    root.replaceChildren.apply(root, [header, stats, queueStripNode()].concat(matrix, [card]));
  }

  function matrixContext(x, allowed) {
    return {
      detail: x,
      projectId: state.project.id,
      badge: (status) => badge(status, JOB_TONES),
      jobActions: (job) => jobActions(job, allowed),
      runUrl: runUrl,
      appRoot: appRoot,
      navigate: navigate,
      postJson: postJson,
      toast: toast,
      errorMessage: errorMessage,
      isTerminal: isTerminal,
      isActive: () => state.active,
      rerender: renderDetail,
      showAttempts: showAttempts,
      canPromote: canPromote(),
      projectSlug: state.project.slug,
    };
  }

  function showAttempts(job) {
    state.showSuperseded = true;
    renderDetail();
    const row = root.querySelector('[data-job-id="' + (window.CSS && CSS.escape ? CSS.escape(job.id) : job.id) + '"]');
    const host = root.querySelector('[data-exp-jobs]');
    const target = row || host;
    if (target && target.scrollIntoView) target.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  const JOB_COLUMNS = [
    { id: 'combo', label: 'Combo', width: 70, className: 'exp-num' },
    { id: 'environment', label: 'Environment', width: 150 },
    { id: 'params', label: 'Params', width: 220, flex: 2 },
    { id: 'status', label: 'Status', width: 190, flex: 1 },
    { id: 'attempt', label: 'Attempt', width: 80, className: 'exp-num' },
    { id: 'run', label: 'Run', width: 170 },
    { id: 'updated', label: 'Updated', width: 100 },
    { id: 'actions', label: '', width: 150, resizable: false, className: 'exp-actions-cell' },
  ];

  function jobActions(job, allowed) {
    const wrap = el('div', { className: 'exp-row-actions' });
    const busy = !!state.busy[job.id];
    if (!isTerminal(job.status) && job.status !== 'CANCELLING') {
      const btn = el('button', {
        className: 'qym-inline-action qym-inline-action--danger',
        type: 'button',
        'data-exp-job-cancel': job.id,
        disabled: !allowed || busy,
        title: allowed ? 'Cancel this job' : CONTROL_HINT,
        text: 'Cancel',
      });
      btn.addEventListener('click', (event) => { event.stopPropagation(); cancelJob(job); });
      wrap.appendChild(btn);
    }
    if (RETRYABLE.indexOf(job.status) >= 0 && !job.superseded) {
      const btn = el('button', {
        className: 'qym-inline-action qym-inline-action--neutral',
        type: 'button',
        'data-exp-job-retry': job.id,
        disabled: !allowed || busy,
        title: allowed ? 'Queue a new attempt of this job' : CONTROL_HINT,
        text: busy ? 'Retrying…' : 'Retry',
      });
      btn.addEventListener('click', (event) => { event.stopPropagation(); retryJob(job); });
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function renderJobsTable(host, jobs, allowed) {
    const renderRow = (job) => {
      const summary = paramsSummary(job.params);
      const statusCell = el('td', { title: job.error || job.wait_reason || '' }, [badge(job.status, JOB_TONES)]);
      if (job.error) statusCell.appendChild(el('div', { className: 'exp-sub exp-error-text', text: job.error }));
      else if (job.wait_reason && !isTerminal(job.status)) statusCell.appendChild(el('div', { className: 'exp-sub', text: job.wait_reason }));

      const runCell = el('td');
      if (job.run_id && !(job.run && job.run.deleted)) {
        runCell.appendChild(el('a', {
          className: 'exp-run-link',
          href: runUrl(job.run_id),
          title: job.run_name || job.run_id,
          text: job.run_name || job.run_id,
        }));
        if (job.run && job.run.status) runCell.appendChild(el('div', { className: 'exp-sub', text: 'Run ' + titleCase(job.run.status) }));
      } else {
        runCell.appendChild(el('span', { className: 'exp-muted', text: job.run_id ? 'Deleted' : '—' }));
        if (job.run_name) runCell.appendChild(el('div', { className: 'exp-sub', title: job.run_name, text: job.run_name }));
      }

      const envCell = el('td', { title: job.environment_name || job.environment_id, text: job.environment_name || job.environment_id });
      const attemptCell = el('td', { className: 'exp-num' }, [String(job.attempt || 1)]);
      if (job.superseded) attemptCell.appendChild(el('div', { className: 'exp-sub', text: 'retried' }));
      const updated = job.finished_at || job.updated_at || job.created_at;
      const actionsCell = el('td', { className: 'exp-actions-cell' }, [jobActions(job, allowed)]);
      return el('tr', {
        className: job.superseded ? 'exp-row--superseded' : null,
        'data-job-id': job.id,
      }, [
        el('td', { className: 'exp-num', text: '#' + job.combo_index }),
        envCell,
        el('td', { className: 'exp-mono', title: summary, text: summary || '—' }),
        statusCell,
        attemptCell,
        runCell,
        el('td', { className: 'exp-mono', title: absTime(updated), text: relTime(updated) }),
        actionsCell,
      ]);
    };
    if (window.QymDataTable && window.QymDataTable.render) {
      window.QymDataTable.render({ host: host, columns: JOB_COLUMNS, rows: jobs, storageKey: 'experiments.jobs.v1', minWidth: 1000, renderRow: renderRow });
      return;
    }
    host.appendChild(el('table', { className: 'qdt-table' }, [
      el('thead', null, el('tr', null, JOB_COLUMNS.map((c) => el('th', { text: c.label })))),
      el('tbody', null, jobs.map(renderRow)),
    ]));
  }

  // ── Actions ────────────────────────────────────────────────────────────
  function handleDenied(res, fallback) {
    if (res.status === 403) {
      state.denied = true;
      toast(errorMessage(res.data, CONTROL_HINT), 'error');
    } else {
      toast(errorMessage(res.data, fallback), 'error');
    }
    renderDetail();
  }

  function outcomeSummary(outcomes) {
    const tally = {};
    Object.keys(outcomes || {}).forEach((id) => {
      const outcome = outcomes[id];
      tally[outcome] = (tally[outcome] || 0) + 1;
    });
    const parts = [];
    if (tally.cancelled) parts.push(tally.cancelled + ' cancelled');
    if (tally.cancelling) parts.push(tally.cancelling + ' stopping on the service');
    if (tally.already_terminal) parts.push(tally.already_terminal + ' already finished');
    if (tally.forbidden) parts.push(tally.forbidden + ' not allowed');
    return parts.join(', ') || 'Nothing to cancel';
  }

  function cancelDescription(jobs) {
    const queued = jobs.filter((job) => QUEUED_HERE.indexOf(job.status) >= 0).length;
    const remote = jobs.length - queued;
    const lines = [];
    if (queued) lines.push(queued + ' queued job' + (queued === 1 ? '' : 's') + ' will be removed before reaching the Evaluation Service.');
    if (remote) lines.push(remote + ' submitted or running job' + (remote === 1 ? '' : 's') + ' will be hard-stopped; partial results stay on the linked run.');
    lines.push('Cancelled jobs can be retried later.');
    return lines;
  }

  async function cancelExperiment() {
    const x = state.detail;
    if (!x || state.busy.all) return;
    const live = (x.jobs || []).filter((job) => !job.superseded && !isTerminal(job.status) && job.status !== 'CANCELLING');
    const ok = await confirmDialog({
      title: 'Cancel experiment “' + (x.name || x.id) + '”?',
      description: cancelDescription(live),
      confirmLabel: 'Cancel experiment',
      cancelLabel: 'Keep running',
      confirmClass: 'shell-btn-danger',
    });
    if (!ok || !state.active) return;
    state.busy.all = true;
    renderDetail();
    const res = await postJson(experimentsPath('/' + encodeURIComponent(x.id) + '/cancel'), {});
    state.busy.all = false;
    if (!state.active) return;
    if (!res.ok) { handleDenied(res, 'Failed to cancel the experiment'); return; }
    toast(outcomeSummary(res.data.outcomes), 'success');
    if (res.data.experiment) applyDetail(res.data.experiment);
  }

  async function cancelJob(job) {
    const x = state.detail;
    if (!x || state.busy[job.id]) return;
    const ok = await confirmDialog({
      title: 'Cancel job #' + job.combo_index + ' on ' + (job.environment_name || 'this environment') + '?',
      description: cancelDescription([job]),
      confirmLabel: 'Cancel job',
      cancelLabel: 'Keep running',
      confirmClass: 'shell-btn-danger',
    });
    if (!ok || !state.active) return;
    state.busy[job.id] = true;
    renderDetail();
    const res = await postJson(experimentsPath('/' + encodeURIComponent(x.id) + '/jobs/' + encodeURIComponent(job.id) + '/cancel'), {});
    delete state.busy[job.id];
    if (!state.active) return;
    if (!res.ok) { handleDenied(res, 'Failed to cancel the job'); return; }
    toast(outcomeSummary({ [job.id]: res.data.outcome }), 'success');
    if (res.data.experiment) applyDetail(res.data.experiment);
  }

  async function retryJob(job) {
    const x = state.detail;
    if (!x || state.busy[job.id]) return;
    const path = experimentsPath('/' + encodeURIComponent(x.id) + '/jobs/' + encodeURIComponent(job.id) + '/retry');
    state.busy[job.id] = true;
    renderDetail();
    let res = await postJson(path, {});
    const detail = res.data && res.data.detail;
    if (!res.ok && res.status === 422 && detail && detail.code === PREEMPTION_ACK_REQUIRED) {
      // HIGH preempts other users' jobs (plan §5.3): the server's warning names the
      // environment; retry only after an explicit acknowledgement.
      const ok = state.active && await confirmDialog({
        title: 'Retry job #' + job.combo_index + ' at HIGH priority?',
        description: [errorMessage(res.data, '')],
        confirmLabel: 'Retry at HIGH',
        cancelLabel: 'Don’t retry',
        confirmClass: 'shell-btn-danger',
      });
      if (!ok) {
        delete state.busy[job.id];
        if (state.active) renderDetail();
        return;
      }
      res = await postJson(path, { acknowledge_preemption: true });
    }
    delete state.busy[job.id];
    if (!state.active) return;
    if (!res.ok) { handleDenied(res, 'Failed to retry the job'); return; }
    toast('Queued attempt ' + ((job.attempt || 1) + 1) + ' of job #' + job.combo_index, 'success');
    if (res.data.experiment) applyDetail(res.data.experiment);
  }

  async function retryAll() {
    const x = state.detail;
    if (!x || state.busy.retryAll) return;
    const jobs = (x.jobs || []).filter((job) => !job.superseded && RETRYABLE.indexOf(job.status) >= 0);
    if (!jobs.length) return;
    const ok = await confirmDialog({
      title: 'Retry ' + jobs.length + ' job' + (jobs.length === 1 ? '' : 's') + '?',
      description: ['Every failed, timed out, cancelled or blocked job gets a new attempt; earlier attempts stay in the job history.'],
      confirmLabel: 'Retry jobs',
      cancelLabel: 'Don’t retry',
    });
    if (!ok || !state.active) return;
    state.busy.retryAll = true;
    renderDetail();
    let acknowledged = false;
    let queued = 0;
    let failure = null;
    let latest = null;
    for (const job of jobs) {
      const path = experimentsPath('/' + encodeURIComponent(x.id) + '/jobs/' + encodeURIComponent(job.id) + '/retry');
      let res = await postJson(path, acknowledged ? { acknowledge_preemption: true } : {});
      const detail = res.data && res.data.detail;
      if (!res.ok && res.status === 422 && detail && detail.code === PREEMPTION_ACK_REQUIRED && !acknowledged) {
        // Same HIGH acknowledgement as a single retry (plan §5.3), asked once for the batch.
        acknowledged = state.active && await confirmDialog({
          title: 'Retry at HIGH priority?',
          description: [errorMessage(res.data, '')],
          confirmLabel: 'Retry at HIGH',
          cancelLabel: 'Don’t retry',
          confirmClass: 'shell-btn-danger',
        });
        if (!acknowledged) break;
        res = await postJson(path, { acknowledge_preemption: true });
      }
      if (!state.active) return;
      if (!res.ok) { failure = res; break; }
      queued += 1;
      if (res.data.experiment) latest = res.data.experiment;
    }
    state.busy.retryAll = false;
    if (!state.active) return;
    if (queued) toast('Queued ' + queued + ' new attempt' + (queued === 1 ? '' : 's'), 'success');
    if (latest) applyDetail(latest);
    if (failure) handleDenied(failure, 'Failed to retry every job');
    else if (!latest) renderDetail();
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  function teardown() {
    state.active = false;
    if (state.launch) state.launch.teardown();
    state.launch = null;
    clearPoll();
    document.removeEventListener('visibilitychange', onVisibility);
  }

  async function start() {
    if (window.QymShell && !window.__QYM_USER__) {
      await new Promise((resolve) => document.addEventListener('qym:shell-ready', resolve, { once: true }));
    }
    if (!state.active) return;
    await loadContext();
    if (!state.active) return;
    if (state.creating) { mountLaunchForm(); return; }
    await refresh();
  }

  document.addEventListener('qym:before-navigate', teardown, { once: true });
  document.addEventListener('visibilitychange', onVisibility);
  start().catch((err) => {
    if (!state.active) return;
    renderMessage('exp-error', (err && err.message) || 'Failed to load experiments');
  });
})();
