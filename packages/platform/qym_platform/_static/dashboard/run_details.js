/* Keep analytical rows complete while loading large item bodies as needed. */
(() => {
  'use strict';
  let activeRequests = 0;
  const requestQueue = [];
  // Detail requests in flight, keyed by run and item. Compare opens one
  // loader per pass column of the same run; the details endpoint returns every
  // pass, so those loaders share one request instead of repeating it.
  const sharedDetails = new Map();
  // Text searches of those pass loaders, gathered per run within one tick:
  // one request answers every pass column instead of one request per column.
  const passSearches = new Map();
  // Mirrors services/run_payloads.py: the index keeps error flags and short
  // scalar metadata only. Released rows return to exactly that shape.
  const META_TEXT_LIMIT = 200;
  const META_ALWAYS_KEPT = new Set(['error', 'status', 'last_edit']);
  const INDEX_FIELDS = ['output_digest', '__has_output', '__execution_error', 'input_preview'];

  async function withRequestSlot(request) {
    if (activeRequests >= 3) await new Promise(resolve => requestQueue.push(resolve));
    else activeRequests++;
    try { return await request(); }
    finally {
      const next = requestQueue.shift();
      if (next) next();
      else activeRequests--;
    }
  }

  function compactMeta(meta) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return meta;
    const result = {};
    for (const [key, value] of Object.entries(meta)) {
      const short = value === null || typeof value === 'boolean' || typeof value === 'number'
        || (typeof value === 'string' && value.length <= META_TEXT_LIMIT);
      if (META_ALWAYS_KEPT.has(key) || (key !== 'explanation' && short)) result[key] = value;
    }
    return result;
  }

  function compactMetaMap(metaByMetric) {
    if (!metaByMetric || typeof metaByMetric !== 'object') return metaByMetric;
    return Object.fromEntries(Object.entries(metaByMetric).map(([name, meta]) => [name, compactMeta(meta)]));
  }

  function create(options) {
    const loaded = new Map();
    const pending = new Map();
    const searches = new Map();
    const searchPending = new Map();
    const abort = new AbortController();
    const bodyFields = ['input', 'input_full', 'expected', 'expected_full', 'output', 'output_full'];
    const maxLoaded = options.maxLoaded || 200;
    const self = { stopped: false };
    let stopped = false;

    function itemId(row) { return String(row.item_id ?? row.index); }
    function sharedKey(id) { return JSON.stringify([String(options.runId), id]); }
    function searchKey(condition) { return JSON.stringify([condition.field, String(condition.value || '').toLowerCase()]); }
    function captureBodies(row) {
      return {
        fields: Object.fromEntries(bodyFields.map(key => [key, row[key]])),
        index: Object.fromEntries(INDEX_FIELDS.map(key => [key, row[key]])),
        // Compact attempts carry the output digest the index compares with.
        attempts: Array.isArray(row.pass_attempts) ? row.pass_attempts : null,
      };
    }
    function restoreIndexFields(row, original) {
      for (const key of INDEX_FIELDS) {
        if (row[key] == null && original.index[key] != null) row[key] = original.index[key];
      }
    }
    function release(entry) {
      const { row, original } = entry;
      for (const key of bodyFields) {
        if (original.fields[key] === undefined) delete row[key];
        else row[key] = original.fields[key];
      }
      for (const key of INDEX_FIELDS) {
        if (original.index[key] === undefined) delete row[key];
        else row[key] = original.index[key];
      }
      // Rebuild the index form from current values so edits made while the
      // row was loaded (a modified flag, a new score) survive the release.
      // Nested objects are replaced, never mutated: loaders share them.
      row.metric_meta = compactMetaMap(row.metric_meta);
      if (row.pass_metric_meta && typeof row.pass_metric_meta === 'object') {
        row.pass_metric_meta = Object.fromEntries(Object.entries(row.pass_metric_meta).map(([name, values]) =>
          [name, Array.isArray(values) ? values.map(compactMeta) : values]));
      }
      if (Array.isArray(row.pass_attempts)) {
        row.pass_attempts = row.pass_attempts.map((attempt, i) => {
          if (!attempt || typeof attempt !== 'object') return attempt;
          const { output, ...rest } = attempt;
          const indexed = original.attempts?.[i];
          return {
            ...rest,
            __has_output: indexed?.__has_output ?? (output != null),
            __execution_error: indexed?.__execution_error ?? (rest.status === 'error' ? (output || '') : ''),
            ...(indexed?.output_digest != null ? { output_digest: indexed.output_digest } : {}),
          };
        });
      }
      row.__details_loaded = false;
    }
    function trim(keepIds = new Set(), limit = maxLoaded) {
      for (const [id, entry] of loaded) {
        if (loaded.size <= limit) break;
        if (keepIds.has(id)) continue;
        release(entry);
        loaded.delete(id);
      }
    }
    async function post(suffix, body) {
      return withRequestSlot(async () => {
        const response = await fetch(options.apiUrl('api/runs/' + encodeURIComponent(options.runId) + '/items/' + suffix), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: abort.signal,
        });
        if (!response.ok) throw new Error('Could not load item ' + suffix + ' (HTTP ' + response.status + ')');
        const data = await response.json();
        if (data.error) throw new Error(data.error);
        return data;
      });
    }
    function requestDetails(ids) {
      const request = post('details', { item_ids: ids })
        .then(data => new Map((data.rows || []).map(row => [itemId(row), row])));
      for (const id of ids) {
        const key = sharedKey(id);
        const entry = { owner: self, promise: request.then(rows => rows.get(id)) };
        sharedDetails.set(key, entry);
        entry.promise.catch(() => {}).finally(() => {
          if (sharedDetails.get(key) === entry) sharedDetails.delete(key);
        });
      }
      return request;
    }
    // Full rows for ids, joining requests other loaders already sent.
    async function fetchDetails(ids) {
      const shared = [];
      const own = [];
      for (const id of ids) {
        const entry = sharedDetails.get(sharedKey(id));
        if (entry && !entry.owner.stopped) shared.push([id, entry]);
        else own.push(id);
      }
      const request = own.length ? requestDetails(own) : null;
      const rows = new Map();
      const retry = [];
      for (const [id, entry] of shared) {
        try {
          rows.set(id, await entry.promise);
        } catch (error) {
          // A stopped owner aborts its request; this loader still needs rows.
          if (stopped || !entry.owner.stopped) throw error;
          retry.push(id);
        }
      }
      if (request) for (const [id, row] of await request) rows.set(id, row);
      if (retry.length) for (const [id, row] of await requestDetails(retry)) rows.set(id, row);
      return rows;
    }
    function ensureRows(rows, settings = {}) {
      if (stopped) return null;
      const requested = new Map(rows.map(row => [itemId(row), row]));
      const waiting = new Set();
      const missing = [];
      for (const [id, row] of requested) {
        if (row.__details_loaded !== false) {
          const entry = loaded.get(id);
          if (entry) { entry.row = row; loaded.delete(id); loaded.set(id, entry); }
        } else if (pending.has(id)) {
          waiting.add(pending.get(id));
        } else {
          missing.push(row);
        }
      }
      // A sequential batch loop bounds requests as well as response buffers.
      if (missing.length) {
        const promise = (async () => {
          for (let offset = 0; offset < missing.length; offset += 100) {
            const batch = missing.slice(offset, offset + 100);
            const patches = await fetchDetails(batch.map(itemId));
            if (stopped) return;
            for (const row of batch) {
              const id = itemId(row);
              const full = patches.get(id);
              if (!full) throw new Error('Item details are no longer available. Reload the run to refresh its items.');
              const original = captureBodies(row);
              const identity = {};
              for (const key of ['compare_item_id', 'compare_alignment_source', 'alignment_source']) {
                if (Object.prototype.hasOwnProperty.call(row, key)) identity[key] = row[key];
              }
              Object.assign(row, options.transformRow ? options.transformRow(full) : full, identity, { __details_loaded: true });
              restoreIndexFields(row, original);
              loaded.set(id, { row, original });
            }
          }
          if (!settings.retainAll) trim(new Set(requested.keys()));
        })();
        for (const row of missing) pending.set(itemId(row), promise);
        promise.finally(() => {
          for (const row of missing) if (pending.get(itemId(row)) === promise) pending.delete(itemId(row));
        }).catch(() => {});
        waiting.add(promise);
      }
      return waiting.size ? Promise.all(waiting) : null;
    }
    // Matched item ids per condition for this loader's pass. Loaders of other
    // passes of the run that search in the same tick share the request.
    function searchPass(conditions) {
      const runKey = String(options.runId);
      let group = passSearches.get(runKey);
      if (!group || group.owner.stopped || group.members.has(self)) {
        group = { owner: self, members: new Set(), passes: new Set(), conditions: new Map() };
        passSearches.set(runKey, group);
        group.promise = Promise.resolve().then(async () => {
          if (passSearches.get(runKey) === group) passSearches.delete(runKey);
          const entries = [...group.conditions.entries()];
          const passes = [...group.passes].sort((a, b) => a - b);
          const found = new Map();
          for (let offset = 0; offset < entries.length; offset += 32) {
            const chunk = entries.slice(offset, offset + 32);
            const data = await post('search', {
              conditions: chunk.map(([, condition], index) => ({ id: String(index), field: condition.field, operator: 'contains', value: condition.value })),
              pass_numbers: passes,
            });
            chunk.forEach(([key], index) => {
              found.set(key, new Map(passes.map(pass => [pass, data.matches_by_pass?.[String(pass)]?.[String(index)]])));
            });
          }
          return found;
        });
      }
      group.members.add(self);
      group.passes.add(options.passNumber);
      for (const condition of conditions) group.conditions.set(searchKey(condition), condition);
      const owner = group.owner;
      return group.promise.then(
        found => conditions.map(condition => found.get(searchKey(condition))?.get(options.passNumber)),
        error => {
          // A stopped owner aborts the shared request; search again alone.
          if (!stopped && owner !== self && owner.stopped) return searchPass(conditions);
          throw error;
        },
      );
    }
    function ensureSearch(conditions) {
      if (stopped) return null;
      const waiting = new Set();
      const missing = new Map();
      for (const condition of conditions) {
        const key = searchKey(condition);
        if (searches.has(key)) continue;
        if (searchPending.has(key)) waiting.add(searchPending.get(key));
        else missing.set(key, condition);
      }
      if (missing.size) {
        const entries = [...missing.entries()];
        const promise = (async () => {
          for (let offset = 0; offset < entries.length; offset += 32) {
            const batch = entries.slice(offset, offset + 32);
            const found = options.passNumber
              ? await searchPass(batch.map(([, condition]) => condition))
              : await post('search', {
                conditions: batch.map(([, condition], index) => ({ id: String(index), field: condition.field, operator: 'contains', value: condition.value })),
              }).then(data => batch.map((_, index) => data.matches?.[String(index)]));
            if (stopped) return;
            batch.forEach(([key], index) => {
              if (!Array.isArray(found[index])) throw new Error('Incomplete item search response');
              searches.set(key, new Set(found[index].map(String)));
            });
          }
          const active = new Set(conditions.map(searchKey));
          for (const key of searches.keys()) {
            if (searches.size <= Math.max(32, active.size)) break;
            if (!active.has(key)) searches.delete(key);
          }
        })();
        for (const [key] of entries) searchPending.set(key, promise);
        promise.finally(() => {
          for (const [key] of entries) if (searchPending.get(key) === promise) searchPending.delete(key);
        }).catch(() => {});
        waiting.add(promise);
      }
      return waiting.size ? Promise.all(waiting) : null;
    }
    return {
      ensureRows,
      ensureSearch,
      adoptRow(row, previous) {
        const id = itemId(row);
        const original = loaded.get(id)?.original || captureBodies(previous);
        restoreIndexFields(row, original);
        row.__details_loaded = true;
        loaded.set(id, { row, original });
      },
      isLoaded: row => row?.__details_loaded !== false,
      matches: (condition, row) => searches.get(searchKey(condition))?.has(itemId(row)) || false,
      releaseExcept(rows) { trim(new Set(rows.map(itemId)), rows.length); },
      // A live run gained items: earlier text-search answers may miss them.
      forgetSearches() { searches.clear(); },
      stop() {
        stopped = true;
        self.stopped = true;
        abort.abort();
        for (const entry of loaded.values()) release(entry);
        loaded.clear(); pending.clear(); searches.clear(); searchPending.clear();
      },
    };
  }
  window.QymRunDetails = { create };
})();
