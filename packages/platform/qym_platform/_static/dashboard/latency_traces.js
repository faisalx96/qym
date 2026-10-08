/* Latency and traces: the run page section that answers how long each item
   takes end to end (Response time) and where every trace spends that time
   (Inside the traces).

   window.QymLatencyTraces = {
     mount(panel, { runId, passNumber, offline }),  // once per load; fetches trace timings
                                           // (an offline export has none to fetch)
     update(opts),                         // every overview render (filters)
     reload({ quiet }),                    // a live run ended: fetch again
   }

   update(opts):
     items         [{ id, latency, error, scores: { metric: value|null } }]
                   every item the page filters keep, except the latency filter
     metrics       [{ name, direction, threshold, isBoolean }] quality metrics
     metric        the page's selected metric (the scatter's default)
     latencyFilter { min, max } | null, the page's latency filter
     passes        { count, current } | null for a single-pass run
     expectTraces  the run recorded spans: wait for its trace timings in view
     aside         the section header's aside element
     onLatencyFilter(range | null), onOpenItem(id), onPass(number | null),
     onVisibility(visible)

   Trace timings come from /api/runs/step-latency?rollup=site: LLM calls by
   call site (span name and model), each step's sub-agent, the phase and
   sub-agent spans, and whole traces. Every colour, size and font is a token
   (docs/DESIGN_LANGUAGE.md); styles live in latency_traces.css. */
(function () {
  'use strict';

  // ── Format ──
  const fmtMs = ms => {
    if (!Number.isFinite(ms)) return '—';
    if (ms >= 60000) return (ms / 60000).toFixed(1) + 'm';
    if (ms >= 10000) return (ms / 1000).toFixed(1) + 's';
    if (ms >= 1000) return (ms / 1000).toFixed(2) + 's';
    return Math.round(ms) + 'ms';
  };
  // A duration as [value, unit], for values drawn with a small unit.
  const durParts = ms => (!Number.isFinite(ms) ? ['—', '']
    : ms >= 1000 ? [(ms / 1000).toFixed(ms >= 100000 ? 0 : 1), 's'] : [String(Math.round(ms)), 'ms']);
  const durText = ms => durParts(ms).join(' ');
  const durHtml = ms => { const [v, u] = durParts(ms); return esc(v) + (u ? '<small>' + u + '</small>' : ''); };
  const fmtK = n => n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'K' : String(Math.round(n));
  const fmtInt = n => Math.round(n).toLocaleString('en-US');
  const pct = (a, b) => (b ? 100 * a / b : 0);
  const quantile = (sorted, q) => {
    const pos = (sorted.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  };
  const trimNum = v => String(Number(v.toFixed(2)));
  const tickLabel = t => (t === 0 ? '0' : t >= 1000 ? trimNum(t / 1000) + 's' : trimNum(t) + 'ms');
  // The smallest round step (1, 2, 2.5, 5 × 10ⁿ) that fits ``range`` in at most ``count`` steps.
  const niceStep = (range, count) => {
    const raw = Math.max(range, 1e-9) / count, mag = Math.pow(10, Math.floor(Math.log10(raw)));
    return [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= raw - 1e-12);
  };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  // One shared escaping rule (qym_safe.js): & < > " ' in text and attributes.
  function esc(value) {
    return window.QymSafe.escapeHtml(value == null ? '' : String(value));
  }

  // ── Kinds: one colour per kind of work, used by every block ──
  const FAMILY_OF = {
    LLM: 'LLM', TOOL: 'TOOL', RETRIEVER: 'RETRIEVAL', EMBEDDING: 'RETRIEVAL', RERANKER: 'RETRIEVAL',
    GUARDRAIL: 'GUARD',
  };
  const familyOf = kind => FAMILY_OF[kind] || 'OTHER';
  const FAMILY = {
    LLM: { label: 'LLM', glyph: '🧠', tone: 'var(--k-llm)' },
    RETRIEVAL: { label: 'Retrieval', glyph: '🔎', tone: 'var(--k-retrieval)' },
    TOOL: { label: 'Tools', glyph: '🔧', tone: 'var(--k-tool)' },
    GUARD: { label: 'Guardrails', glyph: '🛡', tone: 'var(--k-guard)' },
    OTHER: { label: 'Other', glyph: '⚙', tone: 'var(--k-other)' },
    // Not a kind of span: the eval phase's panel (judges and scorers).
    EVAL: { label: 'Eval', glyph: '★', tone: 'var(--k-eval)' },
  };
  const FAMILY_ORDER = ['LLM', 'RETRIEVAL', 'TOOL', 'GUARD', 'OTHER'];
  const AGENT_SVG = '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="4" r="3" fill="currentColor"/><path d="M2.5 14.5c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5z" fill="currentColor" opacity=".75"/></svg>';
  const PHASE = {
    task: { label: 'Agent', tone: 'var(--k-agent)', glyph: AGENT_SVG },
    eval: { label: 'Eval', tone: 'var(--k-eval)', glyph: '★' },
  };
  const glyph = (g, tone, sm) => '<span class="lt-glyph' + (sm ? ' lt-glyph--sm' : '') + '" style="--tone:' + tone + '" aria-hidden="true">' + g + '</span>';
  const CHEV = '<svg class="lt-chev" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const DD_CHEV = '<svg class="qym-item-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 6.25 8 9.75l3.5-3.5"></path></svg>';
  const DOWN_SVG = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 3.75 5 6.25l2.5-2.5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const EXPORT_SVG = '<svg class="qym-item-control-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8"/><path d="m4.5 7 3.5 3.5L11.5 7"/><path d="M3 13.5h10"/></svg>';

  // ── State ──
  const ui = {
    metric: null, budget: 'phase', group: 'name',
    // Spans (tens of seconds) and calls (milliseconds) share one axis: Log
    // keeps both readable; Linear stays one click away.
    scale: 'log',
    open: new Set(), sort: { key: 'time', dir: -1 }, query: '', kindOpen: null,
  };
  const S = {
    panel: null, runId: null, passNumber: null, opts: null,
    data: null, error: null, seq: 0, loading: false,
    L: null, dots: [], scatterItems: [],
  };
  const $ = name => S.panel && S.panel.querySelector('[data-lt="' + CSS.escape(name) + '"]');

  // ── Tooltip: one per page, kept across in-app navigations ──
  let tip = null;
  function tipEl() {
    if (!tip || !tip.isConnected) tip = document.querySelector('body > .lt-tip');
    if (!tip) {
      tip = document.createElement('div');
      tip.className = 'lt-tip';
      tip.setAttribute('role', 'tooltip');
      document.body.appendChild(tip);
    }
    return tip;
  }
  function showTip(e, title, rows, hint) {
    const t = tipEl();
    t.innerHTML = '<div class="lt-tip__title">' + title + '</div>' +
      (rows && rows.length ? '<div class="lt-tip__grid">' + rows.map(([k, v]) => '<span>' + k + '</span><span>' + v + '</span>').join('') + '</div>' : '') +
      (hint ? '<div class="lt-tip__hint">' + hint + '</div>' : '');
    t.classList.add('is-on');
    moveTip(e);
  }
  function moveTip(e) {
    if (!tip) return;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  const hideTip = () => { if (tip) tip.classList.remove('is-on'); };
  function bindTip(node, fn) {
    node.addEventListener('mouseenter', fn);
    node.addEventListener('mousemove', moveTip);
    node.addEventListener('mouseleave', hideTip);
  }

  // ── Dropdown: the item-dropdown trigger with a listbox menu ──
  function dropdown(host, options, selected, onPick, label) {
    host.className = 'lt-dd';
    host.innerHTML = '<button type="button" class="qym-item-dropdown qym-control" aria-haspopup="listbox" aria-expanded="false"' +
      (label ? ' aria-label="' + esc(label) + '"' : '') + '><span>' + esc(options[selected]) + '</span>' + DD_CHEV + '</button>' +
      '<div class="lt-dd__menu" role="listbox">' + options.map((o, i) =>
        '<button type="button" class="lt-dd__option" role="option" data-i="' + i + '" aria-selected="' + (i === selected) + '">' + esc(o) + '</button>').join('') + '</div>';
    const trigger = host.firstElementChild;
    const close = focus => {
      host.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      if (focus) trigger.focus();
    };
    trigger.addEventListener('click', e => {
      e.stopPropagation();
      const open = !host.classList.contains('is-open');
      closeDropdowns(host);
      host.classList.toggle('is-open', open);
      trigger.setAttribute('aria-expanded', String(open));
      if (open) { const sel = host.querySelector('[aria-selected="true"]'); if (sel) sel.focus(); }
    });
    host.querySelectorAll('.lt-dd__option').forEach(opt => opt.addEventListener('click', e => {
      e.stopPropagation();
      close(true);
      onPick(Number(opt.dataset.i));
    }));
    host.addEventListener('keydown', e => {
      if (!host.classList.contains('is-open')) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const opts = Array.from(host.querySelectorAll('.lt-dd__option'));
        const i = opts.indexOf(document.activeElement);
        opts[(i + (e.key === 'ArrowDown' ? 1 : opts.length - 1)) % opts.length].focus();
      }
    });
  }
  function closeDropdowns(except) {
    document.querySelectorAll('.lt-dd.is-open').forEach(d => {
      if (d === except) return;
      d.classList.remove('is-open');
      d.firstElementChild.setAttribute('aria-expanded', 'false');
    });
  }
  // In-app navigation runs this file again on each visit: one outside-click
  // listener per window, never one per visit.
  if (!window.__qymLatencyTracesClicks) {
    window.__qymLatencyTracesClicks = true;
    document.addEventListener('click', e => {
      closeDropdowns(null);
      document.querySelectorAll('.lt-export[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; });
    });
  }

  function segmented(host, options, value, onPick, label) {
    host.className = 'qym-segmented';
    host.setAttribute('role', 'group');
    if (label) host.setAttribute('aria-label', label);
    host.innerHTML = options.map(([v, l]) => '<button type="button" class="qym-segmented__option' + (v === value ? ' active' : '') +
      '" data-v="' + v + '" aria-pressed="' + (v === value) + '">' + l + '</button>').join('');
    host.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => {
      host.querySelectorAll('[data-v]').forEach(o => {
        o.classList.toggle('active', o === b);
        o.setAttribute('aria-pressed', String(o === b));
      });
      onPick(b.dataset.v);
    }));
  }

  // ── Skeleton, built once per mount ──
  function skeleton() {
    return '<div class="lt">' +
      '<div class="lt-sub" data-lt="response">' +
        '<div class="ri-subhead"><h4>Response time</h4><span>End-to-end latency of each item, and what speed costs in quality.</span></div>' +
        '<div class="lt-grid lt-grid--response" data-lt="response-grid">' +
          '<article class="metric-card lt-card" data-lt="dist-card">' +
            '<div class="lt-card__head"><div class="lt-card__titles">' +
              '<div class="lt-card__title">Latency distribution</div>' +
              '<div class="lt-card__desc">Each item’s run time, without evaluation. Click or drag across bars to filter the page.</div>' +
            '</div><button type="button" class="qym-chip active lt-hist-chip" data-lt="hist-chip" hidden aria-label="Clear the latency filter">' +
              '<span data-lt="hist-chip-text"></span><span class="qym-chip__remove" aria-hidden="true">×</span></button></div>' +
            '<div class="lt-lathead" data-lt="dist-kpis"></div>' +
            '<div class="lt-hist" data-lt="hist"></div>' +
          '</article>' +
          '<article class="metric-card lt-card" data-lt="qvl-card">' +
            '<div class="lt-card__head"><div class="lt-card__titles">' +
              '<div class="lt-card__title">Quality vs latency</div>' +
              '<div class="lt-card__desc">One dot per item.</div>' +
            '</div><div data-lt="qvl-metric"></div></div>' +
            '<div class="lt-legend">' +
              '<span><i class="sw-zone sw-zone--good"></i>Fast and passing</span>' +
              '<span><i class="sw-zone sw-zone--bad"></i>Slow and failing</span>' +
              '<span><i class="sw-pass"></i><span data-lt="pass-label"></span></span>' +
              '<span><i class="sw-line"></i>Median latency</span>' +
              '<span><i class="sw-ring"></i>Task error</span>' +
            '</div>' +
            '<div class="lt-scatter" data-lt="scatter"></div>' +
          '</article>' +
        '</div>' +
      '</div>' +
      '<div class="lt-sub" data-lt="inside" hidden>' +
        '<div class="ri-subhead"><h4>Inside the traces</h4><span data-lt="inside-desc"></span></div>' +
        '<div class="lt-state" data-lt="inside-state" hidden></div>' +
        '<article class="metric-card lt-card" data-lt="budget-card">' +
          '<div class="lt-card__head"><div class="lt-card__titles"><div class="lt-card__title">Time budget</div></div>' +
            '<div data-lt="budget-mode"></div></div>' +
          '<div class="lt-anatomy">' +
            '<div class="lt-budget-summary" data-lt="budget-summary"></div>' +
            '<div class="lt-brackets" data-lt="brackets"></div>' +
            '<div class="lt-bar is-loading" data-lt="bar" role="img" aria-label="Time budget of an average trace"></div>' +
            '<div class="lt-budget-legend" data-lt="budget-legend"></div>' +
          '</div>' +
          '<div class="lt-kinds" data-lt="kinds"></div>' +
        '</article>' +
        '<article class="metric-card lt-card lt-steps-card" data-lt="steps-card">' +
          '<div class="lt-card__head">' +
            '<div class="lt-card__titles"><div class="lt-card__title">Step timings</div>' +
              '<div class="lt-card__desc">How long one call of each step takes, and how much it varies.</div></div>' +
            '<div class="lt-card__tools">' +
              '<input type="search" class="lt-search" data-lt="search" placeholder="Find a step or model" aria-label="Find a step or model">' +
              '<div data-lt="group"></div><div data-lt="scale"></div>' +
              '<details class="lt-export"><summary class="qym-inline-action qym-inline-action--accent" title="Export step timings">' + EXPORT_SVG + 'Export</summary>' +
                '<div class="lt-dd__menu lt-export__menu" role="menu">' +
                  '<a class="lt-export__item" data-lt="csv-summary" role="menuitem" download>CSV summary</a>' +
                  '<a class="lt-export__item" data-lt="csv-spans" role="menuitem" download>CSV raw spans</a>' +
                  '<button type="button" class="lt-export__item" data-lt="svg" role="menuitem">SVG plot</button>' +
                '</div></details>' +
            '</div>' +
          '</div>' +
          '<div class="lt-steps" data-lt="steps"></div>' +
          '<div class="lt-steps__foot">' +
            '<span class="k"><i class="k-whisker"></i>p5–p95</span>' +
            '<span class="k"><i class="k-box"></i>middle 50%</span>' +
            '<span class="k"><i class="k-med"></i>median</span>' +
            '<span class="k"><i class="k-mean"></i>mean</span>' +
            '<span class="lt-steps__note">Errors are counted, not timed.</span>' +
          '</div>' +
        '</article>' +
      '</div>' +
    '</div>';
  }

  // ═══════ Response time ═══════
  function renderResponse() {
    const o = S.opts || {};
    const items = (o.items || []).filter(it => Number.isFinite(it.latency) && it.latency >= 0);
    const host = $('response');
    host.hidden = items.length === 0;
    if (!items.length) { S.L = null; return; }
    renderDistribution(items);
    renderQuality(items);
  }

  function renderDistribution(items) {
    const o = S.opts;
    const lat = items.map(it => it.latency).sort((a, b) => a - b);
    const L = S.L = {
      min: lat[0], max: lat[lat.length - 1],
      p50: quantile(lat, 0.5), p90: quantile(lat, 0.9), p95: quantile(lat, 0.95),
      mean: lat.reduce((a, b) => a + b, 0) / lat.length,
    };
    // The mean as the hero, then the latency spectrum: fastest → slowest on
    // the bars' own colour ramp, with p50, p90 and p95 pinned where they
    // fall. Hovering a pin lights the bars holding items beyond it.
    const span = L.max - L.min;
    const pos = ms => (span > 0 ? 100 * (ms - L.min) / span : 50);
    const pins = [
      { key: 'p50', ms: L.p50, tone: 'var(--text-primary)', word: 'Slower half', level: 1 },
      { key: 'p90', ms: L.p90, tone: 'var(--score-3)', word: 'Slowest 10%', level: 2 },
      { key: 'p95', ms: L.p95, tone: 'var(--score-2)', word: 'Slowest 5%', level: 3 },
    ];
    pins.forEach(pin => { pin.x = pos(pin.ms); });
    // Pins close together share one chip, joined to the track by a bracket,
    // so the spectrum always needs a single row of labels.
    const sets = [];
    pins.forEach(pin => {
      const last = sets[sets.length - 1];
      if (last && pin.x - last[last.length - 1].x < 14) last.push(pin); else sets.push([pin]);
    });
    const pinHtml = set => {
      const a = set[0].x, b = set[set.length - 1].x, c = (a + b) / 2, multi = set.length > 1;
      return '<div class="lt-pinset' + (multi ? ' is-multi' : '') + '" style="--a:' + a + ';--b:' + b + ';--c:' + c + '">' +
        // Near an end the chip rests against that edge; its stems stay put.
        '<span class="lt-pinchip' + (c > 78 ? ' is-end' : c < 22 ? ' is-start' : '') + '">' + set.map(pin =>
          '<button type="button" class="lt-pin" data-pin="' + pin.key + '" style="--tone:' + pin.tone + '" aria-label="' + pin.key + ' ' + esc(durText(pin.ms)) + '">' +
            '<em>' + pin.key + '</em><b>' + esc(durParts(pin.ms)[0]) + '</b></button>').join('') + '</span>' +
        (multi ? '<span class="lt-pinset__up"></span><span class="lt-pinset__bracket"></span>' : '') +
        set.map(pin => '<span class="lt-pinset__stem" style="--x:' + pin.x + ';--tone:' + pin.tone + '"></span>').join('') + '</div>';
    };
    $('dist-kpis').innerHTML =
      '<div class="lt-hero"><span class="lt-eyebrow"><i class="lt-diamond" aria-hidden="true"></i>Mean</span>' +
        '<span class="lt-hero__value">' + durHtml(L.mean) + '</span>' +
        '<span class="lt-hero__sub">across ' + fmtInt(items.length) + ' item' + (items.length === 1 ? '' : 's') + '</span></div>' +
      '<div class="lt-spectrum" style="--p50:' + pos(L.p50) + '%;--p90:' + pos(L.p90) + '%;--p95:' + pos(L.p95) + '%">' +
        sets.map(pinHtml).join('') +
        '<div class="lt-spectrum__track"></div>' +
        '<div class="lt-spectrum__ends"><span><b>' + esc(durText(L.min)) + '</b>fastest</span><span>slowest<b>' + esc(durText(L.max)) + '</b></span></div>' +
      '</div>';

    // About 16 bins across the run's range, on a round width.
    const W = span > 0 ? niceStep(span, 16) : Math.max(1, niceStep(Math.max(L.max, 1), 4));
    const lo = Math.floor(L.min / W) * W, hi = (Math.floor(L.max / W) + 1) * W;
    const bins = [];
    for (let a = lo; a < hi - W / 2; a += W) bins.push({ a, b: a + W, items: [] });
    items.forEach(it => bins[Math.max(0, Math.min(bins.length - 1, Math.floor((it.latency - lo) / W)))].items.push(it));
    const max = Math.max(...bins.map(b => b.items.length));
    const xPct = ms => 100 * (ms - lo) / (hi - lo);
    const tickStep = niceStep(hi - lo, 6);
    const ticks = [];
    for (let t = Math.ceil(lo / tickStep) * tickStep; t <= hi + 1e-9; t += tickStep) ticks.push(t);
    const cuts = [L.p50, L.p90, L.p95];
    const band = it => cuts.filter(c => it.latency >= c).length;
    const host = $('hist');
    host.innerHTML =
      '<div class="lt-hist__plot">' + bins.map((b, i) => {
        const n = b.items.length, errs = b.items.filter(it => it.error).length;
        // Each bar counts its items per band, so a pin's highlight counts
        // items, never whole bins.
        const counts = [0, 0, 0, 0];
        b.items.forEach(it => { counts[band(it)]++; });
        b.counts = counts;
        // One colour per bar: the band of its slowest item (p95 and up
        // orange, p90–p95 amber, else neutral).
        const tone = counts[3] ? ' tone-p95' : counts[2] ? ' tone-p90' : '';
        return '<span class="lt-hist__bar' + tone + (n ? '' : ' is-empty') + '" data-i="' + i + '" data-n="' + (n || '') +
          '" style="--h:' + (n ? Math.max(4, 100 * n / max) : 0) + ';--e:' + (n ? 100 * errs / n : 0) + '%"></span>';
      }).join('') +
        '<span class="lt-hist__brush" hidden></span></div>' +
      '<div class="lt-hist__grid" aria-hidden="true"><i style="--y:50"></i><i style="--y:100"></i></div>' +
      '<div class="lt-hist__axis">' + ticks.map(t => '<span style="left:' + xPct(t) + '%">' + tickLabel(t) + '</span>').join('') +
        '<i class="lt-diamond lt-hist__mean" style="left:' + xPct(L.mean) + '%" title="Mean ' + esc(durText(L.mean)) + '"></i></div>';

    const plot = host.querySelector('.lt-hist__plot');
    const bars = Array.from(host.querySelectorAll('.lt-hist__bar'));
    const brush = host.querySelector('.lt-hist__brush');
    // The page's latency filter, drawn as a brush over the bars it keeps.
    const sel = o.latencyFilter ? [o.latencyFilter.min, Math.min(o.latencyFilter.max, hi)] : null;
    const paint = range => {
      bars.forEach((bar, i) => bar.classList.toggle('is-out', !!range && (bins[i].b <= range[0] || bins[i].a >= range[1])));
      host.classList.toggle('has-selection', !!range);
      brush.hidden = !range;
      if (range) {
        const a = Math.max(0, xPct(range[0])), b = Math.min(100, xPct(range[1]));
        brush.style.left = a + '%';
        brush.style.width = Math.max(0, b - a) + '%';
      }
    };
    paint(sel);
    const chip = $('hist-chip');
    chip.hidden = !o.latencyFilter;
    if (o.latencyFilter) {
      const f = o.latencyFilter;
      $('hist-chip-text').textContent = 'Latency ' + (Number.isFinite(f.max)
        ? (f.min > 0 ? durText(f.min) + '–' : '< ') + durText(f.max)
        : '≥ ' + durText(f.min));
    }
    const apply = (a, b) => {
      if (typeof o.onLatencyFilter === 'function') o.onLatencyFilter({ min: a, max: b });
    };
    const clear = () => { if (typeof o.onLatencyFilter === 'function') o.onLatencyFilter(null); };
    chip.onclick = clear;

    // Click a bar for its range, or drag across bars for a wider one.
    let drag = null;
    const binAt = e => {
      const r = plot.getBoundingClientRect();
      return Math.max(0, Math.min(bins.length - 1, Math.floor((e.clientX - r.left) / r.width * bins.length)));
    };
    plot.onpointerdown = e => {
      if (e.button !== 0) return;
      e.preventDefault();
      hideTip();
      const from = binAt(e);
      drag = { from, to: from };
      paint([bins[from].a, bins[from].b]);
      try { plot.setPointerCapture(e.pointerId); } catch (_) { /* synthetic pointer */ }
    };
    plot.onpointermove = e => {
      if (!drag) return;
      drag.to = binAt(e);
      paint([bins[Math.min(drag.from, drag.to)].a, bins[Math.max(drag.from, drag.to)].b]);
    };
    plot.onpointerup = () => {
      if (!drag) return;
      const a = bins[Math.min(drag.from, drag.to)].a, b = bins[Math.max(drag.from, drag.to)].b;
      drag = null;
      // Clicking the range already selected clears it.
      if (sel && sel[0] === a && sel[1] === b) clear(); else apply(a, b);
    };
    plot.onpointercancel = () => { drag = null; paint(sel); };
    bars.forEach((bar, i) => {
      const b = bins[i], n = b.items.length, errs = b.items.filter(it => it.error).length;
      bindTip(bar, e => {
        if (drag) return;
        showTip(e, esc(tickLabel(b.a) + '–' + tickLabel(b.b)),
          [['Items', n + (n ? ' (' + pct(n, items.length).toFixed(0) + '%)' : '')], ['Task errors', errs || '—']],
          n ? 'Click, or drag across bars, to filter' : '');
      });
    });
    $('dist-kpis').querySelectorAll('.lt-pin').forEach(pinEl => {
      const pin = pins.find(p => p.key === pinEl.dataset.pin);
      const n = items.filter(it => it.latency >= pin.ms).length;
      const on = e => {
        host.dataset.focus = pin.level;
        bars.forEach((bar, i) => {
          const lit = bins[i].counts.slice(pin.level).reduce((t, c) => t + c, 0), all = bins[i].items.length;
          bar.classList.toggle('is-lit', lit > 0);
          bar.dataset.label = lit === all ? String(all) : lit + ' of ' + all;
        });
        showTip(e, pin.word + ' of items', [['Items', n + ' of ' + items.length], ['At or above', esc(durText(pin.ms))]],
          'Click to filter the page to them');
      };
      const off = () => {
        delete host.dataset.focus;
        bars.forEach(bar => bar.classList.remove('is-lit'));
        hideTip();
      };
      pinEl.addEventListener('mouseenter', on);
      pinEl.addEventListener('focus', () => {
        const r = pinEl.getBoundingClientRect();
        on({ clientX: r.left, clientY: r.bottom });
      });
      pinEl.addEventListener('mousemove', moveTip);
      pinEl.addEventListener('mouseleave', off);
      pinEl.addEventListener('blur', off);
      pinEl.addEventListener('click', () => apply(pin.ms, Infinity));
    });
  }

  // ── Quality vs latency ──
  function qualityMetrics() {
    return ((S.opts && S.opts.metrics) || []).filter(m => m && m.name && m.direction);
  }
  function renderQuality(items) {
    const card = $('qvl-card');
    const metrics = qualityMetrics();
    let metric = metrics.find(m => m.name === ui.metric) || metrics.find(m => m.name === S.opts.metric) || metrics[0];
    const points = metric ? items.filter(it => it.latency > 0 && it.scores && Number.isFinite(it.scores[metric.name])) : [];
    const show = !!metric && points.length > 1;
    card.hidden = !show;
    $('response-grid').classList.toggle('is-single', !show);
    if (!show) return;
    ui.metric = metric.name;
    dropdown($('qvl-metric'), metrics.map(m => m.name), metrics.indexOf(metric), i => {
      ui.metric = metrics[i].name;
      renderQuality(items);
    }, 'Quality metric');
    const T = metric.isBoolean ? 0.5 : metric.threshold;
    const label = window.QymMetrics && typeof window.QymMetrics.passThresholdLabel === 'function' && !metric.isBoolean
      ? window.QymMetrics.passThresholdLabel(metric.threshold, metric.direction) : null;
    $('pass-label').textContent = metric.isBoolean ? 'Pass = true'
      : 'Pass ' + (label || ((metric.direction === 'minimize' ? '≤ ' : '≥ ') + Math.round(T * 100) + '%'));
    S.scatterItems = points;
    S.scatterMetric = metric;
    renderScatter();
  }

  function renderScatter() {
    const host = $('scatter');
    const metric = S.scatterMetric, items = S.scatterItems, L = S.L;
    if (!host || !metric || !items.length || !L) return;
    const w = host.clientWidth, h = host.clientHeight;
    if (!w) return;
    const m = { l: 44, r: 10, t: 10, b: 28 };
    const minimize = metric.direction === 'minimize';
    const T = metric.isBoolean ? 0.5 : metric.threshold;
    const passes = v => (metric.isBoolean ? v >= 0.5 : minimize ? v <= T : v >= T);
    const qs = items.map(it => it.scores[metric.name]);
    const y0 = metric.isBoolean ? 0 : Math.max(0, Math.min(T - 0.05, Math.floor(Math.min(...qs) * 20) / 20));
    const y1 = metric.isBoolean ? 1 : Math.min(1, Math.max(T + 0.05, Math.ceil(Math.max(...qs) * 20) / 20));
    const latMax = Math.max(...items.map(it => it.latency));
    const xStep = niceStep(latMax, 7);
    const x1 = Math.max(xStep, Math.ceil(latMax / xStep) * xStep);
    const X = v => m.l + (w - m.l - m.r) * v / x1;
    // Lower-is-better metrics plot their best values at the top, so the
    // fast and passing corner is always top left.
    const Y = v => {
      const f = (v - y0) / ((y1 - y0) || 1);
      return m.t + (h - m.t - m.b) * (minimize ? f : 1 - f);
    };
    const top = m.t, bottom = h - m.b;
    const yT = Y(T);
    const p50 = quantile(items.map(it => it.latency).sort((a, b) => a - b), 0.5);
    const p95 = quantile(items.map(it => it.latency).sort((a, b) => a - b), 0.95);
    let s = '<svg viewBox="0 0 ' + w + ' ' + h + '" role="img" aria-label="Quality against latency, one dot per item">' +
      '<defs><pattern id="lt-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">' +
      '<line x1="0" y1="0" x2="0" y2="6" stroke="var(--error)" stroke-opacity=".22" stroke-width="2"/></pattern></defs>';
    s += '<rect x="' + X(0) + '" y="' + top + '" width="' + Math.max(0, X(p50) - X(0)) + '" height="' + Math.max(0, yT - top) + '" fill="var(--success)" fill-opacity=".07"/>';
    s += '<rect x="' + X(p50) + '" y="' + yT + '" width="' + Math.max(0, X(x1) - X(p50)) + '" height="' + Math.max(0, bottom - yT) + '" fill="var(--error)" fill-opacity=".07"/>';
    if (p95 < x1) s += '<rect x="' + X(p95) + '" y="' + top + '" width="' + Math.max(0, X(x1) - X(p95)) + '" height="' + (bottom - top) + '" fill="url(#lt-hatch)"/>';
    s += '<text class="zone-label" x="' + (X(0) + 8) + '" y="' + (top + 14) + '" style="fill:var(--success)">FAST · PASSING</text>';
    s += '<text class="zone-label" x="' + (X(x1) - 8) + '" y="' + (bottom - 8) + '" text-anchor="end" style="fill:var(--error)">SLOW · FAILING</text>';
    const yStep = [0.05, 0.1, 0.2, 0.25, 0.5].find(st => (y1 - y0) / st <= 7) || 0.5;
    for (let v = Math.ceil(y0 / yStep - 1e-9) * yStep; v <= y1 + 1e-9; v += yStep) {
      s += '<line x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="var(--border-subtle)"/>';
      s += '<text x="' + (m.l - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + Math.round(v * 100) + '%</text>';
    }
    for (let v = 0; v <= x1 + 1e-9; v += xStep) s += '<text x="' + X(v) + '" y="' + (h - 8) + '" text-anchor="middle">' + tickLabel(v) + '</text>';
    s += '<line x1="' + m.l + '" x2="' + (w - m.r) + '" y1="' + yT + '" y2="' + yT + '" stroke="var(--success)" stroke-width="1.25"/>';
    s += '<line x1="' + X(p50) + '" x2="' + X(p50) + '" y1="' + top + '" y2="' + bottom + '" stroke="var(--text-muted)" stroke-dasharray="3 4"/>';
    items.forEach((it, i) => {
      const v = it.scores[metric.name];
      s += '<circle class="dot" data-i="' + i + '" cx="' + X(it.latency) + '" cy="' + Y(v) + '" r="4" ' +
        (it.error ? 'fill="var(--bg-surface)" stroke="var(--error)" stroke-width="1.75"'
          : 'fill="' + (passes(v) ? 'var(--k-llm)' : 'var(--score-2)') + '" fill-opacity=".85"') + '/>';
    });
    host.innerHTML = s + '</svg>';
    const svg = host.querySelector('svg');
    const sel = S.opts.latencyFilter;
    svg.querySelectorAll('.dot').forEach(node => {
      const it = items[Number(node.dataset.i)];
      if (sel && (it.latency < sel.min || it.latency >= sel.max)) node.classList.add('is-out');
    });
    // One delegated tooltip and click for every dot.
    const dotOf = e => (e.target && e.target.classList && e.target.classList.contains('dot') ? items[Number(e.target.dataset.i)] : null);
    svg.addEventListener('mousemove', e => {
      const it = dotOf(e);
      if (!it) { hideTip(); return; }
      const v = it.scores[metric.name];
      showTip(e, esc(it.id), [['Latency', esc(durText(it.latency))], [esc(metric.name), (v * 100).toFixed(1) + '%'],
        ['Status', it.error ? '<span class="lt-tip__bad">task error</span>' : 'completed']], 'Click to open the item');
    });
    svg.addEventListener('mouseleave', hideTip);
    svg.addEventListener('click', e => {
      const it = dotOf(e);
      if (it && typeof S.opts.onOpenItem === 'function') { hideTip(); S.opts.onOpenItem(it.id); }
    });
  }

  // ═══════ Inside the traces ═══════
  function normalize(payload) {
    const keep = g => g && (g.n > 0 || g.error_count > 0);
    const stats = g => ({
      n: g.n || 0, err: g.error_count || 0, mean: g.mean_ms, p5: g.p5_ms, p25: g.p25_ms,
      med: g.median_ms, p75: g.p75_ms, p95: g.p95_ms, tok: g.tokens_total || 0,
    });
    const steps = (payload.groups || []).filter(keep).map(g => Object.assign(stats(g), {
      phase: g.phase === 'eval' ? 'eval' : 'task', agent: g.agent || null, kind: g.kind || 'OTHER',
      name: g.step_type || g.kind || 'step', model: g.model || null,
    }));
    const phases = {};
    (payload.phases || []).filter(keep).forEach(p => { phases[p.phase] = stats(p); });
    const agents = (payload.agents || []).filter(keep).map(a => Object.assign(stats(a), { name: a.name }));
    const traces = payload.traces || {};
    return {
      steps, phases, agents,
      traces: Number(payload.trace_count) || 0,
      failed: Number(traces.error_count) || 0,
      avgTrace: Number.isFinite(traces.mean_ms) ? traces.mean_ms : null,
    };
  }

  function apiBase() {
    return String(window.__QYM_ROOT_PATH__ || '').replace(/\/$/, '');
  }
  function apiUrl(extra) {
    const q = new URLSearchParams(Object.assign({ run_ids: S.runId, rollup: 'site' }, extra || {}));
    if (S.passNumber != null) q.set('pass_number', String(S.passNumber));
    return apiBase() + '/api/runs/step-latency?' + q.toString();
  }

  async function load(quiet) {
    const seq = ++S.seq;
    S.loading = true;
    if (!quiet) renderInside();
    try {
      const resp = await fetch(apiUrl(), { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      const payload = await resp.json();
      if (seq !== S.seq) return;
      S.data = normalize(payload);
      S.error = null;
    } catch (err) {
      if (seq !== S.seq) return;
      S.error = err;
      if (!quiet) S.data = null;
    }
    S.loading = false;
    renderInside();
  }

  function renderInside() {
    if (!S.panel) return;
    const host = $('inside');
    const state = $('inside-state');
    const D = S.data;
    const hasData = !!D && D.steps.length > 0 && D.traces > 0;
    // A run without spans never shows a loading block it will take away.
    const pending = S.loading && !D && !!(S.opts && S.opts.expectTraces);
    // Nothing captured: the subsection leaves the page (and the section
    // when Response time is empty too).
    host.hidden = !pending && !hasData && !S.error;
    $('budget-card').hidden = !hasData;
    $('steps-card').hidden = !hasData;
    state.hidden = hasData;
    if (!hasData) {
      $('inside-desc').textContent = '';
      state.innerHTML = pending ? '<span class="lt-state__loading">Loading trace timings…</span>'
        : S.error ? '<span>Trace timings did not load.</span><button type="button" class="qym-inline-action qym-inline-action--neutral" data-lt="retry">Retry</button>'
          : '';
      const retry = state.querySelector('[data-lt="retry"]');
      if (retry) retry.addEventListener('click', () => load(false));
      renderAside();
      reportVisibility();
      return;
    }
    $('inside-desc').textContent = 'Where an average trace’s time goes, across ' + fmtInt(D.traces) + ' trace' + (D.traces === 1 ? '' : 's') + '.';
    renderBudget(D);
    renderSteps(D);
    renderAside();
    reportVisibility();
  }

  function reportVisibility() {
    const visible = !$('response').hidden || !$('inside').hidden;
    if (S.opts && typeof S.opts.onVisibility === 'function') S.opts.onVisibility(visible);
  }

  // ── Section header aside: counts and the pass picker ──
  function renderAside() {
    const o = S.opts || {};
    const aside = o.aside;
    if (!aside) return;
    const items = (o.items || []).filter(it => Number.isFinite(it.latency) && it.latency >= 0).length;
    const D = S.data;
    let html = '<span class="lt-meta"><b>' + fmtInt(items) + '</b> item' + (items === 1 ? '' : 's') +
      (D && D.traces ? ' · <b>' + fmtInt(D.traces) + '</b> trace' + (D.traces === 1 ? '' : 's') : '') + '</span>';
    const passes = o.passes;
    if (passes && passes.count > 1) html += '<div data-lt-pass></div>';
    aside.innerHTML = html;
    const host = aside.querySelector('[data-lt-pass]');
    if (host) {
      const labels = ['All ' + passes.count + ' passes'].concat(Array.from({ length: passes.count }, (_, i) => 'Pass ' + (i + 1)));
      dropdown(host, labels, passes.current || 0, i => {
        if (typeof o.onPass === 'function') o.onPass(i === 0 ? null : i);
      }, 'Repeat pass');
    }
  }

  // ── Time budget ──
  function budgetSegments(D) {
    const segs = [];
    const per = g => (Number.isFinite(g.mean) ? g.mean * g.n / D.traces : 0);
    ['task', 'eval'].forEach(phase => {
      const steps = D.steps.filter(g => g.phase === phase);
      if (!steps.length) return;
      const groups = new Map();
      const agentOrder = D.agents.map(a => a.name).concat([null]);
      steps.forEach(g => {
        const key = (g.agent || '') + '|' + familyOf(g.kind);
        if (!groups.has(key)) groups.set(key, { phase, agent: g.agent, family: familyOf(g.kind), raw: 0, steps: [] });
        const x = groups.get(key);
        x.raw += per(g);
        x.steps.push(g);
      });
      const list = Array.from(groups.values()).sort((a, b) =>
        agentOrder.indexOf(a.agent) - agentOrder.indexOf(b.agent) || FAMILY_ORDER.indexOf(a.family) - FAMILY_ORDER.indexOf(b.family));
      // Steps can run in parallel: scale them to the span they ran in, the
      // sub-agent's first, then the phase's.
      D.agents.forEach(a => {
        const own = list.filter(x => x.agent === a.name);
        const raw = own.reduce((t, x) => t + x.raw, 0);
        const spanMs = per(a);
        if (raw > spanMs && spanMs > 0) own.forEach(x => { x.raw *= spanMs / raw; });
      });
      const raw = list.reduce((t, x) => t + x.raw, 0);
      const ph = D.phases[phase];
      const phMean = ph && Number.isFinite(ph.mean) ? ph.mean : raw;
      const scale = raw > 0 ? Math.min(1, phMean / raw) : 1;
      list.forEach(x => { x.ms = x.raw * scale; segs.push(x); });
      const rest = phMean - raw * scale;
      if (rest > phMean * 0.015) segs.push({ phase, agent: null, family: 'OTHER', ms: rest, overhead: true, steps: [] });
    });
    const phaseTotal = ['task', 'eval'].reduce((t, p) => t + (D.phases[p] && Number.isFinite(D.phases[p].mean) ? D.phases[p].mean : 0), 0);
    const outside = D.avgTrace != null ? D.avgTrace - phaseTotal : 0;
    if (phaseTotal > 0 && outside > D.avgTrace * 0.01) segs.push({ phase: null, agent: null, family: 'OTHER', ms: outside, overhead: true, steps: [] });
    return segs.filter(s => s.ms > 0);
  }

  function renderBudget(D) {
    const segs = budgetSegments(D);
    const total = segs.reduce((t, s) => t + s.ms, 0);
    const avg = D.avgTrace != null ? D.avgTrace : total;
    $('budget-summary').innerHTML =
      '<span>Average trace <b class="lt-budget-total">' + durHtml(avg) + '</b></span>' +
      '<span class="lt-budget-summary__sep" aria-hidden="true"></span><span><b>' + fmtInt(D.traces) + '</b> trace' + (D.traces === 1 ? '' : 's') + '</span>' +
      (D.failed ? '<span class="lt-failpill" title="' + pct(D.failed, D.traces).toFixed(1) + '% of traces">' + fmtInt(D.failed) + ' failed</span>' : '');
    const hasAgents = D.agents.length > 0;
    const modeHost = $('budget-mode');
    modeHost.hidden = !hasAgents;
    if (!hasAgents) ui.budget = 'phase';
    else segmented(modeHost, [['phase', 'By phase'], ['agent', 'By agent']], ui.budget, v => { ui.budget = v; renderBudget(D); }, 'Time budget grouping');

    const bar = $('bar');
    const first = bar.classList.contains('is-loading');
    bar.innerHTML = segs.map(s => {
      const w = pct(s.ms, total);
      return '<div class="lt-seg" style="--w:' + w + ';--tone:' + FAMILY[s.family].tone + '">' + (w > 6 ? '<span>' + esc(durText(s.ms).replace(' ', '')) + '</span>' : '') + '</div>';
    }).join('');
    bar.querySelectorAll('.lt-seg').forEach((node, i) => {
      const s = segs[i];
      const where = s.phase ? (s.agent ? s.agent : PHASE[s.phase].label) : 'Trace';
      const title = s.overhead ? where + ' · overhead' : where + ' · ' + FAMILY[s.family].label;
      const rows = [['Per trace', esc(durText(s.ms))], ['Share', pct(s.ms, total).toFixed(1) + '%']];
      s.steps.slice().sort((a, b) => (b.mean || 0) * b.n - (a.mean || 0) * a.n).slice(0, 6)
        .forEach(g => rows.push([esc(g.name), esc(durText((g.mean || 0) * g.n / D.traces))]));
      bindTip(node, e => showTip(e, esc(title), rows));
    });
    if (first) requestAnimationFrame(() => requestAnimationFrame(() => bar.classList.remove('is-loading')));

    // Brackets: the phases, or the sub-agents and the eval judges.
    const spans = [];
    let acc = 0;
    segs.forEach(s => {
      const w = pct(s.ms, total);
      const key = ui.budget === 'agent'
        ? (s.phase === 'eval' ? 'eval' : s.agent || (s.phase === 'task' ? 'orchestration' : null))
        : s.phase;
      if (key) {
        const last = spans[spans.length - 1];
        if (last && last.key === key) { last.w += w; last.ms += s.ms; } else spans.push({ key, x: acc, w, ms: s.ms, phase: s.phase });
      }
      acc += w;
    });
    $('brackets').innerHTML = spans.map(sp => {
      const label = ui.budget === 'agent' ? (sp.key === 'eval' ? 'Eval judges' : sp.key) : PHASE[sp.key].label;
      const tone = sp.phase === 'eval' ? PHASE.eval.tone : PHASE.task.tone;
      // A bracket reads its span's own time, the same number as its row.
      const agent = D.agents.find(a => a.name === sp.key);
      const ph = D.phases[sp.key];
      const ms = ui.budget === 'phase' ? (ph && Number.isFinite(ph.mean) ? ph.mean : sp.ms)
        : agent ? agent.mean * agent.n / D.traces : sp.ms;
      return '<div class="lt-bracket" style="--x:' + sp.x + ';--w:' + Math.max(0, sp.w - 0.3) + ';--tone:' + tone + '" title="' + esc(label + ' ' + durText(ms)) + '">' +
        '<span>' + esc(label) + '<b>' + esc(durText(ms)) + '</b></span></div>';
    }).join('');

    const byFamily = {};
    segs.forEach(s => { byFamily[s.family] = (byFamily[s.family] || 0) + s.ms; });
    $('budget-legend').innerHTML = FAMILY_ORDER.filter(f => byFamily[f]).map(f =>
      '<div><i style="--tone:' + FAMILY[f].tone + '"></i>' + FAMILY[f].label + ' <b>' + esc(durText(byFamily[f])) + '</b><em>' + pct(byFamily[f], total).toFixed(0) + '%</em></div>').join('');

    renderKinds(D);
  }

  // ── Trace stats by kind: every stat opens its breakdown by call site, tool or evaluator ──
  function kindPanels(D) {
    const task = D.steps.filter(g => g.phase === 'task');
    const of = f => task.filter(g => familyOf(g.kind) === f);
    const calls = rows => rows.reduce((t, g) => t + g.n + g.err, 0);
    const timed = rows => rows.reduce((t, g) => t + g.n, 0);
    const avgCall = rows => { const n = timed(rows); return n ? rows.reduce((t, g) => t + (g.mean || 0) * g.n, 0) / n : NaN; };
    const tokens = rows => rows.reduce((t, g) => t + (g.tok || 0), 0);
    const errRate = g => (g.n + g.err ? g.err / (g.n + g.err) : 0);
    const callsStat = rows => ({ key: 'calls', label: 'calls / trace', value: (calls(rows) / D.traces).toFixed(1),
      by: g => (g.n + g.err) / D.traces, byFmt: v => v.toFixed(2) });
    const avgStat = rows => { const [v, u] = durParts(avgCall(rows)); return { key: 'avg', label: 'avg call', value: v, unit: u, by: g => g.mean || 0, byFmt: fmtMs }; };
    const tokStat = rows => ({ key: 'tokens', label: 'tokens / trace', value: fmtK(tokens(rows) / D.traces), by: g => (g.tok || 0) / D.traces, byFmt: fmtK });
    const panels = [];
    const llm = of('LLM');
    if (llm.length) {
      panels.push({ family: 'LLM', unitWord: 'call sites', rows: llm,
        stats: [callsStat(llm), avgStat(llm)].concat(tokens(llm) ? [tokStat(llm)] : []) });
    }
    const tools = of('TOOL');
    if (tools.length) {
      const all = calls(tools);
      panels.push({ family: 'TOOL', unitWord: 'tools', rows: tools, stats: [callsStat(tools), avgStat(tools),
        { key: 'success', label: 'succeeded', value: (all ? 100 * (1 - tools.reduce((t, g) => t + g.err, 0) / all) : 100).toFixed(1), unit: '%',
          by: errRate, byFmt: v => (100 * v).toFixed(1) + '% failed', byTitle: 'Failure rate by tool', bad: true }] });
    }
    const ret = of('RETRIEVAL');
    if (ret.length) panels.push({ family: 'RETRIEVAL', unitWord: 'steps', rows: ret, stats: [callsStat(ret), avgStat(ret)] });
    // The eval judges and scorers: after the agent's own work, as in the
    // time budget. Their calls are not in the LLM panel's counts.
    const ev = D.steps.filter(g => g.phase === 'eval');
    if (ev.length) {
      panels.push({ family: 'EVAL', unitWord: 'evaluators', rows: ev,
        stats: [callsStat(ev), avgStat(ev)].concat(tokens(ev) ? [tokStat(ev)] : []) });
    }
    return panels;
  }

  function renderKinds(D) {
    const panels = kindPanels(D);
    const host = $('kinds');
    host.innerHTML = panels.map(p => {
      const F = FAMILY[p.family];
      const open = ui.kindOpen && ui.kindOpen.family === p.family ? ui.kindOpen.key : null;
      const count = p.rows.length;
      let html = '<section class="lt-kind" style="--tone:' + F.tone + '" data-family="' + p.family + '">' +
        '<div class="lt-kind__head">' + glyph(F.glyph, F.tone) + '<span class="lt-kind__name">' + F.label + '</span>' +
          '<span class="lt-kind__meta">' + count + ' ' + (count === 1 ? p.unitWord.replace(/s$/, '') : p.unitWord) + '</span></div>' +
        '<div class="lt-kind__stats" style="--n:' + p.stats.length + '">' + p.stats.map(s =>
          '<button type="button" class="lt-kstat" data-family="' + p.family + '" data-key="' + s.key + '" aria-expanded="' + (open === s.key) + '">' +
            '<span class="lt-kstat__value">' + esc(s.value) + (s.unit ? '<small>' + s.unit + '</small>' : '') + '</span>' +
            '<span class="lt-kstat__label">' + s.label + DOWN_SVG + '</span></button>').join('') + '</div>';
      const s = p.stats.find(x => x.key === open);
      if (s) {
        const rows = p.rows.map(g => ({ g, v: s.by(g) })).sort((a, b) => b.v - a.v);
        const max = Math.max(...rows.map(r => r.v)) || 1;
        const shown = rows.slice(0, 7);
        const by = p.family === 'LLM' ? 'call site' : p.family === 'TOOL' ? 'tool' : p.family === 'EVAL' ? 'evaluator' : 'step';
        html += '<div class="lt-breakdown"><div class="lt-breakdown__head"><span><b>' + (s.byTitle || cap(s.label) + ' by ' + by) + '</b>' +
            (rows.length > shown.length ? ' · top ' + shown.length + ' of ' + rows.length : '') + '</span>' +
            '<button type="button" class="lt-link" data-goto="' + p.family + '">Open in Step timings →</button></div>' +
          shown.map(({ g, v }) => '<div class="lt-brow"><span class="lt-brow__name" title="' + esc(g.name + (g.model ? ' · ' + g.model : '') + (g.agent ? ' · ' + g.agent : '')) + '">' + esc(g.name) +
              (g.model && g.model !== g.name ? '<small>' + esc(g.model) + '</small>' : '') + '</span>' +
            '<span class="lt-brow__bar"><i style="--w:' + (100 * v / max) + (s.bad ? ';--tone:var(--error)' : '') + '"></i></span>' +
            '<span class="lt-brow__val' + (s.bad && v > 0.04 ? ' is-bad' : '') + '">' + esc(s.byFmt(v)) + '</span></div>').join('') + '</div>';
      }
      return html + '</section>';
    }).join('');
    host.querySelectorAll('.lt-kstat').forEach(btn => btn.addEventListener('click', () => {
      const same = ui.kindOpen && ui.kindOpen.family === btn.dataset.family && ui.kindOpen.key === btn.dataset.key;
      ui.kindOpen = same ? null : { family: btn.dataset.family, key: btn.dataset.key };
      renderKinds(D);
      const again = host.querySelector('.lt-kstat[data-family="' + CSS.escape(btn.dataset.family) + '"][data-key="' + CSS.escape(btn.dataset.key) + '"]');
      if (again) again.focus({ preventScroll: true });
    }));
    host.querySelectorAll('[data-goto]').forEach(btn => btn.addEventListener('click', () => gotoSteps(D, btn.dataset.goto)));
    // Only what was captured gets a panel (C143); without LLM or tool spans
    // the section says so once.
    if (!panels.some(p => p.family === 'LLM' || p.family === 'TOOL')) {
      host.insertAdjacentHTML('beforeend', '<p class="lt-note">LLM and tool spans were not captured for this run. ' +
        '<a href="' + esc(apiBase() + '/docs-guide#sdk-guide/results') + '">How tracing works</a></p>');
    }
  }

  // Open the matching groups in Step timings and point at that kind's rows.
  function gotoSteps(D, family) {
    ui.group = 'name';
    ui.query = '';
    $('search').value = '';
    $('group').querySelectorAll('[data-v]').forEach(o => {
      const on = o.dataset.v === 'name';
      o.classList.toggle('active', on);
      o.setAttribute('aria-pressed', String(on));
    });
    const phase = family === 'EVAL' ? 'eval' : 'task';
    const wanted = g => g.phase === phase && (family === 'EVAL' || familyOf(g.kind) === family);
    ui.open.add('p:' + phase);
    D.steps.filter(g => wanted(g) && g.agent).forEach(g => ui.open.add('a:' + g.agent));
    renderSteps(D);
    const ids = new Set(D.steps.filter(wanted).map(stepId));
    const rows = Array.from($('steps').querySelectorAll('.lt-row[data-id]')).filter(r => ids.has(r.dataset.id));
    $('steps-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
    rows.forEach(r => { r.classList.remove('is-flash'); void r.offsetWidth; r.classList.add('is-flash'); });
  }

  // ── Step timings ──
  const stepId = g => 's:' + g.phase + ':' + (g.agent || '') + ':' + g.name + ':' + (g.model || '');
  function aggregate(steps) {
    const timed = steps.filter(g => g.n > 0 && Number.isFinite(g.mean));
    const n = timed.reduce((t, g) => t + g.n, 0);
    const wavg = f => (n ? timed.reduce((t, g) => t + g[f] * g.n, 0) / n : NaN);
    return {
      n, err: steps.reduce((t, g) => t + g.err, 0), mean: wavg('mean'),
      p5: timed.length ? Math.min(...timed.map(g => g.p5)) : NaN, p25: wavg('p25'), med: wavg('med'), p75: wavg('p75'),
      p95: timed.length ? Math.max(...timed.map(g => g.p95)) : NaN, tok: steps.reduce((t, g) => t + (g.tok || 0), 0),
    };
  }
  function buildTree(D) {
    const q = ui.query.trim().toLowerCase();
    const leaf = (g, phase, extra) => Object.assign({ type: 'step', id: stepId(g), phase, stats: g, label: g.name, model: g.model, kind: g.kind }, extra || {});
    const match = node => !q || [node.label, node.model, node.agentName].some(t => t && t.toLowerCase().includes(q));
    return ['task', 'eval'].map(phase => {
      const steps = D.steps.filter(g => g.phase === phase);
      if (!steps.length) return null;
      let children;
      if (ui.group === 'kind') {
        children = FAMILY_ORDER.map(f => {
          const fs = steps.filter(g => familyOf(g.kind) === f);
          return fs.length ? leaf(aggregate(fs), phase, { id: 'k:' + phase + ':' + f, label: FAMILY[f].label, family: f, model: null, kind: f }) : null;
        }).filter(Boolean);
      } else if (phase === 'task' && D.agents.length) {
        const named = new Set(D.agents.map(a => a.name));
        children = D.agents.map(a => ({
          type: 'agent', id: 'a:' + a.name, phase, label: a.name, stats: a,
          children: steps.filter(g => g.agent === a.name).map(g => leaf(g, phase, { agentName: a.name })),
        })).concat(steps.filter(g => !g.agent || !named.has(g.agent)).map(g => leaf(g, phase)));
      } else {
        children = steps.map(g => leaf(g, phase));
      }
      const root = { type: 'phase', id: 'p:' + phase, phase, label: PHASE[phase].label, stats: D.phases[phase] || aggregate(steps), children };
      if (!q) return root;
      // Search keeps matching steps and the groups that hold them, open.
      const prune = node => {
        if (!node.children) return match(node) ? node : null;
        const kids = node.children.map(prune).filter(Boolean);
        if (!kids.length && !match(node)) return null;
        return Object.assign({}, node, { children: kids, forcedOpen: true });
      };
      return prune(root);
    }).filter(Boolean);
  }
  const finite0 = v => (Number.isFinite(v) ? v : 0);
  const SORTS = {
    time: (n, D) => (n.type === 'phase' ? finite0(n.stats.mean) : finite0(n.stats.mean) * n.stats.n / D.traces),
    med: n => finite0(n.stats.med),
    calls: (n, D) => (n.stats.n + n.stats.err) / D.traces,
    err: n => n.stats.err,
  };
  function flatten(D, tree) {
    const rows = [];
    const sortKids = kids => kids.slice().sort((a, b) => ui.sort.dir * (SORTS[ui.sort.key](a, D) - SORTS[ui.sort.key](b, D)));
    const walk = (node, depth) => {
      const isGroup = !!node.children;
      const open = isGroup && (node.forcedOpen || ui.open.has(node.id));
      rows.push({ node, depth, isGroup, open });
      if (open) sortKids(node.children).forEach(k => walk(k, depth + 1));
    };
    tree.forEach(t => walk(t, 0));
    return rows;
  }
  function axisFor(rows) {
    // The axis covers every visible row, spans and calls alike.
    const timed = rows.map(r => r.node.stats).filter(st => Number.isFinite(st.p5) && Number.isFinite(st.p95));
    const lo = timed.length ? Math.min(...timed.map(st => st.p5)) : 1;
    const hi = timed.length ? Math.max(...timed.map(st => st.p95), 1) : 10;
    if (ui.scale === 'log') {
      // Round ends (1, 2, 3, 5 × 10ⁿ) just outside the data; ticks at 1 and 3.
      const round = (v, up) => {
        const m = Math.pow(10, Math.floor(Math.log10(v))), fs = [1, 2, 3, 5, 10].map(f => f * m);
        return up ? fs.find(x => x >= v) : fs.reverse().find(x => x <= v);
      };
      const a = round(Math.max(lo, 1), false);
      const b = Math.max(round(Math.max(hi, 1), true), a * 10);
      const ticks = new Set([a, b]);
      for (let d = Math.pow(10, Math.floor(Math.log10(a))); d <= b; d *= 10) {
        [d, d * 3].forEach(t => { if (t > a * 1.15 && t < b / 1.15) ticks.add(t); });
      }
      return {
        x: v => 100 * (Math.log10(Math.max(v, a)) - Math.log10(a)) / (Math.log10(b) - Math.log10(a)),
        ticks: Array.from(ticks).sort((p, q) => p - q),
      };
    }
    const step = niceStep(hi * 1.02, 6);
    const top = Math.ceil(hi * 1.02 / step) * step;
    const ticks = [];
    for (let v = 0; v <= top + 1e-6; v += step) ticks.push(v);
    return { x: v => 100 * v / top, ticks };
  }
  function interval(r, sc, tone) {
    if (!Number.isFinite(r.med)) return '';
    return '<div class="lt-iv" style="--tone:' + tone + '">' +
      '<span class="lt-iv__whisker" style="--a:' + sc.x(r.p5) + ';--b:' + sc.x(r.p95) + '"></span>' +
      '<span class="lt-iv__box" style="--a:' + sc.x(r.p25) + ';--b:' + sc.x(r.p75) + '"></span>' +
      (Number.isFinite(r.mean) ? '<span class="lt-iv__mean" style="--a:' + sc.x(r.mean) + '"></span>' : '') +
      '<span class="lt-iv__med" style="--a:' + sc.x(r.med) + '"></span></div>';
  }
  const highlight = text => {
    const q = ui.query.trim();
    if (!q || !text) return esc(text || '');
    const i = text.toLowerCase().indexOf(q.toLowerCase());
    return i < 0 ? esc(text) : esc(text.slice(0, i)) + '<mark>' + esc(text.slice(i, i + q.length)) + '</mark>' + esc(text.slice(i + q.length));
  };
  const countLeaves = node => (node.children ? node.children.reduce((t, k) => t + countLeaves(k), 0) : 1);
  const toneOf = node => (node.type === 'phase' ? PHASE[node.phase].tone : node.type === 'agent' ? 'var(--k-agent)' : FAMILY[node.family || familyOf(node.kind)].tone);

  function renderSteps(D) {
    const tree = buildTree(D);
    const host = $('steps');
    S.stepRows = null;
    if (!tree.length) {
      host.innerHTML = '<div class="lt-empty">No step matches “' + esc(ui.query) + '”.</div>';
      return;
    }
    const rows = flatten(D, tree);
    const sc = axisFor(rows);
    S.stepRows = { rows, sc };
    const head = (key, label) => '<button type="button" class="lt-head-btn" data-sort="' + key + '" aria-sort="' +
      (ui.sort.key === key ? (ui.sort.dir < 0 ? 'descending' : 'ascending') : 'none') + '">' + label + '</button>';
    let html = '<div class="lt-row lt-row--axis"><div class="lt-cell">' + (ui.group === 'kind' ? 'Kind' : 'Step') + '</div>' +
      '<div class="lt-cell"><div class="lt-axis-ticks">' + sc.ticks.map(t => '<span style="--x:' + sc.x(t) + '">' + tickLabel(t) + '</span>').join('') + '</div></div>' +
      '<div class="lt-cell lt-cell--num">' + head('med', 'Median') + '</div>' +
      '<div class="lt-cell lt-cell--num">' + head('calls', 'Calls / trace') + '</div>' +
      '<div class="lt-cell lt-cell--num">' + head('time', 'Time / trace') + '</div>' +
      '<div class="lt-cell lt-cell--num">' + head('err', 'Errors') + '</div></div>';
    rows.forEach(({ node, depth, isGroup, open }) => {
      const st = node.stats;
      const tone = toneOf(node);
      const g = node.type === 'phase' ? glyph(PHASE[node.phase].glyph, PHASE[node.phase].tone, true)
        : node.type === 'agent' ? glyph(AGENT_SVG, 'var(--k-agent)', true)
          : glyph(FAMILY[node.family || familyOf(node.kind)].glyph, tone, true);
      const count = isGroup ? '<span class="lt-count">' + countLeaves(node) + '</span>' : '';
      const text = '<span class="lt-label__text">' + highlight(node.label) +
        (node.model && ui.group === 'name' && node.model !== node.label ? '<small>' + highlight(node.model) + '</small>' : '') + count + '</span>';
      const label = isGroup
        ? '<button type="button" class="lt-toggle lt-label" style="--depth:' + depth + '" data-toggle="' + esc(node.id) + '" aria-expanded="' + open + '">' + CHEV + g + text + '</button>'
        : '<div class="lt-label" style="--depth:' + depth + '"><span class="lt-chev-space"></span>' + g + text + '</div>';
      // A phase runs once per trace: its time per trace is its span.
      const perTrace = node.type === 'phase' ? 1 : (st.n + st.err) / D.traces;
      const timePerTrace = node.type === 'phase' ? st.mean : finite0(st.mean) * st.n / D.traces;
      html += '<div class="lt-row' + (isGroup ? ' lt-row--group' : '') + (node.type === 'phase' ? ' lt-row--phase' : '') + '" data-id="' + esc(node.id) + '">' +
        '<div class="lt-cell">' + label + '</div>' +
        '<div class="lt-cell"><div class="lt-track"><div class="lt-grid-lines">' + sc.ticks.map(t => '<i style="--x:' + sc.x(t) + '"></i>').join('') + '</div>' +
          interval(st, sc, tone) + '</div></div>' +
        '<div class="lt-cell lt-cell--num is-key">' + fmtMs(st.med) + '</div>' +
        '<div class="lt-cell lt-cell--num">' + perTrace.toFixed(perTrace >= 10 ? 0 : 1) + '</div>' +
        '<div class="lt-cell lt-cell--num">' + fmtMs(timePerTrace) + '</div>' +
        '<div class="lt-cell lt-cell--num"><span class="lt-errbadge' + (st.err ? '' : ' is-zero') + '">' + (st.err ? fmtInt(st.err) : '—') + '</span></div></div>';
    });
    host.innerHTML = html;
    host.querySelectorAll('[data-toggle]').forEach(btn => btn.addEventListener('click', () => {
      const id = btn.dataset.toggle;
      if (ui.open.has(id)) ui.open.delete(id); else ui.open.add(id);
      renderSteps(D);
      const again = Array.from(host.querySelectorAll('[data-toggle]')).find(b => b.dataset.toggle === id);
      if (again) again.focus({ preventScroll: true });
    }));
    host.querySelectorAll('[data-sort]').forEach(btn => btn.addEventListener('click', () => {
      const key = btn.dataset.sort;
      ui.sort = { key, dir: ui.sort.key === key ? -ui.sort.dir : -1 };
      renderSteps(D);
    }));
    const byId = new Map(rows.map(r => [r.node.id, r.node]));
    host.querySelectorAll('.lt-row[data-id]').forEach(row => {
      const node = byId.get(row.dataset.id);
      if (!node) return;
      const st = node.stats;
      const title = node.type === 'phase' ? node.label + ' span' : node.type === 'agent' ? node.label + ' (sub-agent span)'
        : node.label + (node.model && node.model !== node.label ? ' · ' + node.model : '');
      const kind = node.type === 'step' ? String(node.kind || '').toLowerCase() : node.type === 'agent' ? 'agent' : PHASE[node.phase].label.toLowerCase() + ' phase';
      const rowsTip = [['Kind', esc(kind)],
        ['p5 · p25', fmtMs(st.p5) + ' · ' + fmtMs(st.p25)], ['Median', fmtMs(st.med)], ['Mean', fmtMs(st.mean)],
        ['p75 · p95', fmtMs(st.p75) + ' · ' + fmtMs(st.p95)], ['Calls', fmtInt(st.n + st.err)],
        ['Errors', st.err ? fmtInt(st.err) + ' (' + pct(st.err, st.n + st.err).toFixed(1) + '%)' : '—']];
      if (st.tok) rowsTip.push(['Tokens / trace', fmtK(st.tok / D.traces)]);
      bindTip(row.querySelector('.lt-track'), e => showTip(e, esc(title), rowsTip));
    });
  }

  // The visible Step timings rows as a standalone SVG, for the export menu.
  function stepsSvg() {
    const D = S.data, plot = S.stepRows;
    if (!D || !plot) return null;
    const W = 960, LABEL = 280, NUM = 90, rowH = 30, top = 34;
    const trackW = W - LABEL - NUM - 24;
    const X = v => LABEL + trackW * plot.sc.x(v) / 100;
    const cs = getComputedStyle(S.panel);
    const color = name => (cs.getPropertyValue(name) || '').trim() || '#999';
    const toneColor = tone => color(tone.replace(/^var\(|\)$/g, ''));
    const H = top + plot.rows.length * rowH + 12;
    let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="ui-monospace, Menlo, Consolas, monospace" font-size="11">' +
      '<rect width="100%" height="100%" fill="' + color('--bg-surface') + '"/>';
    plot.sc.ticks.forEach(t => {
      s += '<line x1="' + X(t) + '" x2="' + X(t) + '" y1="' + (top - 6) + '" y2="' + (H - 8) + '" stroke="' + color('--border-subtle') + '"/>' +
        '<text x="' + X(t) + '" y="' + (top - 12) + '" text-anchor="middle" fill="' + color('--text-muted') + '">' + tickLabel(t) + '</text>';
    });
    plot.rows.forEach(({ node, depth }, i) => {
      const y = top + i * rowH + rowH / 2, st = node.stats, tone = toneColor(toneOf(node));
      s += '<text x="' + (8 + depth * 16) + '" y="' + (y + 4) + '" fill="' + color('--text-primary') + '">' + esc(node.label + (node.model && node.model !== node.label ? ' · ' + node.model : '')) + '</text>';
      if (Number.isFinite(st.med)) {
        s += '<line x1="' + X(st.p5) + '" x2="' + X(st.p95) + '" y1="' + y + '" y2="' + y + '" stroke="' + tone + '" stroke-opacity=".6" stroke-width="1.5"/>' +
          '<rect x="' + X(st.p25) + '" y="' + (y - 6) + '" width="' + Math.max(2, X(st.p75) - X(st.p25)) + '" height="12" rx="3" fill="' + tone + '" fill-opacity=".8"/>' +
          '<rect x="' + (X(st.med) - 1) + '" y="' + (y - 9) + '" width="2" height="18" fill="' + color('--text-primary') + '"/>';
      }
      s += '<text x="' + (W - 12) + '" y="' + (y + 4) + '" text-anchor="end" fill="' + color('--text-secondary') + '">' + fmtMs(st.med) + '</text>';
    });
    return s + '</svg>';
  }

  // ── Wiring, once per mount ──
  function wire() {
    segmented($('group'), [['name', 'By step'], ['kind', 'By kind']], ui.group, v => { ui.group = v; if (S.data) renderSteps(S.data); }, 'Group steps');
    segmented($('scale'), [['linear', 'Linear'], ['log', 'Log']], ui.scale, v => { ui.scale = v; if (S.data) renderSteps(S.data); }, 'Time axis scale');
    $('search').addEventListener('input', e => { ui.query = e.target.value; if (S.data) renderSteps(S.data); });
    $('csv-summary').href = apiUrl({ format: 'csv' });
    $('csv-spans').href = apiUrl({ format: 'csv', level: 'spans' });
    $('svg').addEventListener('click', () => {
      const svg = stepsSvg();
      if (!svg) return;
      const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'step_timings.svg';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      $('svg').closest('details').open = false;
    });
    if (typeof ResizeObserver === 'function') {
      let width = 0;
      new ResizeObserver(entries => {
        const w = Math.round(entries[0].contentRect.width);
        if (w && w !== width) { width = w; renderScatter(); }
      }).observe($('scatter'));
    }
  }

  window.QymLatencyTraces = {
    mount(panel, opts) {
      if (!panel) return;
      opts = opts || {};
      const fresh = S.panel !== panel || S.runId !== opts.runId || S.passNumber !== (opts.passNumber || null);
      S.panel = panel;
      S.runId = opts.runId;
      S.passNumber = opts.passNumber || null;
      S.offline = !!opts.offline;
      if (fresh || !panel.querySelector('.lt')) {
        panel.innerHTML = skeleton();
        S.data = null;
        S.error = null;
        wire();
        if (S.opts) renderResponse();
      }
      if (S.offline) renderInside(); else load(false);
    },
    update(opts) {
      S.opts = opts || {};
      if (!S.panel || !S.panel.querySelector('.lt')) return;
      renderResponse();
      renderAside();
      reportVisibility();
      // A panel moved into a new section gets its width only after layout.
      if (S.scatterMetric && !$('scatter').clientWidth) requestAnimationFrame(renderScatter);
    },
    reload(opts) {
      if (S.panel && !S.offline) load(!!(opts && opts.quiet));
    },
  };
})();
