// Step Latency panel — per-step latency distributions as an interval plot.
// One row per (phase, step type): p5–p95 whisker, p25–p75 bar, median tick,
// mean diamond, "n · err" annotation. Vanilla JS + inline SVG, no external
// dependencies. Mounted from run.html into the Latency and Trace Analysis
// section; also usable from the compare page with multiple run ids.
(function () {
  "use strict";

  const FMT = (ms) => {
    if (ms == null || !isFinite(ms)) return "\u2014";
    if (ms >= 60000) return (ms / 60000).toFixed(1) + "m";
    if (ms >= 1000) return (ms / 1000).toFixed(2) + "s";
    if (ms >= 1) return Math.round(ms) + "ms";
    if (ms <= 0) return "0";
    return Math.max(1, Math.round(ms * 1000)) + "\u00b5s";
  };

  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  // Row annotation: "mean 2.1s · n=12 · err=3". annPlain() drives the gutter
  // width math, annMarkup() renders it (err in the danger color) — one source
  // so the two can never disagree.
  function annPlain(g) {
    const parts = [];
    if (g.n > 0) parts.push("mean " + FMT(g.mean_ms), "n=" + g.n);
    if (g.error_count) parts.push("err=" + g.error_count);
    return parts.join(" \u00b7 ");
  }

  // Collapsible grouping. Keys: "p:<phase>" for a phase header, and
  // "k:<phase>|<kind>" for a kind sub-header. Phase collapse only applies
  // where a phase header is drawn (All view); kind collapse only in By-step,
  // where kinds group step rows rather than being rows themselves.
  const phaseKeyOf = (g) => "p:" + g.phase;
  const kindKeyOf = (g) => "k:" + g.phase + "|" + g.kind;

  function isCollapsed(key) {
    return !!state.collapsed[key];
  }

  function collapseChevron(x, y, collapsed, color) {
    return collapsed
      ? '<path d="M ' + x + " " + (y - 4) + " l 5 4 l -5 4 Z" +
        '" fill="' + color + '"/>'
      : '<path d="M ' + (x - 1) + " " + (y - 2) + " l 9 0 l -4.5 5 Z" +
        '" fill="' + color + '"/>';
  }

  // Build the interleaved header/row list honouring collapse state.
  // `entries` are the sorted groups (pooled) or comparison rows (by run).
  function groupedItems(entries) {
    const showPhaseHeaders = state.phase === "all";
    const showKindHeaders = state.rollup === "name";
    const phaseCount = {};
    const kindCount = {};
    entries.forEach((e) => {
      phaseCount[phaseKeyOf(e)] = (phaseCount[phaseKeyOf(e)] || 0) + 1;
      kindCount[kindKeyOf(e)] = (kindCount[kindKeyOf(e)] || 0) + 1;
    });

    const items = [];
    let lastPhase = "";
    let lastKind = "";
    entries.forEach((e) => {
      const pKey = phaseKeyOf(e);
      const kKey = kindKeyOf(e);
      const pDown = showPhaseHeaders && isCollapsed(pKey);
      const kDown = showKindHeaders && isCollapsed(kKey);

      if (showPhaseHeaders && e.phase !== lastPhase) {
        items.push({
          header: e.phase === "task" ? "Agent" : "Eval",
          iconKey: e.phase === "task" ? "AGENT" : "EVALUATOR",
          level: 1, key: pKey, collapsed: pDown, count: phaseCount[pKey],
        });
        lastPhase = e.phase;
        lastKind = "";
      }
      if (pDown) return;

      if (showKindHeaders && e.kind !== lastKind) {
        items.push({
          header: e.kind, iconKey: ICON_KEY[e.kind] || "DEFAULT",
          level: 2, key: kKey, collapsed: kDown, count: kindCount[kKey],
        });
        lastKind = e.kind;
      }
      if (kDown) return;

      items.push({ row: e });
    });
    return items;
  }

  // Header row markup: chevron + kind icon + label, wrapped in a click
  // target spanning the label column.
  function headerMarkup(it, yTop, h, labelWidth) {
    const hb = yTop + h - 8;
    const l1 = it.level === 1;
    const cx = l1 ? 12 : 24;
    const ix = l1 ? 26 : 38;
    const tx = l1 ? 46 : 54;
    const suffix = it.collapsed ? "  \u00b7 " + it.count : "";
    return '<g data-sl-collapse="' + esc(it.key) + '" style="cursor:pointer">' +
      '<rect x="0" y="' + yTop + '" width="' + (labelWidth + 24) +
        '" height="' + h + '" fill="transparent"/>' +
      collapseChevron(cx, hb - 4, it.collapsed, "var(--text-muted, #888)") +
      kindIconSvg(it.iconKey, ix, hb - (l1 ? 11 : 9.5), l1 ? 13 : 11) +
      '<text x="' + tx + '" y="' + hb +
        '" font-size="' + (l1 ? 11 : 10) +
        '" letter-spacing="' + (l1 ? "0.1em" : "0.08em") +
        '" font-weight="' + (l1 ? 700 : 600) +
        '" fill="' + (l1 ? "var(--text-primary, #ddd)" : "var(--text-muted, #888)") +
        '">' + esc(it.header.toUpperCase()) + esc(suffix) + "</text>" +
      "</g>";
  }

  function annMarkup(g) {
    const lead = g.n > 0 ? "mean " + FMT(g.mean_ms) + " \u00b7 n=" + g.n : "";
    const err = g.error_count
      ? '<tspan fill="var(--danger, #ef4444)">' + (lead ? " \u00b7 " : "") +
        "err=" + g.error_count + "</tspan>"
      : "";
    return esc(lead) + err;
  }

  const PHASE_COLORS = {
    task: "var(--accent-primary, #00a8ff)",
    eval: "#a78bfa",
  };

  // Same palette + index assignment as the compare page's run cards
  // (COLORS in compare.html), so a run keeps its card color everywhere.
  const RUN_COLORS = ["#00d4aa", "#00a8ff", "#a855f7", "#f472b6",
    "#fbbf24", "#60a5fa", "#34d399", "#fb923c"];
  function seriesIndex(key) {
    return Math.max(state.series.findIndex((s) => s.key === key), 0);
  }

  function seriesLabel(key) {
    const s = state.series.find((x) => x.key === key);
    return s ? s.label : key;
  }

  function runColor(key) {
    return RUN_COLORS[seriesIndex(key) % RUN_COLORS.length];
  }
  const DL_ICON =
    '<svg class="qym-item-control-icon" viewBox="0 0 16 16" aria-hidden="true">' +
    '<path d="M8 2v8"/><path d="m4.5 7 3.5 3.5L11.5 7"/><path d="M3 13.5h10"/></svg>';

  // Kind icons + colors copied from trace_viewer.js (ICONS / KIND_COLORS) so
  // the panel speaks the same visual language as the span tree.
  const SL_ICONS = {
    LLM: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="8.5" rx="2" fill="currentColor"/><polygon points="5,10.5 5,14 8.5,10.5" fill="currentColor"/></svg>',
    TOOL: '<svg viewBox="0 0 16 16"><path d="M9.7 7.7L5.3 12.1a1.6 1.6 0 0 1-2.3 0l-.1-.1a1.6 1.6 0 0 1 0-2.3l4.4-4.4a3.2 3.2 0 0 1 4.6-3.7L10 3.5l.3 1.2 1.2.3 1.9-1.9a3.2 3.2 0 0 1-3.7 4.6z" fill="currentColor"/></svg>',
    AGENT: '<svg viewBox="0 0 16 16"><circle cx="8" cy="4" r="3" fill="currentColor"/><path d="M2.5 14.5c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5z" fill="currentColor" opacity=".75"/></svg>',
    EVALUATOR: '<svg viewBox="0 0 16 16"><path d="M8 1.5l2 4 4.4.7-3.2 3.1.75 4.4L8 11.5l-3.95 2.2.75-4.4-3.2-3.1L7 5.5z" fill="currentColor"/></svg>',
    RETRIEVER: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"><ellipse cx="8" cy="3.5" rx="4.5" ry="2"/><path d="M3.5 3.5v7c0 1.1 2 2 4.5 2s4.5-.9 4.5-2v-7"/><path d="M3.5 7c0 1.1 2 2 4.5 2s4.5-.9 4.5-2"/><path d="M3.5 10.5c0 1.1 2 2 4.5 2s4.5-.9 4.5-2"/></svg>',
    EMBED: '<svg viewBox="0 0 16 16"><rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity=".85"/><rect x="9" y="1.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity=".45"/><rect x="1.5" y="9" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity=".45"/><rect x="9" y="9" width="5.5" height="5.5" rx="1.5" fill="currentColor" opacity=".85"/></svg>',
    DEFAULT: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4.5" fill="currentColor" opacity=".7"/></svg>',
  };
  const SL_KIND_COLORS = {
    LLM: "#f472b6", TOOL: "#fbbf24", AGENT: "#34d399",
    EVALUATOR: "#a78bfa", RETRIEVER: "#38bdf8", EMBED: "#94a3b8", DEFAULT: "#6b7280",
  };
  const ICON_KEY = {
    LLM: "LLM", TOOL: "TOOL", RETRIEVER: "RETRIEVER", EMBEDDING: "EMBED",
    RERANKER: "DEFAULT", GUARDRAIL: "DEFAULT", OTHER: "DEFAULT",
  };

  function kindIconSvg(key, x, y, size) {
    const inner = SL_ICONS[key] || SL_ICONS.DEFAULT;
    const color = SL_KIND_COLORS[key] || SL_KIND_COLORS.DEFAULT;
    return inner.replace(
      "<svg ",
      '<svg x="' + x + '" y="' + y + '" width="' + size + '" height="' + size +
        '" style="color:' + color + '" '
    );
  }

  const state = {
    runIds: [],
    pooled: false,     // true on compare: all selected runs pooled
    passNum: null,     // selected repeat pass, null = all passes
    passLocked: false, // pass-scoped run page (?pass=N): fixed pass, no toggle
    passes: [],        // available pass numbers from the API
    rollup: "name",   // name | kind
    phase: "all",      // all | task | eval
    scale: "linear",   // linear | log
    data: null,        // groups from the API for current rollup
    cache: {},         // groups per rollup for the current pass scope
    traceCount: 0,     // distinct traces behind the current data
    hasUnscopedGroups: false, // keep pass controls usable after an empty selection
    collapsed: {},     // group keys collapsed in the plot (client-side only)
    series: [],        // [{key, label, refs}] one lane each: a run, or a cohort
    activeSeries: [],  // series keys currently drawn
    runData: {},       // groups keyed by rollup then series key
    error: null,
    seq: 0,            // request generation; stale responses are discarded
    pending: {},       // shared requests for each rollup in this generation
    runPending: {},    // shared requests for each comparison lane
  };

  let container = null;

  function hasGroupData(group) {
    return group && (group.n > 0 || group.error_count > 0);
  }

  function apiUrl(params) {
    const base = { run_ids: [...new Set(state.runIds)].join(",") };
    if (state.passNum != null) base.pass_number = state.passNum;
    const q = new URLSearchParams(Object.assign(base, params || {}));
    return "/api/runs/step-latency?" + q.toString();
  }

  async function loadGroups(rollup, seq) {
    if (state.cache[rollup]) {
      return { groups: state.cache[rollup], passes: state.passes,
        trace_count: state.traceCount };
    }
    const pending = state.pending;
    if (!pending[rollup]) pending[rollup] = (async () => {
      const resp = await fetch(apiUrl({ rollup: rollup }), {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      if (!resp.ok) throw new Error("HTTP " + resp.status);
      const payload = await resp.json();
      if (seq !== state.seq) return null;
      payload.groups = (payload.groups || []).filter(hasGroupData);
      state.cache[rollup] = payload.groups;
      state.passes = payload.passes || [];
      state.traceCount = payload.trace_count || 0;
      return payload;
    })().finally(() => { delete pending[rollup]; });
    return pending[rollup];
  }

  async function fetchData() {
    const seq = state.seq;
    const rollup = state.rollup;
    state.data = null;
    state.error = null;
    render();
    try {
      const [payload] = await Promise.all([
        loadGroups(rollup, seq),
        state.pooled ? ensureRunData(seq) : ensureNameGroups(seq),
      ]);
      if (seq !== state.seq || !payload) return;
      state.data = payload.groups || [];
      if (state.passNum == null) state.hasUnscopedGroups = state.data.length > 0;
    } catch (err) {
      if (seq !== state.seq) return;
      state.error = String((err && err.message) || err);
    }
    refreshTraceStatsInset();
    render();
  }

  async function ensureRunData(seq = state.seq) {
    const rollup = state.rollup;
    const bucket = state.runData[rollup] || (state.runData[rollup] = {});
    const pending = state.runPending[rollup] || (state.runPending[rollup] = {});
    const missing = state.activeSeries.filter((key) => !bucket[key]);
    await Promise.all(missing.map(async (key) => {
      if (pending[key]) return pending[key];
      const s = state.series.find((x) => x.key === key);
      if (!s) return;
      // The endpoint pools every ref it is given, so a cohort is one call
      // and pass refs ("<run>::pass2") scope themselves server-side.
      const q = new URLSearchParams({
        run_ids: s.refs.join(","), rollup: rollup,
      });
      if (state.passNum != null) q.set("pass_number", state.passNum);
      pending[key] = (async () => {
        const resp = await fetch("/api/runs/step-latency?" + q.toString(), {
          headers: { Accept: "application/json" },
          credentials: "same-origin",
        });
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        const payload = await resp.json();
        if (seq === state.seq) bucket[key] = (payload.groups || []).filter(hasGroupData);
      })().catch((err) => {
        if (seq === state.seq && state.activeSeries.includes(key)) throw err;
      }).finally(() => { delete pending[key]; });
      return pending[key];
    }));
  }

  // Ensure name-rollup groups are available (used by the trace-stats
  // breakdowns regardless of the panel's current rollup toggle).
  async function ensureNameGroups(seq = state.seq) {
    const payload = await loadGroups("name", seq);
    return payload ? payload.groups || [] : null;
  }

  const KIND_ORDER = ["LLM", "TOOL", "RETRIEVER", "EMBEDDING", "RERANKER", "GUARDRAIL", "OTHER"];

  function visibleGroups() {
    let groups = (state.data || []).slice();
    if (state.phase !== "all") groups = groups.filter((g) => g.phase === state.phase);
    // agent block then eval, kinds in fixed order, slowest median first
    // within each kind; error-only rows sink last within their group.
    const med = (g) => (g.n > 0 && g.median_ms != null ? g.median_ms : -1);
    const po = (p) => (p === "task" ? 0 : 1);
    const ko = (k) => {
      const i = KIND_ORDER.indexOf(k);
      return i < 0 ? KIND_ORDER.length : i;
    };
    groups.sort((a, b) =>
      po(a.phase) - po(b.phase) || ko(a.kind) - ko(b.kind) || med(b) - med(a));
    return groups;
  }

  // ── scale helpers ─────────────────────────────────────────────────────
  function makeScale(groups, x0, x1) {
    const values = [];
    groups.forEach((g) => {
      if (g.n > 0) values.push(g.p5_ms, g.p95_ms, g.min_ms, g.max_ms, g.mean_ms);
    });
    const finite = values.filter((v) => v != null && isFinite(v) && v > 0);
    let lo = Math.min.apply(null, finite.length ? finite : [1]);
    let hi = Math.max.apply(null, finite.length ? finite : [1000]);
    if (!(hi > lo)) hi = lo * 10;
    if (state.scale === "log") {
      const llo = Math.log10(Math.max(lo, 0.01));
      const lhi = Math.log10(hi);
      return {
        x: (v) => {
          const c = Math.max(v == null ? lo : v, 0.01);
          return x0 + ((Math.log10(c) - llo) / (lhi - llo || 1)) * (x1 - x0);
        },
        ticks: logTicks(lo, hi),
      };
    }
    const lin0 = 0;
    return {
      x: (v) => x0 + (((v == null ? 0 : v) - lin0) / (hi - lin0 || 1)) * (x1 - x0),
      ticks: linTicks(hi),
    };
  }

  function linTicks(hi) {
    const step = Math.pow(10, Math.floor(Math.log10(hi || 1)));
    const norm = hi / step;
    const inc = norm <= 2 ? step / 2 : norm <= 5 ? step : step * 2;
    const out = [];
    for (let v = 0; v <= hi * 1.001; v += inc) out.push(v);
    return out;
  }

  function logTicks(lo, hi) {
    const out = [];
    let d = Math.pow(10, Math.floor(Math.log10(Math.max(lo, 0.01))));
    while (d <= hi * 1.001) {
      if (d >= lo * 0.5) out.push(d);
      d *= 10;
    }
    return out.length >= 2 ? out : [lo, hi];
  }

  // Assemble aligned rows for by-run mode: union of (phase, kind, step)
  // keys across active runs, each row carrying one lane per active run
  // (null where a run lacks that step).
  function compareRows() {
    const keys = [];
    const seen = new Set();
    const bucket = state.runData[state.rollup] || {};
    state.activeSeries.forEach((key) => {
      (bucket[key] || []).forEach((g) => {
        if (state.phase !== "all" && g.phase !== state.phase) return;
        const key = g.phase + "|" + g.kind + "|" + g.step_type;
        if (!seen.has(key)) {
          seen.add(key);
          keys.push({ phase: g.phase, kind: g.kind, step_type: g.step_type });
        }
      });
    });
    const med = (g) => (g && g.n > 0 && g.median_ms != null ? g.median_ms : -1);
    const rows = keys.map((k) => {
      const lanes = state.activeSeries.map((key) =>
        (bucket[key] || []).find((g) =>
          g.phase === k.phase && g.kind === k.kind && g.step_type === k.step_type
        ) || null);
      return Object.assign({}, k, {
        lanes: lanes,
        bestMedian: Math.max(...lanes.map(med)),
      });
    });
    const po = (p) => (p === "task" ? 0 : 1);
    const ko = (k) => {
      const i = KIND_ORDER.indexOf(k);
      return i < 0 ? KIND_ORDER.length : i;
    };
    rows.sort((a, b) =>
      po(a.phase) - po(b.phase) || ko(a.kind) - ko(b.kind) ||
      b.bestMedian - a.bestMedian);
    return rows;
  }

  // ── SVG interval plot ─────────────────────────────────────────────────
  function plotSvg(groups) {
    const LABEL_W = 210;
    // annotation gutter sized to the widest annotation string (~6.6px/char)
    const annLen = Math.max(4, ...groups.map((g) => annPlain(g).length));
    const RIGHT_PAD = 24 + Math.ceil(annLen * 6.6);
    const ROW_H = 30;
    const HEADER_H = 22;
    const PHASE_HEADER_H = 30;
    const TOP = 26;
    const width = 860;

    // Two-level grouping (collapsible): one phase header encompassing its
    // kind sub-headers in By-step view; phase headers only in By-kind view.
    const items = groupedItems(groups);

    const bodyH = items.reduce((h, it) =>
      h + (it.header ? (it.level === 1 ? PHASE_HEADER_H : HEADER_H) : ROW_H), 0);
    const height = TOP + bodyH + 34;
    const x0 = LABEL_W;
    const x1 = width - RIGHT_PAD;
    const scale = makeScale(groups, x0, x1);

    let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + " " + height +
      '" width="100%" role="img" aria-label="Step latency interval plot" ' +
      'font-family="inherit" font-size="11">';

    // axis + gridlines
    scale.ticks.forEach((t) => {
      const tx = scale.x(t);
      s += '<line x1="' + tx + '" y1="' + (TOP - 6) + '" x2="' + tx + '" y2="' +
        (height - 28) + '" stroke="var(--border-color, #333)" stroke-width="1" opacity="0.5"/>';
      s += '<text x="' + tx + '" y="' + (height - 12) +
        '" text-anchor="middle" fill="var(--text-muted, #888)">' + FMT(t) + "</text>";
    });

    s += '<line x1="' + x0 + '" y1="' + (height - 28) + '" x2="' + x1 + '" y2="' +
      (height - 28) + '" stroke="var(--border-strong, #444)" stroke-width="1"/>';

    let yCur = TOP;
    items.forEach((it) => {
      if (it.header) {
        const h = it.level === 1 ? PHASE_HEADER_H : HEADER_H;
        s += headerMarkup(it, yCur, h, LABEL_W);
        yCur += h;
        return;
      }
      const g = it.row;
      const cy = yCur + ROW_H / 2;
      yCur += ROW_H;
      const color = PHASE_COLORS[g.phase] || "var(--text-primary, #ddd)";
      // headers carry phase/kind context; row labels stay bare
      const label = g.step_type;
      const ann = annMarkup(g);

      if (state.rollup === "kind") {
        // match the By-step kind sub-header styling: icon + uppercase label
        s += kindIconSvg(ICON_KEY[g.kind] || "DEFAULT", 24, cy - 5.5, 11);
        s += '<text x="40" y="' + (cy + 4) +
          '" font-size="10" letter-spacing="0.08em" font-weight="600" ' +
          'fill="var(--text-muted, #888)">' + esc(label.toUpperCase()) + "</text>";
      } else {
        const shown = label.length > 30 ? label.slice(0, 29) + "\u2026" : label;
        s += '<text x="' + (LABEL_W - 10) + '" y="' + (cy + 4) +
        '" text-anchor="end" fill="var(--text-primary, #ddd)">' +
        (shown !== label ? "<title>" + esc(label) + "</title>" : "") + esc(shown) + "</text>";
      }

      if (g.n > 0) {
        const p5 = scale.x(g.p5_ms), p25 = scale.x(g.p25_ms), p75 = scale.x(g.p75_ms),
          p95 = scale.x(g.p95_ms), med = scale.x(g.median_ms), mean = scale.x(g.mean_ms);
        const title = "<title>" + esc(g.step_type) + " (" + g.phase + ")\n" +
          "n=" + g.n + ", err=" + g.error_count + "\n" +
          "p5 " + FMT(g.p5_ms) + " \u00b7 p25 " + FMT(g.p25_ms) +
          " \u00b7 median " + FMT(g.median_ms) + " \u00b7 p75 " + FMT(g.p75_ms) +
          " \u00b7 p95 " + FMT(g.p95_ms) + "\nmean " + FMT(g.mean_ms) +
          " \u00b7 min " + FMT(g.min_ms) + " \u00b7 max " + FMT(g.max_ms) +
          (g.cv != null ? " \u00b7 cv " + g.cv.toFixed(2) : "") + "</title>";
        s += "<g>" + title +
          '<line x1="' + p5 + '" y1="' + cy + '" x2="' + p95 + '" y2="' + cy +
            '" stroke="' + color + '" stroke-width="1.5" opacity="0.55"/>' +
          '<rect x="' + p25 + '" y="' + (cy - 6) + '" width="' + Math.max(p75 - p25, 1.5) +
            '" height="12" rx="2" fill="' + color + '" opacity="0.75"/>' +
          '<line x1="' + med + '" y1="' + (cy - 8) + '" x2="' + med + '" y2="' + (cy + 8) +
            '" stroke="var(--text-primary, #fff)" stroke-width="2"/>' +
          '<path d="M ' + mean + " " + (cy - 5) + " l 5 5 l -5 5 l -5 -5 Z" +
            '" fill="none" stroke="' + color + '" stroke-width="1.5"/>' +
          "</g>";
      }

      s += '<text x="' + (x1 + 8) + '" y="' + (cy + 4) +
        '" fill="var(--text-muted, #888)">' + ann + "</text>";
    });

    s += "</svg>";
    return s;
  }

  function plotSvgByRun(rows) {
    const LABEL_W = 210;
    const laneCount = Math.max(state.activeSeries.length, 1);
    const annLen = Math.max(4, ...rows.flatMap((r) =>
      r.lanes.map((g) => (g ? annPlain(g).length : 0))));
    const RIGHT_PAD = 24 + Math.ceil(annLen * 6.2);
    const LANE_H = 16;
    const ROW_PAD = 8;
    const rowH = ROW_PAD + laneCount * LANE_H;
    const HEADER_H = 22;
    const PHASE_HEADER_H = 30;
    const TOP = 26;
    const width = 860;

    const items = groupedItems(rows);

    const bodyH = items.reduce((h, it) =>
      h + (it.header ? (it.level === 1 ? PHASE_HEADER_H : HEADER_H) : rowH), 0);
    const height = TOP + bodyH + 34;
    const x0 = LABEL_W;
    const x1 = width - RIGHT_PAD;
    const flat = rows.flatMap((r) => r.lanes).filter(Boolean);
    const scale = makeScale(flat, x0, x1);

    let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + width + " " + height +
      '" width="100%" role="img" aria-label="Step latency comparison by run" ' +
      'font-family="inherit" font-size="11">';
    scale.ticks.forEach((t) => {
      const tx = scale.x(t);
      s += '<line x1="' + tx + '" y1="' + (TOP - 6) + '" x2="' + tx + '" y2="' +
        (height - 28) + '" stroke="var(--border-color, #333)" stroke-width="1" opacity="0.5"/>';
      s += '<text x="' + tx + '" y="' + (height - 12) +
        '" text-anchor="middle" fill="var(--text-muted, #888)">' + FMT(t) + "</text>";
    });
    s += '<line x1="' + x0 + '" y1="' + (height - 28) + '" x2="' + x1 + '" y2="' +
      (height - 28) + '" stroke="var(--border-strong, #444)" stroke-width="1"/>';

    let yCur = TOP;
    items.forEach((it) => {
      if (it.header) {
        const h = it.level === 1 ? PHASE_HEADER_H : HEADER_H;
        s += headerMarkup(it, yCur, h, LABEL_W);
        yCur += h;
        return;
      }
      const r = it.row;
      const labelY = yCur + rowH / 2 + 4;
      if (state.rollup === "kind") {
        s += kindIconSvg(ICON_KEY[r.kind] || "DEFAULT", 24, labelY - 9.5, 11);
        s += '<text x="40" y="' + labelY +
          '" font-size="10" letter-spacing="0.08em" font-weight="600" ' +
          'fill="var(--text-muted, #888)">' + esc(r.step_type.toUpperCase()) + "</text>";
      } else {
        const shown = r.step_type.length > 30
          ? r.step_type.slice(0, 29) + "\u2026" : r.step_type;
        s += '<text x="' + (LABEL_W - 10) + '" y="' + labelY +
          '" text-anchor="end" fill="var(--text-primary, #ddd)">' +
          (shown !== r.step_type ? "<title>" + esc(r.step_type) + "</title>" : "") +
          esc(shown) + "</text>";
      }
      r.lanes.forEach((g, li) => {
        const cy = yCur + ROW_PAD / 2 + li * LANE_H + LANE_H / 2;
        const color = runColor(state.activeSeries[li]);
        if (!g || !(g.n > 0)) {
          if (g && g.error_count) {
            s += '<text x="' + (x1 + 8) + '" y="' + (cy + 3.5) +
              '" font-size="9.5" fill="var(--danger, #ef4444)">err=' +
              g.error_count + "</text>";
          }
          return;
        }
        const p5 = scale.x(g.p5_ms), p25 = scale.x(g.p25_ms), p75 = scale.x(g.p75_ms),
          p95 = scale.x(g.p95_ms), medX = scale.x(g.median_ms), meanX = scale.x(g.mean_ms);
        const title = "<title>" + esc(r.step_type) + " (" + r.phase + ") \u2014 " +
          esc(seriesLabel(state.activeSeries[li])) + "\nn=" + g.n + ", err=" + g.error_count +
          "\nmedian " + FMT(g.median_ms) + " \u00b7 mean " + FMT(g.mean_ms) +
          "\np5 " + FMT(g.p5_ms) + " \u00b7 p95 " + FMT(g.p95_ms) + "</title>";
        s += "<g>" + title +
          '<line x1="' + p5 + '" y1="' + cy + '" x2="' + p95 + '" y2="' + cy +
            '" stroke="' + color + '" stroke-width="1.2" opacity="0.55"/>' +
          '<rect x="' + p25 + '" y="' + (cy - 4) + '" width="' + Math.max(p75 - p25, 1.2) +
            '" height="8" rx="1.5" fill="' + color + '" opacity="0.8"/>' +
          '<line x1="' + medX + '" y1="' + (cy - 6) + '" x2="' + medX + '" y2="' + (cy + 6) +
            '" stroke="var(--text-primary, #fff)" stroke-width="1.6"/>' +
          '<path d="M ' + meanX + " " + (cy - 3.5) + ' l 3.5 3.5 l -3.5 3.5 l -3.5 -3.5 Z' +
            '" fill="none" stroke="' + color + '" stroke-width="1.2"/>' +
          "</g>";
        s += '<text x="' + (x1 + 8) + '" y="' + (cy + 3.5) +
          '" font-size="9.5" fill="' + color + '">' + annMarkup(g) + "</text>";
      });
      yCur += rowH;
    });
    s += "</svg>";
    return s;
  }
  // Shared legend: glyph samples + phase swatches.────────────────────────────────────────────────
  // Shared legend: glyph samples + phase swatches. Used by the in-app panel
  // (theme colors, follows the phase filter) and the SVG export (light palette).
  function legendMarkup(y, c, showAgent, showEval) {
    let lx = 16;
    let lh = "";
    lh += '<line x1="' + lx + '" y1="' + y + '" x2="' + (lx + 34) + '" y2="' + y +
      '" stroke="' + c.muted + '" stroke-width="1.5" opacity="0.7"/>';
    lh += '<text x="' + (lx + 40) + '" y="' + (y + 4) + '" font-size="11" fill="' +
      c.muted + '">p5\u2013p95</text>';
    lx += 96;
    lh += '<rect x="' + lx + '" y="' + (y - 6) + '" width="30" height="12" rx="2" fill="' +
      c.muted + '" opacity="0.75"/>';
    lh += '<text x="' + (lx + 36) + '" y="' + (y + 4) + '" font-size="11" fill="' +
      c.muted + '">p25\u2013p75</text>';
    lx += 100;
    lh += '<line x1="' + (lx + 6) + '" y1="' + (y - 8) + '" x2="' + (lx + 6) + '" y2="' +
      (y + 8) + '" stroke="' + c.text + '" stroke-width="2"/>';
    lh += '<text x="' + (lx + 16) + '" y="' + (y + 4) + '" font-size="11" fill="' +
      c.muted + '">median</text>';
    lx += 72;
    lh += '<path d="M ' + (lx + 6) + " " + (y - 5) + ' l 5 5 l -5 5 l -5 -5 Z" fill="none" stroke="' +
      c.muted + '" stroke-width="1.5"/>';
    lh += '<text x="' + (lx + 18) + '" y="' + (y + 4) + '" font-size="11" fill="' +
      c.muted + '">mean</text>';
    lx += 68;
    if (showAgent) {
      lh += '<rect x="' + lx + '" y="' + (y - 6) + '" width="12" height="12" rx="2" fill="' +
        c.agent + '"/>';
      lh += '<text x="' + (lx + 18) + '" y="' + (y + 4) + '" font-size="11" fill="' +
        c.muted + '">Agent</text>';
      lx += 66;
    }
    if (showEval) {
      lh += '<rect x="' + lx + '" y="' + (y - 6) + '" width="12" height="12" rx="2" fill="' +
        c.evalc + '"/>';
      lh += '<text x="' + (lx + 18) + '" y="' + (y + 4) + '" font-size="11" fill="' +
        c.muted + '">Eval</text>';
      lx += 60;
    }
    return { markup: lh, width: lx };
  }

  function runChipsHtml() {
    return '<div class="sl-run-chips">' + state.series.map((s) => {
      const on = state.activeSeries.indexOf(s.key) !== -1;
      const color = runColor(s.key);
      return '<button type="button" class="sl-run-chip' + (on ? " on" : "") +
        '" data-sl-run="' + esc(s.key) + '" title="' + esc(s.refs.join(", ")) + '"' +
        (on ? ' style="border-color:' + color + ';color:' + color + '"' : "") +
        '><span class="sl-run-dot"' +
        (on ? ' style="background:' + color + '"' : "") +
        "></span>" + esc(s.label) + "</button>";
    }).join("") + "</div>";
  }

  function seriesLegendMarkup(y, textColor, maxWidth, font) {
    let x = 16;
    let cy = y;
    let width = 0;
    let markup = "";
    const cs = getComputedStyle(container);
    const fontSize = cs.getPropertyValue("--font-sm").trim() || "11px";
    const fontFamily = cs.getPropertyValue("--font-sans").trim() || cs.fontFamily;
    const context = document.createElement("canvas").getContext("2d");
    if (context) context.font = font || fontSize + " " + fontFamily;
    const measure = (text) => context ? context.measureText(text).width : text.length * 11;
    const maxTextWidth = Math.max(1, maxWidth - 70);
    state.activeSeries.forEach((key) => {
      const label = seriesLabel(key);
      let shown = label;
      if (measure(label) > maxTextWidth) {
        const chars = Array.from(label);
        let lo = 0, hi = chars.length;
        while (lo < hi) {
          const mid = Math.ceil((lo + hi) / 2);
          if (measure(chars.slice(0, mid).join("") + "\u2026") <= maxTextWidth) lo = mid;
          else hi = mid - 1;
        }
        shown = chars.slice(0, lo).join("") + "\u2026";
      }
      const itemWidth = 38 + Math.ceil(measure(shown));
      if (x > 16 && x + itemWidth > maxWidth - 16) { x = 16; cy += 24; }
      markup += '<g><title>' + esc(label) + '</title><rect x="' + x + '" y="' +
        (cy - 6) + '" width="12" height="12" rx="2" fill="' + runColor(key) + '"/>' +
        '<text x="' + (x + 18) + '" y="' + (cy + 4) + '" fill="' + textColor +
        '">' + esc(shown) + '</text></g>';
      x += itemWidth;
      width = Math.max(width, x + 8);
    });
    return { markup: markup, width: width, height: cy - y + 28 };
  }

  function inAppLegend() {
    if (state.pooled) {
      const legend = seriesLegendMarkup(14, "var(--text-muted, #888)", 860);
      return '<svg viewBox="0 0 ' + legend.width + ' ' + legend.height +
        '" width="' + legend.width + '" height="' + legend.height +
        '" style="font-size:var(--font-sm)" xmlns="http://www.w3.org/2000/svg" role="img" ' +
        'aria-label="Run legend">' + legend.markup + "</svg>";
    }
    const legend = legendMarkup(
      14,
      {
        text: "var(--text-primary, #ddd)",
        muted: "var(--text-muted, #888)",
        agent: PHASE_COLORS.task,
        evalc: PHASE_COLORS.eval,
      },
      state.phase !== "eval",
      state.phase !== "task"
    );
    return '<svg viewBox="0 0 ' + (legend.width + 8) + ' 28" width="' + (legend.width + 8) +
      '" height="28" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Legend">' +
      legend.markup + "</svg>";
  }

  function seg(name, options, current, ariaLabel) {
    return '<div class="qym-segmented" role="group" aria-label="' + esc(ariaLabel || name) +
      '" data-qym-segmented-key="step-latency-' + name + '" data-sl-seg="' + name + '">' +
      options.map((o) =>
        '<button type="button" class="qym-segmented__option' +
        (o.value === current ? " active" : "") +
        '" aria-pressed="' + (o.value === current) +
        '" data-sl-val="' + o.value + '">' + o.label + "</button>"
      ).join("") + "</div>";
  }

  function render() {
    if (!container) return;
    let body;
    let emptySelection = false;
    if (state.error) {
      body = '<div class="sl-empty">Failed to load step latency: ' + esc(state.error) + "</div>";
    } else if (state.data == null) {
      body = '<div class="sl-empty">Loading\u2026</div>';
    } else if (state.pooled) {
      const bucket = state.runData[state.rollup] || {};
      const pending = state.activeSeries.some((key) => !bucket[key]);
      const rows = compareRows();
      let inner = "";
      if (rows.length) {
        inner = '<div class="sl-legend">' + inAppLegend() + "</div>" +
          '<div class="sl-plot">' + plotSvgByRun(rows) + "</div>";
      } else if (pending) {
        inner = '<div class="sl-empty">Loading\u2026</div>';
      } else {
        emptySelection = true;
      }
      body = runChipsHtml() + inner;
    } else {
      const groups = visibleGroups();
      body = groups.length
        ? '<div class="sl-legend">' + inAppLegend() + '</div>' +
          '<div class="sl-plot">' + plotSvg(groups) + "</div>"
        : "";
      emptySelection = !groups.length;
    }

    // Empty scopes disappear entirely. A local filter may still have data
    // elsewhere, so retain only its controls to let the user return to it.
    const canRecover = state.hasUnscopedGroups || (state.data || []).length > 0;
    container.style.display = emptySelection && !canRecover ? "none" : "";
    if (emptySelection && !canRecover) {
      container.innerHTML = "";
      return;
    }

    container.innerHTML =
      (emptySelection ? '<div class="sl-filter-controls">' : '<div class="metric-card sl-card">' +
      '<div class="ri-header"><div>' +
        '<h3 class="section-title">Step Latency Distributions</h3>' +
        '<div class="ri-header-copy">Percentile latency intervals per step. ' +
        "Errors are excluded from " +
        "distributions and counted separately.</div>" +
      "</div></div>") +
      '<div class="sl-controls">' +
        seg("phase", [
          { value: "all", label: "All" },
          { value: "task", label: "Agent" },
          { value: "eval", label: "Eval" },
        ], state.phase, "Phase filter") +
        (emptySelection ? "" : seg("rollup", [
          { value: "name", label: "By step" },
          { value: "kind", label: "By kind" },
        ], state.rollup, "Grouping") +
        seg("scale", [
          { value: "linear", label: "Linear" },
          { value: "log", label: "Log" },
        ], state.scale, "Axis scale")) +
        (state.passes.length > 1 && !state.passLocked && !state.pooled
          ? seg("passNum",
              state.passes.map((n) => ({ value: String(n), label: "Pass " + n }))
                .concat([{ value: "", label: "All" }]),
              state.passNum == null ? "" : String(state.passNum),
              "Repeat pass")
          : "") +
        (emptySelection ? "" : '<span class="sl-spacer"></span>' +
        '<a class="qym-inline-action qym-inline-action--accent sl-btn" href="' +
          esc(apiUrl({ format: "csv", rollup: state.rollup })) +
          '" download title="Download summary CSV">' + DL_ICON + "CSV summary</a>" +
        '<a class="qym-inline-action qym-inline-action--accent sl-btn" href="' +
          esc(apiUrl({ format: "csv", level: "spans" })) +
          '" download title="Download raw span CSV">' + DL_ICON + "CSV raw spans</a>" +
        '<button type="button" class="qym-inline-action qym-inline-action--accent sl-btn" ' +
          'data-sl-download-svg title="Download plot as SVG">' + DL_ICON + "SVG</button>") +
      "</div>" + body + "</div>";

    container.querySelectorAll("[data-sl-seg]").forEach((group) => {
      const name = group.getAttribute("data-sl-seg");
      group.querySelectorAll("[data-sl-val]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const val = btn.getAttribute("data-sl-val");
          const next = name === "passNum" ? (val === "" ? null : Number(val)) : val;
          if (state[name] === next) return;
          state[name] = next;
          if (name === "passNum") { state.cache = {}; state.runData = {}; }
          if (name === "rollup" || name === "passNum") {
            state.seq += 1;
            state.pending = {};
            state.runPending = {};
            refreshTraceStatsInset();
            fetchData();
          }
          else render();
        });
      });
    });

    // Collapse/expand a phase or kind group (pure client-side re-render).
    container.querySelectorAll("[data-sl-collapse]").forEach((node) => {
      node.addEventListener("click", () => {
        const key = node.getAttribute("data-sl-collapse");
        if (state.collapsed[key]) delete state.collapsed[key];
        else state.collapsed[key] = true;
        render();
      });
    });

    container.querySelectorAll("[data-sl-run]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const id = chip.getAttribute("data-sl-run");
        const idx = state.activeSeries.indexOf(id);
        if (idx === -1) {
          // keep lane order stable: follow the declared series order
          state.activeSeries = state.series
            .map((s) => s.key)
            .filter((k) => k === id || state.activeSeries.indexOf(k) !== -1);
        } else {
          state.activeSeries.splice(idx, 1);
        }
        const seq = state.seq;
        state.error = null;
        ensureRunData(seq).then(() => {
          if (seq === state.seq) render();
        }).catch((err) => {
          if (seq !== state.seq) return;
          state.error = String((err && err.message) || err);
          render();
        });
        render();
      });
    });

    const dl = container.querySelector("[data-sl-download-svg]");
    if (dl) {
      dl.addEventListener("click", () => {
        const svg = container.querySelector(".sl-plot svg");
        if (!svg) return;
        const blob = new Blob(
          ['<?xml version="1.0" encoding="UTF-8"?>\n' + exportableSvg(svg)],
          { type: "image/svg+xml" }
        );
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "step_latency.svg";
        a.click();
        URL.revokeObjectURL(a.href);
      });
    }
  }

  // The live SVG leans on qym's CSS variables, which don't exist outside the
  // app: a raw download degrades to fallback colors on a white page in a
  // serif font. For export, resolve every var() to its computed value, bake
  // in the theme background, and pin a sans font stack.
  function exportableSvg(svg) {
    const clone = svg.cloneNode(true);
    const cs = getComputedStyle(container);
    const LIGHT = {
      "--text-primary": "#1f2937",
      "--text-muted": "#6b7280",
      "--border-color": "#e5e7eb",
      "--border-strong": "#9ca3af",
      "--danger": "#dc2626",
    };
    const resolve = (value) =>
      value.replace(/var\((--[\w-]+)(?:,\s*([^)]+))?\)/g, (m, name, fb) => {
        if (LIGHT[name]) return LIGHT[name];
        const resolved = cs.getPropertyValue(name).trim();
        return resolved || (fb || "#6b7280").trim();
      });
    [clone, ...clone.querySelectorAll("*")].forEach((el) => {
      ["fill", "stroke"].forEach((attr) => {
        const v = el.getAttribute && el.getAttribute(attr);
        if (v && v.indexOf("var(") !== -1) el.setAttribute(attr, resolve(v));
      });
    });
    const exportFont = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
    clone.setAttribute("font-family", exportFont);
    const SVGNS = "http://www.w3.org/2000/svg";
    const vb = (clone.getAttribute("viewBox") || "0 0 860 400").split(/\s+/);
    const W = Number(vb[2]), H = Number(vb[3]);
    const TITLE_H = 40;
    const seriesLegend = state.pooled
      ? seriesLegendMarkup(TITLE_H + H + 48, "#6b7280", W, "11px " + exportFont) : null;
    const LEGEND_H = 44 + (seriesLegend ? seriesLegend.height : 0);
    const textColor = "#1f2937";
    const mutedColor = "#6b7280";
    const agentColor = resolve(PHASE_COLORS.task);
    const evalColor = "#7c3aed";

    // shift plot content down to make room for the title
    const inner = document.createElementNS(SVGNS, "g");
    inner.setAttribute("transform", "translate(0," + TITLE_H + ")");
    while (clone.firstChild) inner.appendChild(clone.firstChild);
    clone.appendChild(inner);
    clone.setAttribute("viewBox", "0 0 " + W + " " + (TITLE_H + H + LEGEND_H));

    const bg = document.createElementNS(SVGNS, "rect");
    bg.setAttribute("x", 0);
    bg.setAttribute("y", 0);
    bg.setAttribute("width", W);
    bg.setAttribute("height", TITLE_H + H + LEGEND_H);
    bg.setAttribute("fill", "#ffffff");
    clone.insertBefore(bg, inner);

    const title = document.createElementNS(SVGNS, "g");
    title.innerHTML =
      '<text x="16" y="26" font-size="15" font-weight="700" fill="' + textColor +
        '">Step Latency Distributions</text>';
    clone.appendChild(title);

    // legend via the shared builder (light palette, filter-aware)
    const ly = TITLE_H + H + 22;
    const legend = document.createElementNS(SVGNS, "g");
    legend.innerHTML = legendMarkup(
      ly,
      { text: textColor, muted: mutedColor, agent: agentColor, evalc: evalColor },
      !state.pooled && state.phase !== "eval",
      !state.pooled && state.phase !== "task"
    ).markup + (seriesLegend ? seriesLegend.markup : "");
    clone.appendChild(legend);
    return clone.outerHTML;
  }

  function injectStyles() {
    if (document.getElementById("sl-styles")) return;
    const css =
      ".sl-card{padding:var(--space-md, 16px)}" +
      ".sl-card .ri-header{margin-bottom:var(--space-sm, 10px)}" +
      ".sl-controls{display:flex;align-items:center;gap:var(--space-sm, 10px);" +
        "flex-wrap:wrap;margin:0 0 var(--space-md, 14px)}" +
      ".sl-spacer{flex:1}" +
      ".sl-btn{display:inline-flex;align-items:center;gap:6px;" +
        "text-decoration:none;cursor:pointer}" +
      ".sl-empty{color:var(--text-muted,#888);padding:18px 0;" +
        "font-size:var(--font-sm, 13px)}" +
      ".sl-plot{overflow-x:auto}" +
      ".sl-run-chips{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 10px}" +
      ".sl-run-chip{display:inline-flex;align-items:center;gap:7px;" +
        "height:var(--control-height,28px);padding:0 12px;" +
        "background:var(--bg-elevated,#1c1c22);border:1px solid " +
        "var(--border-default,#333);border-radius:999px;cursor:pointer;" +
        "color:var(--text-muted,#888);font-size:var(--font-sm,12px);font-weight:600}" +
      ".sl-run-chip:not(.on):hover{border-color:var(--border-strong,#555)}" +
      ".sl-run-dot{width:9px;height:9px;border-radius:50%;" +
        "background:var(--border-strong,#555)}" +
      ".sl-ts-expandable{cursor:pointer;position:relative}" +
      ".sl-ts-chev{position:absolute;top:10px;right:10px;" +
        "color:var(--text-muted,#888);transition:transform .15s}" +
      ".sl-ts-active .sl-ts-chev{transform:rotate(180deg)}" +
      ".sl-ts-active{outline:1px solid var(--accent-primary,#34d399);" +
        "outline-offset:-1px;border-radius:var(--control-radius,8px)}" +
      ".sl-ts-inset{margin-top:var(--space-sm,8px);padding:var(--space-sm,10px) " +
        "var(--space-md,14px);background:var(--bg-elevated,#17171d);" +
        "border:1px solid var(--border-color,#2a2a31);" +
        "border-radius:var(--control-radius,8px)}" +
      ".sl-ts-rows{display:grid;grid-template-columns:repeat(auto-fill," +
        "minmax(280px,1fr));gap:2px var(--space-lg,20px)}" +
      ".sl-ts-row{display:flex;align-items:center;justify-content:space-between;" +
        "padding:5px 0;font-size:var(--font-sm,12px)}" +
      ".sl-ts-name{display:inline-flex;align-items:center;gap:8px;" +
        "color:var(--text-primary,#ddd)}" +
      ".sl-ts-val{color:var(--text-primary,#ddd);font-weight:600}" +
      ".sl-ts-sub{margin-left:8px;color:var(--text-muted,#888);font-weight:400}" +
      ".sl-ts-empty{color:var(--text-muted,#888);font-size:var(--font-sm,12px)}" +
      ".sl-legend{margin:0 0 4px;overflow-x:auto}" +
      ".sl-legend svg text{font-family:var(--font-sans, inherit)}" +
      ".sl-plot svg text{font-family:var(--font-sans, inherit)}";
    const style = document.createElement("style");
    style.id = "sl-styles";
    style.textContent = css;
    document.head.appendChild(style);
  }

  // ── Trace Stats enhancer ─────────────────────────────────────────────
  // Augments the run page's Trace Stats tiles with expandable per-step
  // breakdowns computed from the same step-latency data. Tile headlines are
  // untouched (they come from ingestion aggregates); the accordion adds
  // step-level depth on demand. Task-phase groups feed the usage tiles,
  // mirroring ingestion's exclusion of metric-scope spans from usage stats.
  const TILE_BREAKDOWNS = {
    "Avg Tokens": { kind: "LLM", mode: "tokens" },
    "Avg LLM Calls": { kind: "LLM", mode: "calls" },
    "Avg Tool Calls": { kind: "TOOL", mode: "calls" },
    "Avg LLM Latency": { kind: "LLM", mode: "latency" },
    "Avg Tool Latency": { kind: "TOOL", mode: "latency" },
    "Avg Retriever Latency": { kind: "RETRIEVER", mode: "latency" },
    "Tool Success": { kind: "TOOL", mode: "success" },
  };
  let _tsInset = null;
  let _tsOpenLabel = null;
  let _tsFolded = [];   // [{label, value}] tiles folded into Trace Latency
  let _tsTimer = null;  // singleton retry timer: mount() can run repeatedly
  let _tsBindings = [];

  function resetTraceStats() {
    if (_tsTimer) clearInterval(_tsTimer);
    _tsTimer = null;
    if (_tsInset) _tsInset.remove();
    _tsInset = null;
    _tsOpenLabel = null;
    _tsBindings.forEach(({ pill, handler }) => {
      pill.removeEventListener("click", handler);
      pill.removeAttribute("data-sl-ts");
      pill.classList.remove("sl-ts-expandable", "sl-ts-active");
      const chevron = pill.querySelector(".sl-ts-chev");
      if (chevron) chevron.remove();
    });
    _tsBindings = [];
    _tsFolded.forEach(({ pill, display }) => {
      pill.style.display = display;
      pill.removeAttribute("data-sl-folded");
    });
    _tsFolded = [];
  }

  function _tileLabel(pill) {
    const labelEl = pill.querySelector(
      ".trace-pill-label, .stat-label, .qym-stat-label, h4");
    if (labelEl) return (labelEl.textContent || "").trim();
    const text = (pill.textContent || "").trim();
    return text.split("\n")[0].trim();
  }

  function _breakdownRows(spec) {
    const groups = (state.cache.name || []).filter(
      (g) => g.phase === "task" && g.kind === spec.kind &&
        (spec.mode !== "latency" || g.n > 0) &&
        (spec.mode !== "tokens" || g.tokens_total > 0 ||
          g.tokens_prompt > 0 || g.tokens_completion > 0));
    const tc = state.traceCount || 1;
    const rows = groups.map((g) => {
      const calls = g.n + g.error_count;
      if (spec.mode === "calls") {
        const sub = ["per trace"];
        if (g.error_count) {
          sub.push("err " + Math.round(100 * g.error_count / calls) + "%");
        }
        return { name: g.step_type, iconKey: ICON_KEY[g.kind] || "DEFAULT",
          value: (calls / tc).toFixed(1),
          sub: sub.join(" \u00b7 ") };
      }
      if (spec.mode === "tokens") {
        const per = (v) => Math.round((v || 0) / tc).toLocaleString();
        return { name: g.step_type, iconKey: ICON_KEY[g.kind] || "DEFAULT",
          value: per(g.tokens_total),
          sub: "prompt " + per(g.tokens_prompt) +
            " \u00b7 completion " + per(g.tokens_completion) };
      }
      if (spec.mode === "success") {
        return { name: g.step_type, iconKey: ICON_KEY[g.kind] || "DEFAULT",
          value: calls ? Math.round(100 * g.n / calls) + "%" : "\u2014",
          sub: "n=" + calls };
      }
      return { name: g.step_type, iconKey: ICON_KEY[g.kind] || "DEFAULT",
        value: "median " + FMT(g.median_ms),
        sub: "mean " + FMT(g.mean_ms) + " \u00b7 n=" + g.n };
    });
    rows.sort((a, b) => (a.name < b.name ? -1 : 1));
    return rows;
  }

  function _insetHtml(label) {
    let rows;
    if (label !== "Avg Trace Latency" && !state.cache.name) {
      return '<div class="sl-ts-empty">' +
        (state.error ? "Breakdown unavailable." : "Loading\u2026") + "</div>";
    }
    if (label === "Avg Trace Latency") {
      rows = _tsFolded.filter((f) => f.value && f.value !== "\u2014").map((f) => ({
        name: f.label.replace(/^Avg\s+/i, "").replace(/\s+latency$/i, ""),
        iconKey: /evaluator/i.test(f.label) ? "EVALUATOR" : "AGENT",
        value: f.value, sub: "" }));
    } else {
      rows = _breakdownRows(TILE_BREAKDOWNS[label]);
    }
    if (!rows.length) return "";
    return '<div class="sl-ts-rows">' + rows.map((r) =>
      '<div class="sl-ts-row">' +
        '<span class="sl-ts-name">' +
          '<svg viewBox="0 0 16 16" width="12" height="12" style="color:' +
            (SL_KIND_COLORS[r.iconKey] || SL_KIND_COLORS.DEFAULT) + '">' +
            (SL_ICONS[r.iconKey] || SL_ICONS.DEFAULT)
              .replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "") +
          "</svg>" +
          esc(r.name) + "</span>" +
        '<span class="sl-ts-val">' + esc(r.value) +
          (r.sub ? '<span class="sl-ts-sub">' + esc(r.sub) + "</span>" : "") +
        "</span></div>"
    ).join("") + "</div>";
  }

  function _toggleInset(label, strip) {
    if (_tsOpenLabel === label) {
      _tsOpenLabel = null;
      if (_tsInset) { _tsInset.remove(); _tsInset = null; }
    } else {
      _tsOpenLabel = label;
      if (!_tsInset) {
        _tsInset = document.createElement("div");
        _tsInset.className = "sl-ts-inset";
        strip.insertAdjacentElement("afterend", _tsInset);
      }
    }
    refreshTraceStatsInset();
  }

  function _safeInsetHtml(label) {
    try {
      return _insetHtml(label);
    } catch (err) {
      console.error("[step-latency] inset render failed:", err);
      return '<div class="sl-ts-empty">Breakdown unavailable.</div>';
    }
  }

  function refreshTraceStatsInset() {
    if (_tsOpenLabel && _tsInset) {
      const markup = _safeInsetHtml(_tsOpenLabel);
      if (markup) _tsInset.innerHTML = markup;
      else {
        _tsInset.remove();
        _tsInset = null;
        _tsOpenLabel = null;
      }
    }
    _tsBindings.forEach(({ pill }) => {
      const label = pill.getAttribute("data-sl-ts");
      const available = !!_safeInsetHtml(label);
      pill.classList.toggle("sl-ts-expandable", available);
      pill.classList.toggle("sl-ts-active", available && label === _tsOpenLabel);
      const chevron = pill.querySelector(".sl-ts-chev");
      if (chevron) chevron.style.display = available ? "" : "none";
    });
  }

  function enhanceTraceStats() {
    if (state.pooled) return; // run page only
    if (_tsTimer) clearInterval(_tsTimer);
    let tries = 0;
    _tsTimer = setInterval(() => {
      tries += 1;
      const strip = document.querySelector(".trace-pills-row.qym-stat-strip");
      if (!strip) {
        if (tries > 40) { clearInterval(_tsTimer); _tsTimer = null; }
        return;
      }
      clearInterval(_tsTimer);
      _tsTimer = null;
      Array.from(strip.children).forEach((pill) => {
        try {
          if (pill.hasAttribute("data-sl-ts") ||
              pill.hasAttribute("data-sl-folded")) return;
          const label = _tileLabel(pill);
          const foldable = /^Avg\s+.+\s+latency$/i.test(label) &&
            !(label in TILE_BREAKDOWNS) && label !== "Avg Trace Latency";
          if (foldable) {
            const valEl = pill.querySelector(".trace-pill-val");
            _tsFolded.push({
              label: label,
              value: (valEl ? valEl.textContent : "").trim() || "\u2014",
              pill: pill,
              display: pill.style.display,
            });
            pill.setAttribute("data-sl-folded", "1");
            pill.style.display = "none";
            return;
          }
          const expandable = (label in TILE_BREAKDOWNS) ||
            label === "Avg Trace Latency";
          if (!expandable) return;
          pill.setAttribute("data-sl-ts", label);
          pill.classList.add("sl-ts-expandable");
          pill.insertAdjacentHTML("beforeend",
            '<svg class="sl-ts-chev" viewBox="0 0 16 16" width="12" height="12" ' +
            'fill="none" stroke="currentColor" stroke-width="1.7" ' +
            'stroke-linecap="round" aria-hidden="true">' +
            '<path d="M4 6.5 8 10.5 12 6.5"/></svg>');
          const handler = () => _toggleInset(label, strip);
          pill.addEventListener("click", handler);
          _tsBindings.push({ pill: pill, handler: handler });
        } catch (err) {
          console.error("[step-latency] pill enhance failed:", err, pill);
        }
      });
      refreshTraceStatsInset();
    }, 250);
  }

  window.QymStepLatency = {
    mount(el, runIds, opts) {
      if (!el || !runIds || !runIds.length) return;
      resetTraceStats();
      container = el;
      state.seq += 1;
      state.runData = {};
      state.cache = {};
      state.pending = {};
      state.runPending = {};
      state.data = null;
      state.error = null;
      state.passes = [];
      state.traceCount = 0;
      state.hasUnscopedGroups = false;
      state.runIds = runIds.map(String);
      state.pooled = (opts && typeof opts.pooled === "boolean")
        ? opts.pooled
        : runIds.length > 1;
      // Pass scope: the all-passes run page and the compare page get the
      // pass toggle (default All). A pass-scoped run page (?pass=N) is a
      // single-pass view: lock to that pass and show no toggle.
      state.passLocked = false;
      if (state.pooled) {
        state.passNum = null;
      } else {
        const raw = parseInt(
          new URLSearchParams(window.location.search).get("pass") || "", 10);
        if (Number.isFinite(raw) && raw > 0) {
          state.passNum = raw;
          state.passLocked = true;
        } else {
          state.passNum = null;
        }
      }
      // A lane is a "series": one run by default, or one cohort when the
      // compare page is in cohort mode (aggregate of that cohort's runs).
      const cohorts = opts && Array.isArray(opts.cohorts) ? opts.cohorts : null;
      if (state.pooled && cohorts && cohorts.length) {
        state.series = cohorts
          .filter((c) => c && Array.isArray(c.runIds) && c.runIds.length)
          .map((c, i) => ({
            key: "cohort:" + i,
            label: String(c.label || "Cohort " + String.fromCharCode(65 + i)),
            refs: c.runIds.map(String),
          }));
      } else {
        state.series = runIds.map((id, i) => ({
          key: String(id),
          label: String((opts && opts.runLabels && opts.runLabels[id]) || "Run " + (i + 1)),
          refs: [String(id)],
        }));
      }
      state.activeSeries = state.pooled ? state.series.map((s) => s.key) : [];
      injectStyles();
      fetchData();
      enhanceTraceStats();
    },
  };
})();
