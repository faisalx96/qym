/* Headline project KPIs: one name, definition and number format per KPI.
 *
 * The Overview cards and the Runs/Charts/Models topbar render the server's
 * `kpis` aggregation (POST /api/dashboard/kpis, and `kpis` in the dashboard
 * overview payload) through these helpers, so one label always shows one
 * number. Never derive headline numbers from a page of loaded rows.
 */
(function () {
  'use strict';

  function formatCount(n) {
    n = Number(n) || 0;
    return n >= 1000000 ? (n / 1000000).toFixed(1) + 'M' : n.toLocaleString('en-US');
  }

  function formatPercent(rate) {
    if (rate == null || !isFinite(rate)) return '—';
    if (rate >= 1) return '100%';
    if (rate <= 0) return '0%';
    // Round down, so a rate with any failed item never reads as 100%.
    var pct = Math.floor(rate * 1000) / 10;
    return pct < 0.1 ? '<0.1%' : pct.toFixed(1) + '%';
  }

  function scope(kpis) {
    var filtered = !!kpis && kpis.scope === 'filtered';
    return {
      label: filtered ? 'Filtered runs' : 'All runs',
      across: filtered ? 'the runs that match the active filters' : 'all runs in this project',
      runs: filtered ? 'Runs that match the active filters.' : 'All runs in this project.',
    };
  }

  function noun(n, one, many) {
    return Number(n) === 1 ? one : many;
  }

  function entries(kpis) {
    if (!kpis) return [];
    var s = scope(kpis);
    var across = ' across ' + s.across;
    return [
      {
        key: 'runs', name: 'Runs', label: noun(kpis.runs, 'run', 'runs'),
        value: formatCount(kpis.runs), color: 'var(--accent-primary)',
        title: s.runs,
      },
      {
        key: 'execution_success', name: 'Execution success', label: 'execution success',
        value: formatPercent(kpis.execution_success), color: 'var(--success)',
        title: 'Share of items that ran without a task error, weighted by items,' + across
          + '. Metric errors do not lower it; they count in runs with errors.',
      },
      {
        key: 'runs_with_errors', name: 'Runs with errors',
        label: noun(kpis.runs_with_errors, 'run with errors', 'runs with errors'),
        value: formatCount(kpis.runs_with_errors),
        color: kpis.runs_with_errors ? 'var(--error)' : 'var(--text-dim)',
        title: 'Runs with at least one task or metric error' + across + '.',
      },
      // Secondary chips yield topbar space on narrow windows (shell.css).
      {
        key: 'models', name: 'Models', label: noun(kpis.models, 'model', 'models'),
        value: formatCount(kpis.models), color: 'var(--accent-secondary)', secondary: true,
        title: 'Distinct model names' + across
          + '. Reasoning and standard variants of one model count once.',
      },
      {
        key: 'items', name: 'Items', label: noun(kpis.items, 'item', 'items'),
        value: formatCount(kpis.items), color: 'var(--accent-tertiary)', secondary: true,
        title: 'Items evaluated' + across + '.',
      },
    ];
  }

  function renderTopbar(kpis) {
    var shell = window.QymShell;
    if (!shell || !shell.setTopbarStats) return;
    if (!kpis) { shell.setTopbarStats([]); return; }
    var s = scope(kpis);
    shell.setTopbarStats(entries(kpis), {
      scope: s.label,
      scopeTitle: 'Totals across ' + s.across + '.',
    });
  }

  window.QymKpis = {
    entries: entries,
    scope: scope,
    renderTopbar: renderTopbar,
    formatCount: formatCount,
    formatPercent: formatPercent,
  };
})();
