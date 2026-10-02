/**
 * The Runs list order outside the list (C044).
 *
 * A run opened from the Runs list carries the list's view (filters, range,
 * search and sort, never the page) in one ``list`` query parameter. The run
 * page then steps to the previous and next run in that same order, across
 * page ends, through POST /api/dashboard/neighbors. A run opened any other
 * way has no ``list``: the project's default order (newest first, no
 * filters).
 *
 * The list (dashboard.js) and the run page take the order from here: the
 * context a run link carries, the filters and sort the server orders by, and
 * the collation of the text sorts (task, model, dataset, version, owner),
 * which the browser decides with localeCompare.
 *
 * shell.js re-runs page scripts on in-app navigation: no top-level
 * const/let/class.
 */
(function () {
  'use strict';

  var PARAM = 'list';
  var DEFAULT_SORT = 'time-desc';
  // The Runs list URL filters and the dashboard API filter each one sets.
  var FILTERS = [
    ['task', 'tasks'], ['model', 'models'], ['dataset', 'datasets'],
    ['status', 'statuses'], ['version', 'versions'], ['owner', 'users'],
  ];
  // The order the list writes its view parameters in (page left out).
  var CONTEXT_KEYS = ['range', 'from', 'to', 'task', 'model', 'dataset', 'status', 'version', 'owner', 'q', 'sort'];
  // Text sorts the browser collates, and the overview's sort_values column.
  var COLLATED = { task: 'tasks', model: 'models', dataset: 'dataset_names', version: 'git_commits', owner: 'owner_names' };

  function sortField(sort) {
    return String(sort || '').replace(/-(asc|desc)$/, '');
  }

  function validSort(sort) {
    return typeof sort === 'string' && /^[^\s].*-(asc|desc)$/.test(sort) ? sort : DEFAULT_SORT;
  }

  function normalizeSearch(value) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  // The list's view parameters ({key: value | values | null}) as the run
  // link's context: canonical order, no page, '' for the default view.
  function contextFromParams(params) {
    var source = params || {};
    var out = new URLSearchParams();
    CONTEXT_KEYS.forEach(function (key) {
      var value = source[key];
      if (key === 'q') value = normalizeSearch(value);
      if (key === 'sort' && value === DEFAULT_SORT) value = null;
      (Array.isArray(value) ? value : [value]).forEach(function (item) {
        if (item !== null && item !== undefined && item !== '') out.append(key, String(item));
      });
    });
    return out.toString();
  }

  // A context read back from a URL: only the list's view keys, in order.
  function normalizeContext(context) {
    var params;
    try { params = new URLSearchParams(String(context || '')); } catch (err) { return ''; }
    var source = {};
    CONTEXT_KEYS.forEach(function (key) {
      var values = params.getAll(key);
      if (values.length) source[key] = key === 'q' || key === 'sort' || key === 'range' || key === 'from' || key === 'to' ? values[0] : values;
    });
    return contextFromParams(source);
  }

  // The run page URL for a run, carrying the list context when there is one.
  function runHref(base, context) {
    var normalized = normalizeContext(context);
    if (!normalized) return base;
    return base + '?' + new URLSearchParams([[PARAM, normalized]]).toString();
  }

  function parseLocalDate(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    var date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  // The time bounds of a list range, in the viewer's local days, as the list
  // computes them (dashboard.js timeFilterBounds). A custom Range may be open
  // on one side ("From" or "Until" a date), as the Range picker allows.
  function rangeBounds(range, from, to, now) {
    var since = null;
    var until = null;
    var at = now || new Date();
    if (range === 'today') {
      since = new Date(at);
      since.setHours(0, 0, 0, 0);
      until = new Date(since);
      until.setDate(until.getDate() + 1);
    } else if (range === 'week' || range === 'month') {
      since = new Date(at);
      since.setDate(since.getDate() - (range === 'week' ? 7 : 30));
    } else if (range === 'custom') {
      since = parseLocalDate(from);
      until = parseLocalDate(to);
      if (until) until.setDate(until.getDate() + 1);
    }
    return { since: since, until: until };
  }

  // The dashboard API filters and sort of a list context, as the list sends
  // them for the same URL (dashboard.js applyDashboardUrlState and
  // dashboardFilters). A plain model name covers its plain and reasoning
  // variants.
  function query(context, now) {
    var params;
    try { params = new URLSearchParams(String(context || '')); } catch (err) { params = new URLSearchParams(); }
    var filters = {};
    FILTERS.forEach(function (pair) {
      var values = params.getAll(pair[0]).filter(Boolean);
      if (pair[0] === 'model') {
        var models = [];
        values.forEach(function (value) {
          if (value === '__none__' || /\|\|\|(reasoning|plain)$/.test(value)) models.push(value);
          else models.push(value + '|||plain', value + '|||reasoning');
        });
        values = models;
      }
      filters[pair[1]] = values.filter(function (value, index) { return values.indexOf(value) === index; });
    });
    var bounds = rangeBounds(params.get('range'), params.get('from'), params.get('to'), now);
    if (bounds.since) filters.since = bounds.since.toISOString();
    if (bounds.until) filters.until = bounds.until.toISOString();
    var search = normalizeSearch(params.get('q'));
    if (search) filters.q = search;
    return { filters: filters, sort: validSort(params.get('sort')) };
  }

  function parseModelKey(value) {
    var raw = String(value || '');
    var index = raw.lastIndexOf('|||');
    var suffix = index < 0 ? '' : raw.slice(index + 3);
    if (suffix !== 'reasoning' && suffix !== 'plain') return { name: raw, reasoning: null };
    return { name: raw.slice(0, index), reasoning: suffix === 'reasoning' };
  }

  function stripProvider(name) {
    var slash = String(name || '').indexOf('/');
    return slash > 0 ? name.slice(slash + 1) : String(name || '');
  }

  // Models sort by the name the list shows (no provider), plain first.
  function compareModelKeys(a, b) {
    var left = parseModelKey(a);
    var right = parseModelKey(b);
    var byLabel = stripProvider(left.name).localeCompare(stripProvider(right.name));
    if (byLabel !== 0) return byLabel;
    if (!!left.reasoning === !!right.reasoning) return 0;
    return left.reasoning ? 1 : -1;
  }

  // The overview's sort_values column of a text sort, else null.
  function collatedColumn(sort) {
    var field = sortField(sort);
    return Object.prototype.hasOwnProperty.call(COLLATED, field) ? COLLATED[field] : null;
  }

  // The order of a text sort's values, which the server sorts by; null for a
  // sort the server orders by itself. Values that compare equal (one model
  // name from two providers) fall back to their code-point order: the list
  // and the run page collate value lists they fetched separately, whose
  // order the database does not fix, and must still order them alike.
  function collation(sort, values) {
    if (!collatedColumn(sort)) return null;
    var field = sortField(sort);
    var compare = field === 'model' ? compareModelKeys : function (a, b) {
      return String(a).localeCompare(String(b));
    };
    return (values || []).slice().sort(function (a, b) {
      var left = String(a);
      var right = String(b);
      return compare(a, b) || (left < right ? -1 : (left > right ? 1 : 0));
    });
  }

  window.QymRunsOrder = {
    PARAM: PARAM,
    DEFAULT_SORT: DEFAULT_SORT,
    contextFromParams: contextFromParams,
    normalizeContext: normalizeContext,
    runHref: runHref,
    query: query,
    collatedColumn: collatedColumn,
    collation: collation,
    compareModelKeys: compareModelKeys,
  };
})();
