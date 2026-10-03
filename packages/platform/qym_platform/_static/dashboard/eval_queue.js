/*
 * Queue page (plan §12.2a, §13.1, §14.1; issue #25): /projects/{slug}/experiments/queue
 *
 *   ?environment=<id>   one environment (default: every active one)
 *   ?experiment=<id>    one experiment's jobs
 *   ?status=<STATUS>    one non-terminal status
 *   ?mine=1             jobs of my experiments
 *
 * Consumes the queue API (api/eval_queue.py):
 *   GET  /v1/projects/{pid}/eval-queue[?environment_id=&status=&mine=&experiment_id=&limit=]
 *   GET  /v1/projects/{pid}/eval-queue/remote[?environment_id=]
 *   POST /v1/projects/{pid}/eval-queue/cancel         {job_ids, reason?} | {experiment_id, statuses, reason?}
 *   POST /v1/projects/{pid}/eval-queue/remote/cancel  {environment_id, remote_job_ids, reason?}  (manager)
 * and the environments list (names for the environment selector).
 *
 * Every cancel asks first, in a dialog that splits the selection into jobs still
 * queued here (removed at once), jobs on the service (hard-stopped) and jobs the
 * user may not cancel (skipped), with an optional reason (stored as cancel_reason).
 *
 * Security: every node is built with el()/textContent, so no server string
 * (names, emails, errors, params, remote ids) is ever parsed as HTML; there is no innerHTML.
 *
 * The shell re-executes this script on every client-side navigation, so each
 * run mounts fresh and tears its timers and dialog down on qym:before-navigate.
 */
(function () {
  'use strict';

  const QUEUE_STATUSES = ['QUEUED', 'SUBMITTING', 'SUBMITTED', 'RUNNING', 'BLOCKED', 'CANCELLING'];
  // Not sent to the service yet: cancelling removes them locally (plan §13.1 step 2).
  const QUEUED_HERE = ['QUEUED', 'BLOCKED'];
  const JOB_LIMIT = 500;
  const POLL_MIN_MS = 5000;
  const POLL_MAX_MS = 60000;
  const JOB_TONES = {
    QUEUED: 'neutral', SUBMITTING: 'info', SUBMITTED: 'info', RUNNING: 'info',
    BLOCKED: 'warning', CANCELLING: 'warning',
    SUCCEEDED: 'success', FAILED: 'danger', TIMED_OUT: 'danger', CANCELLED: 'warning',
  };
  const REMOTE_TONES = { PENDING: 'neutral', RUNNING: 'info' };
  const PRIORITY_TAGS = { HIGH: 'warning', NORMAL: null, LOW: null };
  const CONTROL_HINT = "Only the experiment's creator or a project manager can cancel this job";

  const root = document.getElementById('exq-root');
  if (!root) return;

  const state = {
    active: true,
    slug: '',
    project: null,
    me: null,
    environments: [],        // [{id, name, is_active}] for the selector
    experimentNames: {},     // id → name, collected from every response
    filters: { environment: '', experiment: '', status: '', mine: false },
    data: null,              // GET /eval-queue
    remote: null,            // GET /eval-queue/remote
    remoteOpen: false,
    selected: new Set(),
    remoteSelected: {},      // environment_id → Set(remote_job_id)
    busy: false,
    lastFetched: null,
    // polling
    pollTimer: null,
    pollDelay: POLL_MIN_MS,
    lastFingerprint: '',
    generation: 0,
    dialog: null,
    regions: null,
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

  function queueUrl() {
    return projectPage('/experiments/queue');
  }

  function runUrl(runId) {
    return projectPage('/runs/' + encodeURIComponent(runId));
  }

  function queuePath(suffix) {
    return 'v1/projects/' + encodeURIComponent(state.project.id) + '/eval-queue' + (suffix || '');
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

  function parseTime(value) {
    if (!value) return null;
    const stamp = new Date(value);
    return Number.isNaN(stamp.getTime()) ? null : stamp;
  }

  function duration(seconds) {
    seconds = Math.max(0, Math.floor(seconds));
    if (seconds < 60) return seconds + 's';
    if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
    if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ' + Math.floor((seconds % 3600) / 60) + 'm';
    return Math.floor(seconds / 86400) + 'd ' + Math.floor((seconds % 86400) / 3600) + 'h';
  }

  function relTime(value) {
    const stamp = parseTime(value);
    if (!stamp) return '—';
    const seconds = Math.max(0, Math.floor((Date.now() - stamp.getTime()) / 1000));
    if (seconds < 10) return 'just now';
    return duration(seconds) + ' ago';
  }

  function absTime(value) {
    const stamp = parseTime(value);
    return stamp ? stamp.toLocaleString() : '';
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

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function paramsSummary(params) {
    if (!params || typeof params !== 'object') return '';
    return Object.keys(params).map((key) => {
      const value = params[key];
      const text = value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value);
      return key + '=' + text;
    }).join(', ');
  }

  function jobLabel(job) {
    return (job.experiment_name || 'Experiment') + ' #' + job.combo_index + ' on ' + (job.environment_name || 'an environment');
  }

  // Remote jobs a manager may cancel directly on the service: orphans (no local job)
  // and stale jobs (the local job is finished but the service still runs it).
  function isRemoteCancellable(item) {
    return !!(item && (item.orphan || item.stale));
  }

  function isCancellable(job) {
    return !!job.can_cancel && job.status !== 'CANCELLING';
  }

  // ── Split confirmation dialog (plan §12.2a) ────────────────────────────
  // Built on the shell modal recipe with DOM nodes only, because it needs an
  // optional reason field that QymShell.openConfirmDialog does not offer.
  function closeDialog(result) {
    const dialog = state.dialog;
    if (!dialog) return;
    state.dialog = null;
    document.removeEventListener('keydown', dialog.onKey, true);
    dialog.node.remove();
    dialog.resolve(result || { confirmed: false, reason: '' });
  }

  function confirmCancel(options) {
    closeDialog();
    return new Promise((resolve) => {
      const reason = el('textarea', {
        className: 'shell-form-input exq-reason-input',
        id: 'exq-cancel-reason',
        maxlength: '1000',
        placeholder: 'Why are you cancelling? (optional)',
        'data-exq-reason': '1',
      });
      const sections = (options.sections || []).filter((s) => s && s.count);
      const body = el('div', { className: 'shell-modal-body' });
      (options.description || []).forEach((line) => body.appendChild(el('p', { className: 'shell-modal-description', text: line })));
      sections.forEach((section) => {
        const names = (section.items || []).slice(0, 5);
        const more = (section.items || []).length - names.length;
        body.appendChild(el('div', { className: 'exq-split' + (section.skip ? ' exq-split--skip' : ''), 'data-exq-split': section.key }, [
          el('p', { className: 'exq-split-title', text: section.title + ' · ' + section.count }),
          el('p', { className: 'exq-split-body', text: section.body }),
          names.length ? el('ul', { className: 'exq-split-list' },
            names.map((name) => el('li', { text: name })).concat(more > 0 ? [el('li', { text: '… and ' + more + ' more' })] : [])) : null,
        ]));
      });
      const actionable = options.actionable;
      if (actionable) {
        body.appendChild(el('div', { className: 'shell-form-group exq-reason' }, [
          el('label', { className: 'shell-form-label', for: 'exq-cancel-reason', text: 'Reason (optional)' }),
          reason,
        ]));
      }
      const keep = el('button', { className: 'shell-btn shell-btn-secondary', type: 'button', text: options.cancelLabel || 'Keep jobs' });
      const confirm = el('button', {
        className: 'shell-btn shell-btn-danger',
        type: 'button',
        'data-exq-confirm': '1',
        disabled: !actionable,
        text: options.confirmLabel || 'Cancel jobs',
      });
      const close = el('button', { className: 'shell-modal-close qym-icon-action', type: 'button', 'aria-label': 'Close', text: '×' });
      const node = el('div', { className: 'shell-modal-backdrop', 'data-exq-dialog': '1' }, [
        el('div', { className: 'shell-modal', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'exq-dialog-title' }, [
          el('div', { className: 'shell-modal-header' }, [
            el('div', { className: 'shell-modal-title', id: 'exq-dialog-title', text: options.title }),
            close,
          ]),
          body,
          el('div', { className: 'shell-modal-footer' }, [keep, confirm]),
        ]),
      ]);
      const onKey = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          closeDialog();
        }
      };
      state.dialog = { node, resolve, onKey };
      keep.addEventListener('click', () => closeDialog());
      close.addEventListener('click', () => closeDialog());
      node.addEventListener('click', (event) => { if (event.target === node) closeDialog(); });
      confirm.addEventListener('click', () => closeDialog({ confirmed: true, reason: reason.value.trim() }));
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(node);
      keep.focus();
    });
  }

  // Splits jobs into the three groups the dialog shows (plan §12.2a).
  function splitJobs(jobs) {
    const here = []; const remote = []; const skipped = [];
    jobs.forEach((job) => {
      if (!isCancellable(job)) skipped.push(job);
      else if (QUEUED_HERE.indexOf(job.status) >= 0) here.push(job);
      else remote.push(job);
    });
    return { here, remote, skipped };
  }

  function splitSections(split) {
    return [
      {
        key: 'here',
        title: 'Queued here (not yet sent)',
        count: split.here.length,
        body: 'Removed immediately; nothing reaches the Evaluation Service.',
        items: split.here.map(jobLabel),
      },
      {
        key: 'remote',
        title: 'Submitted or running on the service',
        count: split.remote.length,
        body: 'Will be hard-stopped; partial results stay on the linked run.',
        items: split.remote.map(jobLabel),
      },
      {
        key: 'skipped',
        title: 'Not allowed (skipped)',
        count: split.skipped.length,
        skip: true,
        body: CONTROL_HINT + ', and jobs already stopping are left alone.',
        items: split.skipped.map(jobLabel),
      },
    ];
  }

  function outcomeSummary(counts) {
    counts = counts || {};
    const parts = [];
    if (counts.cancelled) parts.push(counts.cancelled + ' cancelled');
    if (counts.cancelling) parts.push(counts.cancelling + ' stopping on the service');
    if (counts.already_terminal) parts.push(counts.already_terminal + ' already finished');
    if (counts.forbidden) parts.push(counts.forbidden + ' not allowed');
    if (counts.not_found) parts.push(counts.not_found + ' not found');
    return parts.join(', ') || 'Nothing to cancel';
  }

  // ── Cancel actions ─────────────────────────────────────────────────────
  async function cancelJobs(jobs, title) {
    if (state.busy || !jobs.length) return;
    const split = splitJobs(jobs);
    const actionable = split.here.length + split.remote.length;
    const result = await confirmCancel({
      title: title || ('Cancel ' + plural(actionable, 'job') + '?'),
      description: ['Cancelled jobs can be retried later from the experiment.'],
      sections: splitSections(split),
      actionable: actionable,
      confirmLabel: 'Cancel ' + plural(actionable, 'job'),
    });
    if (!result.confirmed || !state.active) return;
    const ids = split.here.concat(split.remote).map((job) => job.id);
    await sendCancel({ job_ids: ids }, result.reason);
  }

  async function cancelQueuedInExperiment() {
    const experimentId = state.filters.experiment;
    if (state.busy || !experimentId) return;
    // The loaded page may be filtered by status or truncated: ask for the exact set.
    const query = new URLSearchParams({ experiment_id: experimentId, limit: '1000' });
    QUEUED_HERE.forEach((s) => query.append('status', s));
    const res = await request(queuePath('?' + query.toString()));
    if (!state.active) return;
    if (!res.ok) { toast(errorMessage(res.data, 'Failed to load the experiment’s queued jobs'), 'error'); return; }
    const jobs = res.data.jobs || [];
    const split = splitJobs(jobs);
    const actionable = split.here.length;
    const name = state.experimentNames[experimentId] || 'this experiment';
    const result = await confirmCancel({
      title: 'Cancel all queued jobs in “' + name + '”?',
      description: actionable ? [] : ['This experiment has no queued jobs you can cancel.'],
      sections: splitSections(split),
      actionable: actionable,
      confirmLabel: 'Cancel ' + plural(actionable, 'queued job'),
    });
    if (!result.confirmed || !state.active) return;
    await sendCancel({ experiment_id: experimentId, statuses: QUEUED_HERE.slice() }, result.reason);
  }

  async function sendCancel(body, reason) {
    if (reason) body.reason = reason;
    state.busy = true;
    renderJobs();
    const res = await postJson(queuePath('/cancel'), body);
    state.busy = false;
    if (!state.active) return;
    if (!res.ok) {
      toast(errorMessage(res.data, res.status === 403 ? CONTROL_HINT : 'Failed to cancel'), 'error');
    } else {
      toast(outcomeSummary(res.data.counts), 'success');
      state.selected.clear();
    }
    await refresh({ silent: false, force: true });
  }

  async function cancelOrphans(envView, remoteIds) {
    if (state.busy || !remoteIds.length || !(state.remote && state.remote.can_cancel_orphans)) return;
    const byId = {};
    (envView.items || []).forEach((item) => { byId[item.remote_job_id] = item; });
    const staleIds = remoteIds.filter((rid) => byId[rid] && byId[rid].stale);
    const orphanIds = remoteIds.filter((rid) => staleIds.indexOf(rid) < 0);
    const sections = [];
    if (orphanIds.length) {
      sections.push({
        key: 'orphans',
        title: 'Orphans on the service',
        count: orphanIds.length,
        body: 'Match no job of this project. Will be hard-stopped on the service.',
        items: orphanIds,
      });
    }
    if (staleIds.length) {
      sections.push({
        key: 'stale',
        title: 'Stale jobs on the service',
        count: staleIds.length,
        body: 'Their qym job already finished, but the service still runs them. Will be hard-stopped on the service.',
        items: staleIds.map((rid) => {
          const match = byId[rid].match || {};
          return rid + ' (' + (match.experiment_name || 'experiment') + ', ' + titleCase(match.status) + ')';
        }),
      });
    }
    const noun = staleIds.length ? 'remote job' : 'orphan job';
    const result = await confirmCancel({
      title: 'Cancel ' + plural(remoteIds.length, noun) + ' on ' + (envView.environment_name || 'this environment') + '?',
      description: ['These jobs are cancelled directly on the Evaluation Service. The call is audit-logged.'],
      sections: sections,
      actionable: remoteIds.length,
      confirmLabel: 'Cancel ' + plural(remoteIds.length, staleIds.length ? 'remote job' : 'orphan'),
    });
    if (!result.confirmed || !state.active) return;
    const body = { environment_id: envView.environment_id, remote_job_ids: remoteIds };
    if (result.reason) body.reason = result.reason;
    state.busy = true;
    renderRemote();
    const res = await postJson(queuePath('/remote/cancel'), body);
    state.busy = false;
    if (!state.active) return;
    if (!res.ok) {
      toast(errorMessage(res.data, 'Failed to cancel the remote jobs'), 'error');
    } else {
      const counts = res.data.counts || {};
      const parts = Object.keys(counts).map((k) => counts[k] + ' ' + titleCase(k).toLowerCase());
      toast(parts.join(', ') || 'Nothing to cancel', counts.error ? 'error' : 'success');
      delete state.remoteSelected[envView.environment_id];
    }
    await refresh({ silent: false, force: true });
  }

  // ── Polling (backoff; pauses while the tab is hidden) ──────────────────
  function clearPoll() {
    if (state.pollTimer) clearTimeout(state.pollTimer);
    state.pollTimer = null;
  }

  function schedulePoll(changed) {
    clearPoll();
    if (!state.active) return;
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
    } else {
      state.pollDelay = POLL_MIN_MS;
      refresh({ silent: true });
    }
  }

  function fingerprint(payload) {
    try { return JSON.stringify(payload); } catch (_) { return String(Date.now()); }
  }

  // ── Loading ────────────────────────────────────────────────────────────
  function readFilters() {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('status') || '';
    state.filters = {
      environment: params.get('environment') || '',
      experiment: params.get('experiment') || '',
      status: QUEUE_STATUSES.indexOf(status) >= 0 ? status : '',
      mine: params.get('mine') === '1',
    };
  }

  function syncUrl() {
    const params = new URLSearchParams();
    if (state.filters.environment) params.set('environment', state.filters.environment);
    if (state.filters.experiment) params.set('experiment', state.filters.experiment);
    if (state.filters.status) params.set('status', state.filters.status);
    if (state.filters.mine) params.set('mine', '1');
    const query = params.toString();
    history.replaceState(history.state, '', queueUrl() + (query ? '?' + query : ''));
  }

  async function loadContext() {
    const ctx = window.QymShell && window.QymShell.getPageContext ? window.QymShell.getPageContext() : null;
    const match = window.location.pathname.match(/\/projects\/([^/]+)\/experiments\/queue\/?$/);
    state.slug = (ctx && ctx.projectSlug) || (match ? decodeURIComponent(match[1]) : '');
    readFilters();

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
      state.environments = (envs.data.environments || []).map((env) => ({ id: env.id, name: env.name, is_active: env.is_active }));
    }
    if (state.filters.experiment) {
      const x = await request('v1/projects/' + encodeURIComponent(state.project.id) + '/experiments/' + encodeURIComponent(state.filters.experiment));
      if (x.ok && x.data && x.data.name) state.experimentNames[state.filters.experiment] = x.data.name;
    }
  }

  function queueQuery() {
    const query = new URLSearchParams({ limit: String(JOB_LIMIT) });
    if (state.filters.environment) query.set('environment_id', state.filters.environment);
    if (state.filters.experiment) query.set('experiment_id', state.filters.experiment);
    if (state.filters.status) query.set('status', state.filters.status);
    if (state.filters.mine) query.set('mine', 'true');
    return '?' + query.toString();
  }

  async function refresh(opts) {
    opts = opts || {};
    const generation = ++state.generation;
    const remoteQuery = state.filters.environment ? '?environment_id=' + encodeURIComponent(state.filters.environment) : '';
    const [res, remote] = await Promise.all([
      request(queuePath(queueQuery())),
      state.remoteOpen ? request(queuePath('/remote' + remoteQuery)) : Promise.resolve(null),
    ]);
    if (!state.active || generation !== state.generation) return;
    if (!res.ok) {
      if (opts.silent) { schedulePoll(false); return; }
      showError(res.status === 404 ? 'That environment or experiment no longer exists in this project.' : errorMessage(res.data, 'Failed to load the queue'));
      schedulePoll(false);
      return;
    }
    state.lastFetched = Date.now();
    (res.data.jobs || []).forEach((job) => { state.experimentNames[job.experiment_id] = job.experiment_name; });
    const print = fingerprint([res.data, remote && remote.ok ? remote.data : null]);
    const changed = print !== state.lastFingerprint;
    state.lastFingerprint = print;
    state.data = res.data;
    if (remote) state.remote = remote.ok ? remote.data : { error: errorMessage(remote.data, 'Failed to load the remote queue') };
    pruneSelection();
    if (changed || opts.force || !opts.silent) renderAll();
    else renderMeta(); // keeps "refreshed …" and ages honest without rebuilding tables
    schedulePoll(changed);
  }

  function pruneSelection() {
    const cancellable = new Set((state.data.jobs || []).filter(isCancellable).map((job) => job.id));
    Array.from(state.selected).forEach((id) => { if (!cancellable.has(id)) state.selected.delete(id); });
    const views = (state.remote && state.remote.environments) || [];
    Object.keys(state.remoteSelected).forEach((envId) => {
      const view = views.find((v) => v.environment_id === envId);
      const cancellable = new Set(((view && view.items) || []).filter(isRemoteCancellable).map((i) => i.remote_job_id));
      Array.from(state.remoteSelected[envId]).forEach((rid) => { if (!cancellable.has(rid)) state.remoteSelected[envId].delete(rid); });
    });
  }

  // ── Rendering ──────────────────────────────────────────────────────────
  function showError(text) {
    if (state.regions) {
      state.regions.jobs.replaceChildren(el('div', { className: 'exq-error', text: text }));
    } else {
      root.replaceChildren(el('div', { className: 'exq-error', text: text }));
    }
  }

  function setBreadcrumbs() {
    if (!window.QymShell || !window.QymShell.setBreadcrumbs) return;
    const project = window.QymShell.getProject ? window.QymShell.getProject() : null;
    const crumbs = [];
    if (project) crumbs.push({ label: project.name, projectSwitcher: true });
    crumbs.push({ label: 'Experiments', href: experimentUrl(null) });
    crumbs.push({ label: 'Queue', current: true });
    try { window.QymShell.setBreadcrumbs(crumbs); } catch (_) { /* shell owns the fallback */ }
  }

  function tabs() {
    return el('nav', { className: 'qym-tabs exq-tabs', role: 'tablist', 'aria-label': 'Experiments sections', 'data-exq-tabs': '1' }, [
      el('a', { className: 'qym-tabs__tab exq-tab', role: 'tab', 'aria-selected': 'false', href: experimentUrl(null), text: 'Experiments' }),
      el('a', { className: 'qym-tabs__tab exq-tab active', role: 'tab', 'aria-selected': 'true', 'aria-current': 'page', href: queueUrl(), text: 'Queue' }),
    ]);
  }

  function mountSkeleton() {
    setBreadcrumbs();
    const meta = el('div', { className: 'exq-meta', 'data-exq-meta': '1' });
    const header = el('div', { className: 'exq-header' }, [
      el('div', { className: 'exq-header-text' }, [
        el('h1', { className: 'exq-title', text: 'Queue' }),
        el('p', { className: 'exq-description', text: 'Jobs waiting for or running on this project’s Evaluation Service environments, in dispatch order.' }),
        meta,
      ]),
    ]);

    const envSelect = el('select', { className: 'qym-control qym-select', 'aria-label': 'Environment', 'data-exq-env': '1' },
      [el('option', { value: '', text: 'All environments' })].concat(state.environments.map((env) =>
        el('option', { value: env.id, selected: env.id === state.filters.environment, text: env.name + (env.is_active === false ? ' (disabled)' : '') }))));
    envSelect.addEventListener('change', () => { state.filters.environment = envSelect.value; onFiltersChanged(); });

    const statusSelect = el('select', { className: 'qym-control qym-select', 'aria-label': 'Status', 'data-exq-status': '1' },
      [el('option', { value: '', text: 'All statuses' })].concat(QUEUE_STATUSES.map((s) =>
        el('option', { value: s, selected: s === state.filters.status, text: titleCase(s) }))));
    statusSelect.addEventListener('change', () => { state.filters.status = statusSelect.value; onFiltersChanged(); });

    const experimentSelect = el('select', { className: 'qym-control qym-select', 'aria-label': 'Experiment', 'data-exq-experiment': '1' });
    experimentSelect.addEventListener('change', () => { state.filters.experiment = experimentSelect.value; onFiltersChanged(); });

    const mineBox = el('input', { type: 'checkbox', 'data-exq-mine': '1', checked: state.filters.mine });
    mineBox.addEventListener('change', () => { state.filters.mine = mineBox.checked; onFiltersChanged(); });

    const toolbar = el('div', { className: 'exq-toolbar' }, [
      el('span', { className: 'exq-toolbar-label', text: 'Environment' }), envSelect,
      el('span', { className: 'exq-toolbar-label', text: 'Status' }), statusSelect,
      el('span', { className: 'exq-toolbar-label', text: 'Experiment' }), experimentSelect,
      el('label', { className: 'exq-check' }, [mineBox, 'Only my jobs']),
      el('span', { className: 'exq-toolbar-spacer' }),
      el('span', { className: 'exq-poll-note', text: 'Refreshes automatically; paused while this tab is hidden' }),
    ]);

    const envs = el('div', { className: 'exq-envs', 'data-exq-envs': '1' });
    const jobs = el('section', { className: 'exq-card', 'data-exq-jobs': '1' });
    const remote = el('section', { className: 'exq-card', 'data-exq-remote': '1' });
    state.regions = { meta, envs, jobs, remote, experimentSelect };
    root.replaceChildren(header, tabs(), toolbar, envs, jobs, remote);
  }

  function onFiltersChanged() {
    state.selected.clear();
    state.lastFingerprint = '';
    state.pollDelay = POLL_MIN_MS;
    syncUrl();
    state.regions.jobs.replaceChildren(el('div', { className: 'exq-loading', text: 'Loading…' }));
    refresh();
  }

  function renderAll() {
    renderMeta();
    renderExperimentOptions();
    renderEnvironments();
    renderJobs();
    renderRemote();
  }

  function renderMeta() {
    const regions = state.regions;
    if (!regions || !state.data) return;
    const data = state.data;
    const parts = [
      plural(data.total || 0, 'job'),
      state.lastFetched ? 'refreshed ' + relTime(new Date(state.lastFetched).toISOString()) : null,
    ].filter(Boolean);
    regions.meta.replaceChildren();
    parts.forEach((part, i) => {
      if (i) regions.meta.appendChild(el('span', { className: 'exq-meta-sep', 'aria-hidden': 'true', text: '·' }));
      regions.meta.appendChild(el('span', { text: part }));
    });
  }

  function renderExperimentOptions() {
    const select = state.regions.experimentSelect;
    const ids = Object.keys(state.experimentNames);
    if (state.filters.experiment && ids.indexOf(state.filters.experiment) < 0) ids.push(state.filters.experiment);
    ids.sort((a, b) => String(state.experimentNames[a] || a).localeCompare(String(state.experimentNames[b] || b)));
    const signature = ids.join('|') + '#' + state.filters.experiment;
    if (select.getAttribute('data-signature') === signature) return;
    select.setAttribute('data-signature', signature);
    select.replaceChildren.apply(select, [el('option', { value: '', text: 'All experiments' })].concat(ids.map((id) =>
      el('option', { value: id, selected: id === state.filters.experiment, text: state.experimentNames[id] || 'Selected experiment' }))));
  }

  function renderEnvironments() {
    const host = state.regions.envs;
    const envs = (state.data && state.data.environments) || [];
    if (!envs.length) {
      host.replaceChildren();
      return;
    }
    host.replaceChildren.apply(host, envs.map((env) => {
      const staleRemote = env.stale_remote || 0;
      const health = env.health_status === 'ok'
        ? el('span', { className: 'qym-badge qym-badge--success', text: 'Healthy' })
        : env.health_status === 'error'
          ? el('span', { className: 'qym-badge qym-badge--danger', text: 'Unhealthy' })
          : el('span', { className: 'qym-badge qym-badge--neutral', text: 'Health unknown' });
      const stat = (label, value, extra) => el('div', { className: 'exq-env-stat' }, [
        el('span', { className: 'exq-env-label', text: label }),
        el('span', { className: 'exq-env-value' + (extra || ''), text: value }),
      ]);
      return el('article', { className: 'exq-env', 'data-exq-env-id': env.id }, [
        el('div', { className: 'exq-env-top' }, [
          el('h2', { className: 'exq-env-name', title: env.name, text: env.name }),
          el('span', { className: 'exq-env-badges' }, [env.is_active ? null : tag('Disabled', 'warning'), health]),
        ]),
        el('div', { className: 'exq-env-stats' }, [
          stat('In flight', String(env.inflight || 0)),
          stat('Queued', String(env.queued || 0)),
          stat('Blocked', String(env.blocked || 0)),
        ]),
        env.health_status === 'error'
          ? el('p', { className: 'exq-env-note exq-env-note--error', text: 'Dispatch is paused until the health check passes' + (env.health_error ? ': ' + env.health_error : '.') })
          : null,
        staleRemote
          ? el('p', { className: 'exq-env-note', 'data-exq-stale-remote': String(staleRemote), text: plural(staleRemote, 'stale job') + ' still running on the service although qym finished them. A manager can cancel them in the remote queue.' })
          : null,
        env.high_active
          ? el('div', { className: 'exq-high', role: 'status', 'data-exq-high': '1', text: 'A HIGH-priority job is active on ' + env.name + '. Other jobs wait until it finishes.' })
          : null,
      ]);
    }));
  }

  const JOB_COLUMNS = [
    { id: 'select', label: '', width: 40, resizable: false, className: 'exq-select-cell' },
    { id: 'position', label: '#', width: 50, className: 'exq-num' },
    { id: 'experiment', label: 'Experiment', width: 220, flex: 2 },
    { id: 'environment', label: 'Environment', width: 130 },
    { id: 'priority', label: 'Priority', width: 90 },
    { id: 'status', label: 'Status', width: 200, flex: 1 },
    { id: 'creator', label: 'Created by', width: 160 },
    { id: 'age', label: 'Age', width: 90 },
    { id: 'elapsed', label: 'Elapsed', width: 90, className: 'exq-num' },
    { id: 'run', label: 'Run progress', width: 190 },
    { id: 'actions', label: '', width: 90, resizable: false, className: 'exq-actions-cell' },
  ];

  function elapsedText(job) {
    const start = parseTime((job.run && job.run.started_at) || job.submitted_at);
    if (!start || QUEUED_HERE.indexOf(job.status) >= 0) return '—';
    return duration((Date.now() - start.getTime()) / 1000);
  }

  function progressNode(job) {
    const run = job.run;
    if (!run || run.deleted) {
      return el('span', { className: 'exq-muted', text: run && run.deleted ? 'Run deleted' : '—' });
    }
    const done = Number(run.items_done) || 0;
    const total = typeof run.items_total === 'number' && run.items_total > 0 ? run.items_total : null;
    const pct = total ? Math.max(0, Math.min(100, Math.round((done / total) * 100))) : null;
    const fill = el('div', { className: 'exq-progress-fill' + (pct === null ? ' exq-progress-fill--unknown' : '') });
    if (pct !== null) fill.style.width = pct + '%';
    const track = el('div', {
      className: 'exq-progress-track',
      role: 'progressbar',
      'aria-label': 'Items done',
      'aria-valuemin': '0',
      'aria-valuemax': total === null ? null : String(total),
      'aria-valuenow': total === null ? null : String(done),
    }, [fill]);
    return el('div', { className: 'exq-progress', 'data-exq-progress': job.id }, [
      track,
      el('div', { className: 'exq-progress-line' }, [
        el('a', { className: 'exq-run-link', href: runUrl(run.id), title: job.run_name || run.id, text: job.run_name || run.id }),
        el('span', { className: 'exq-mono', text: total === null ? done + ' items' : done + '/' + total }),
      ]),
    ]);
  }

  function rowActions(job) {
    if (job.status === 'CANCELLING') return el('span', { className: 'exq-muted', text: 'Stopping…' });
    const allowed = isCancellable(job);
    const btn = el('button', {
      className: 'qym-inline-action qym-inline-action--danger',
      type: 'button',
      'data-exq-cancel': job.id,
      disabled: !allowed || state.busy,
      title: allowed ? 'Cancel this job' : CONTROL_HINT,
      text: 'Cancel',
    });
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      cancelJobs([job], 'Cancel ' + jobLabel(job) + '?');
    });
    return btn;
  }

  function renderJobRow(job) {
    const allowed = isCancellable(job);
    const box = el('input', {
      type: 'checkbox',
      'aria-label': 'Select ' + jobLabel(job),
      'data-exq-select': job.id,
      checked: state.selected.has(job.id),
      disabled: !allowed || state.busy,
      title: allowed ? null : CONTROL_HINT,
    });
    box.addEventListener('change', () => {
      if (box.checked) state.selected.add(job.id); else state.selected.delete(job.id);
      renderBulkBar();
    });

    const summary = paramsSummary(job.params);
    const experimentCell = el('td', { title: job.experiment_name || '' }, [
      el('a', { className: 'exq-link', href: experimentUrl(job.experiment_id), text: (job.experiment_name || job.experiment_id) + ' #' + job.combo_index }),
      summary ? el('div', { className: 'exq-sub exq-sub-mono', title: summary, text: summary }) : null,
    ]);

    const statusCell = el('td', { title: job.error || job.wait_reason || '' }, [badge(job.status, JOB_TONES)]);
    if (job.attempt > 1) statusCell.appendChild(document.createTextNode(' '));
    if (job.attempt > 1) statusCell.appendChild(tag('attempt ' + job.attempt, 'count'));
    if (job.wait_reason) statusCell.appendChild(el('div', { className: 'exq-sub', text: job.wait_reason }));
    else if (job.error) statusCell.appendChild(el('div', { className: 'exq-sub exq-error-text', text: job.error }));

    const priority = job.priority || 'NORMAL';
    return el('tr', { 'data-job-id': job.id }, [
      el('td', { className: 'exq-select-cell' }, [box]),
      el('td', { className: 'exq-num', text: job.queue_position == null ? '—' : String(job.queue_position) }),
      experimentCell,
      el('td', { title: job.environment_name || job.environment_id, text: job.environment_name || job.environment_id }),
      el('td', null, [tag(titleCase(priority), PRIORITY_TAGS[priority] || null)]),
      statusCell,
      el('td', { title: job.created_by_email || '', text: job.created_by_email || '—' }),
      el('td', { className: 'exq-mono', title: absTime(job.created_at), text: relTime(job.created_at) }),
      el('td', { className: 'exq-num', text: elapsedText(job) }),
      el('td', null, [progressNode(job)]),
      el('td', { className: 'exq-actions-cell' }, [rowActions(job)]),
    ]);
  }

  function renderBulkBar() {
    const host = state.regions && state.regions.jobs.querySelector('[data-exq-bulk]');
    if (!host) return;
    const jobs = (state.data && state.data.jobs) || [];
    const cancellable = jobs.filter(isCancellable);
    const selected = jobs.filter((job) => state.selected.has(job.id));

    const all = el('input', {
      type: 'checkbox',
      'data-exq-select-all': '1',
      checked: cancellable.length > 0 && selected.length === cancellable.length,
      disabled: !cancellable.length || state.busy,
    });
    all.addEventListener('change', () => {
      state.selected.clear();
      if (all.checked) cancellable.forEach((job) => state.selected.add(job.id));
      renderJobs();
    });

    const bulk = el('button', {
      className: 'qym-inline-action qym-inline-action--danger',
      type: 'button',
      'data-exq-bulk-cancel': '1',
      disabled: !selected.length || state.busy,
      text: state.busy ? 'Cancelling…' : 'Cancel selected (' + selected.length + ')',
    });
    bulk.addEventListener('click', () => cancelJobs(selected));

    const children = [
      el('label', { className: 'exq-check' }, [all, 'Select all I can cancel']),
      bulk,
    ];
    if (state.filters.experiment) {
      const queuedAll = el('button', {
        className: 'qym-inline-action qym-inline-action--danger',
        type: 'button',
        'data-exq-cancel-experiment': '1',
        disabled: state.busy,
        title: 'Cancel every job of this experiment that has not reached the service yet',
        text: 'Cancel all queued in experiment',
      });
      queuedAll.addEventListener('click', () => cancelQueuedInExperiment());
      children.push(queuedAll);
    }
    host.replaceChildren.apply(host, children);
  }

  function renderJobs() {
    const host = state.regions && state.regions.jobs;
    if (!host || !state.data) return;
    const data = state.data;
    const jobs = data.jobs || [];
    const header = el('div', { className: 'exq-card-header' }, [
      el('div', null, [
        el('h2', { className: 'exq-section-title', text: 'Our jobs' }),
        el('p', { className: 'exq-section-description', text: 'Every unfinished job of this project, in the order the dispatcher claims them.' }),
      ]),
      el('div', { className: 'exq-card-actions', 'data-exq-bulk': '1' }),
    ]);
    const filtered = state.filters.environment || state.filters.experiment || state.filters.status || state.filters.mine;
    if (!jobs.length) {
      host.replaceChildren(header, el('div', { className: 'exq-empty' }, [
        el('h3', { className: 'exq-empty-title', text: filtered ? 'No matching jobs' : 'The queue is empty' }),
        el('p', { className: 'exq-empty-body', text: filtered
          ? 'No unfinished job matches these filters.'
          : 'Jobs appear here while they wait for or run on an environment. Launch an experiment to add some.' }),
      ]));
      renderBulkBar();
      return;
    }
    const tableHost = el('div', { className: 'exq-table-wrap' });
    const children = [header, tableHost];
    if ((data.total || 0) > jobs.length) {
      children.push(el('div', { className: 'exq-footer-note', text: 'Showing the first ' + jobs.length + ' of ' + data.total + ' jobs. Narrow the filters to see the rest.' }));
    }
    host.replaceChildren.apply(host, children);
    if (window.QymDataTable && window.QymDataTable.render) {
      window.QymDataTable.render({ host: tableHost, columns: JOB_COLUMNS, rows: jobs, storageKey: 'eval-queue.jobs.v1', minWidth: 1240, renderRow: renderJobRow });
    } else {
      tableHost.appendChild(el('table', { className: 'qdt-table' }, [
        el('thead', null, el('tr', null, JOB_COLUMNS.map((c) => el('th', { text: c.label })))),
        el('tbody', null, jobs.map(renderJobRow)),
      ]));
    }
    renderBulkBar();
  }

  // ── Remote queue (collapsible; orphans; manager cancel) ────────────────
  function toggleRemote() {
    state.remoteOpen = !state.remoteOpen;
    renderRemote();
    if (state.remoteOpen) refresh({ force: true });
  }

  const REMOTE_COLUMNS = [
    { id: 'select', label: '', width: 40, resizable: false, className: 'exq-select-cell' },
    { id: 'remote', label: 'Remote job', width: 200, flex: 1 },
    { id: 'status', label: 'Status', width: 110 },
    { id: 'priority', label: 'Priority', width: 90 },
    { id: 'owner', label: 'Matches', width: 220, flex: 1 },
    { id: 'user', label: 'Service user', width: 150 },
    { id: 'age', label: 'Age', width: 90 },
  ];

  function renderRemoteEnv(view, canCancel) {
    const items = view.items || [];
    const selected = state.remoteSelected[view.environment_id] || new Set();
    state.remoteSelected[view.environment_id] = selected;
    const fetched = view.fetched_at ? 'fetched ' + relTime(view.fetched_at) : 'not fetched yet';
    const metaText = [
      fetched,
      view.stale ? 'refreshing' : null,
      plural(view.orphan_count || 0, 'orphan'),
      view.stale_count ? plural(view.stale_count, 'stale job') : null,
    ].filter(Boolean).join(' · ');
    const head = el('div', { className: 'exq-remote-env-head' }, [
      el('div', null, [
        el('h3', { className: 'exq-remote-env-name', text: view.environment_name || view.environment_id }),
        el('div', { className: 'exq-remote-env-meta', title: view.fetched_at ? absTime(view.fetched_at) : null, text: metaText }),
        view.fetch_error ? el('div', { className: 'exq-remote-env-meta exq-error-text', text: 'Last refresh failed: ' + view.fetch_error }) : null,
      ]),
    ]);
    if (canCancel && (view.orphan_count || view.stale_count)) {
      const cancellableIds = items.filter(isRemoteCancellable).map((i) => i.remote_job_id);
      const chosen = cancellableIds.filter((rid) => selected.has(rid));
      const btn = el('button', {
        className: 'qym-inline-action qym-inline-action--danger',
        type: 'button',
        'data-exq-orphan-cancel': view.environment_id,
        disabled: !chosen.length || state.busy,
        text: (view.stale_count ? 'Cancel selected remote jobs (' : 'Cancel selected orphans (') + chosen.length + ')',
      });
      btn.addEventListener('click', () => cancelOrphans(view, chosen));
      head.appendChild(btn);
    }
    const section = el('div', { className: 'exq-remote-env', 'data-exq-remote-env': view.environment_id }, [head]);
    if (!items.length) {
      section.appendChild(el('div', { className: 'exq-footer-note', text: view.fetched_at ? 'Nothing pending or running on the service.' : 'The first snapshot is being fetched.' }));
      return section;
    }
    const renderRow = (item) => {
      let selectCell = el('td', { className: 'exq-select-cell' });
      if (canCancel && isRemoteCancellable(item)) {
        const box = el('input', {
          type: 'checkbox',
          'aria-label': 'Select ' + (item.orphan ? 'orphan ' : 'stale job ') + item.remote_job_id,
          'data-exq-orphan-select': item.remote_job_id,
          checked: selected.has(item.remote_job_id),
          disabled: state.busy,
        });
        box.addEventListener('change', () => {
          if (box.checked) selected.add(item.remote_job_id); else selected.delete(item.remote_job_id);
          renderRemote();
        });
        selectCell = el('td', { className: 'exq-select-cell' }, [box]);
      }
      const match = item.match;
      const owner = match
        ? el('td', { title: match.experiment_name || '' }, [
          el('a', { className: 'exq-link', href: experimentUrl(match.experiment_id), text: match.experiment_name || match.experiment_id }),
          el('div', { className: 'exq-sub' }, [
            item.stale
              ? el('span', {
                className: 'qym-badge qym-badge--warning',
                'data-exq-stale': item.remote_job_id,
                title: 'The qym job is finished, but the service still runs it. Cancel it from the remote queue if it should stop.',
                text: 'Stale',
              })
              : null,
            (item.stale ? ' ' : '') + 'Local status ' + titleCase(match.status),
          ]),
        ])
        : el('td', null, [tag('Orphan', 'danger', 'No job of this project has this remote id')]);
      return el('tr', { 'data-remote-job-id': item.remote_job_id }, [
        selectCell,
        el('td', { className: 'exq-mono', title: item.run_name || item.remote_job_id }, [
          item.remote_job_id,
          item.run_name ? el('div', { className: 'exq-sub', text: item.run_name }) : null,
        ]),
        el('td', null, [badge(item.status, REMOTE_TONES)]),
        el('td', null, [tag(titleCase(item.priority || 'NORMAL'), PRIORITY_TAGS[item.priority] || null)]),
        owner,
        el('td', { className: 'exq-mono', title: item.user_id || '', text: item.user_id || '—' }),
        el('td', { className: 'exq-mono', title: absTime(item.created_at), text: relTime(item.created_at) }),
      ]);
    };
    const tableHost = el('div', { className: 'exq-table-wrap' });
    section.appendChild(tableHost);
    if (window.QymDataTable && window.QymDataTable.render) {
      window.QymDataTable.render({ host: tableHost, columns: REMOTE_COLUMNS, rows: items, storageKey: 'eval-queue.remote.v1', minWidth: 900, renderRow: renderRow });
    } else {
      tableHost.appendChild(el('table', { className: 'qdt-table' }, [
        el('thead', null, el('tr', null, REMOTE_COLUMNS.map((c) => el('th', { text: c.label })))),
        el('tbody', null, items.map(renderRow)),
      ]));
    }
    return section;
  }

  function renderRemote() {
    const host = state.regions && state.regions.remote;
    if (!host) return;
    const remote = state.remote;
    const orphanTotal = remote && remote.environments
      ? remote.environments.reduce((n, v) => n + (v.orphan_count || 0), 0)
      : 0;
    const staleTotal = remote && remote.environments
      ? remote.environments.reduce((n, v) => n + (v.stale_count || 0), 0)
      : 0;
    const toggle = el('button', {
      className: 'exq-remote-toggle',
      type: 'button',
      'aria-expanded': state.remoteOpen ? 'true' : 'false',
      'aria-controls': 'exq-remote-body',
      'data-exq-remote-toggle': '1',
    }, [
      el('span', { className: 'exq-chevron', 'aria-hidden': 'true', text: '▶' }),
      el('span', null, [
        el('h2', { className: 'exq-section-title', text: 'Remote queue' }),
        el('p', { className: 'exq-section-description', text: 'What each environment’s Evaluation Service holds, from its latest snapshot. Jobs that match none of ours are orphans; jobs whose qym job already finished are stale.' }),
      ]),
    ]);
    toggle.addEventListener('click', toggleRemote);
    const header = el('div', { className: 'exq-card-header' }, [
      toggle,
      orphanTotal ? tag(plural(orphanTotal, 'orphan'), 'danger') : null,
      staleTotal ? tag(plural(staleTotal, 'stale job'), 'warning') : null,
    ]);
    if (!state.remoteOpen) {
      host.replaceChildren(header);
      return;
    }
    const body = el('div', { id: 'exq-remote-body' });
    if (!remote) {
      body.appendChild(el('div', { className: 'exq-loading', text: 'Loading the remote queue…' }));
    } else if (remote.error) {
      body.appendChild(el('div', { className: 'exq-error', text: remote.error }));
    } else if (!(remote.environments || []).length) {
      body.appendChild(el('div', { className: 'exq-footer-note', text: 'No active environment.' }));
    } else {
      const canCancel = remote.can_cancel_orphans === true;
      remote.environments.forEach((view) => body.appendChild(renderRemoteEnv(view, canCancel)));
      if (!canCancel && (orphanTotal || staleTotal)) {
        body.appendChild(el('div', { className: 'exq-footer-note', text: 'Only a project manager can cancel orphan and stale jobs.' }));
      }
    }
    host.replaceChildren(header, body);
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────
  function teardown() {
    state.active = false;
    clearPoll();
    closeDialog();
    document.removeEventListener('visibilitychange', onVisibility);
  }

  async function start() {
    if (window.QymShell && !window.__QYM_USER__) {
      await new Promise((resolve) => document.addEventListener('qym:shell-ready', resolve, { once: true }));
    }
    if (!state.active) return;
    await loadContext();
    if (!state.active) return;
    mountSkeleton();
    await refresh();
  }

  document.addEventListener('qym:before-navigate', teardown, { once: true });
  document.addEventListener('visibilitychange', onVisibility);
  start().catch((err) => {
    if (!state.active) return;
    root.replaceChildren(el('div', { className: 'exq-error', text: (err && err.message) || 'Failed to load the queue' }));
  });
})();
