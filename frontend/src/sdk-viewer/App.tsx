import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Badge } from '@/ui/Badge';
import { useViewerData, type ViewerData } from './lib/use-viewer-data';
import {
  DEFAULT_VIEW,
  filterRows,
  parseView,
  rowsToCsv,
  sortRows,
  STATUS_FILTERS,
  viewToSearch,
  type SortKey,
  type StatusFilter,
  type ViewState,
} from './lib/table-model';
import { Datasets } from './components/Datasets';
import { Detail } from './components/Detail';
import { RowList } from './components/RowList';
import { Summary } from './components/Summary';
import { downloadText, safeFilename, STATUS_LABEL } from './components/format';
import { datasetEntries, datasetKeyLabel } from './lib/datasets';
import s from './App.module.css';

function useUrlView(): [
  ViewState,
  number | null,
  (next: Partial<ViewState>) => void,
  (row: number | null) => void,
] {
  const [search, setSearch] = useState(window.location.search);
  const write = useCallback((query: string) => {
    window.history.replaceState(null, '', `${window.location.pathname}${query}`);
    setSearch(query);
  }, []);
  const view = useMemo(() => parseView(search), [search]);
  const rowParam = new URLSearchParams(search).get('row');
  const selected = rowParam !== null && /^\d+$/.test(rowParam) ? Number(rowParam) : null;
  const update = useCallback(
    (next: Partial<ViewState>) => {
      const p = new URLSearchParams(viewToSearch({ ...parseView(window.location.search), ...next }));
      const row = new URLSearchParams(window.location.search).get('row');
      if (row) p.set('row', row);
      write(p.toString() ? `?${p}` : '');
    },
    [write],
  );
  const select = useCallback(
    (row: number | null) => {
      const p = new URLSearchParams(window.location.search);
      if (row === null) p.delete('row');
      else p.set('row', String(row));
      write(p.toString() ? `?${p}` : '');
    },
    [write],
  );
  return [view, selected, update, select];
}

function Header({ data }: { data: ViewerData }) {
  const { run, source } = data;
  const entries = useMemo(
    () => datasetEntries(data.snapshot?.rows ?? [], data.snapshot?.metric_names.length ?? 0),
    [data.snapshot],
  );
  const file = run.file_path?.split(/[\\/]/).pop();
  let badge = <Badge tone="neutral">Waiting</Badge>;
  if (data.error) badge = <Badge tone="danger">Unavailable</Badge>;
  else if (source.mode === 'file') badge = <Badge tone="success">Saved file</Badge>;
  else if (data.finished)
    badge = (
      <Badge tone={run.status === 'STOPPED' ? 'warning' : 'success'}>
        {run.status === 'STOPPED' ? 'Stopped' : 'Completed'}
      </Badge>
    );
  else if (data.noLiveRun) badge = <></>;
  else if (data.connection === 'reconnecting') badge = <Badge tone="warning">Reconnecting</Badge>;
  else if (data.connection === 'live')
    badge = (
      <Badge tone="info" dot>
        Live
      </Badge>
    );
  return (
    <header className={s.header}>
      <span className={s.wordmark} lang="ar" dir="rtl">
        قيِّم
      </span>
      {entries.length ? (
        entries.map((e) => (
          <span
            key={e.position}
            className={s.chip}
            title={`${e.name} ${e.version ?? ''}, ${e.items} items`.trim()}
          >
            {e.name}
            {e.version ? ` ${e.version}` : ''} · {e.items} items
          </span>
        ))
      ) : run.dataset_name ? (
        <span className={s.chip} title={run.dataset_name}>
          {run.dataset_name}
        </span>
      ) : null}
      {run.dataset_disabled_items ? (
        <span className={s.chipPlain}>
          {run.dataset_disabled_items} disabled {run.dataset_disabled_items === 1 ? 'item' : 'items'} skipped
        </span>
      ) : null}
      {run.run_name ? (
        <span className={s.chipPlain} title={run.run_name}>
          {run.run_name}
        </span>
      ) : null}
      {run.config?.max_concurrency ? (
        <span className={s.chipPlain} title="Max concurrency">
          Concurrency {run.config.max_concurrency}
        </span>
      ) : null}
      {run.config?.timeout ? (
        <span className={s.chipPlain} title="Per-item timeout">
          Timeout {run.config.timeout}s
        </span>
      ) : null}
      {run.model ? (
        <span className={s.chipMono} title={run.model}>
          {run.model}
        </span>
      ) : null}
      <span className={s.grow} />
      {file ? (
        <span className={s.chipMono} title={run.file_path}>
          {file}
        </span>
      ) : null}
      {badge}
    </header>
  );
}

function Notice({
  tone,
  children,
  action,
}: {
  tone: 'error' | 'warning';
  children: string;
  action?: { label: string; run: () => void };
}) {
  return (
    <div className={s.banner} data-tone={tone} role={tone === 'error' ? 'alert' : 'status'}>
      <span className={s.bannerText}>{children}</span>
      {action ? (
        <button type="button" className={s.btn} onClick={action.run}>
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

function FullError({ data }: { data: ViewerData }) {
  const err = data.error;
  const missing = err?.status === 404;
  return (
    <div className={s.center} role="alert">
      <h1 className={s.centerTitle}>{missing ? 'Results file not found' : 'Cannot load this evaluation'}</h1>
      <p className={s.centerBody}>{err?.message}</p>
      {data.source.mode === 'file' ? <p className={s.path}>{data.source.filePath}</p> : null}
      <button type="button" className={s.btn} onClick={data.reload}>
        Try again
      </button>
    </div>
  );
}

function Waiting({ loading, live, noLiveRun }: { loading: boolean; live: boolean; noLiveRun: boolean }) {
  return (
    <div className={s.center} role="status" aria-busy={loading || undefined}>
      <h1 className={s.centerTitle}>
        {loading
          ? 'Connecting to the evaluation'
          : noLiveRun
            ? 'No evaluation is running here'
            : live
              ? 'Waiting for the first row'
              : 'This results file has no rows'}
      </h1>
      {noLiveRun ? (
        <p className={s.centerBody}>
          Open a results file with <code>qym ui FILE</code>, or start a run with{' '}
          <code>qym run create --local-ui</code>.
        </p>
      ) : live && !loading ? (
        <p className={s.centerBody}>
          Rows appear here as the evaluation produces them. This page updates by itself.
        </p>
      ) : null}
    </div>
  );
}

export function App() {
  const data = useViewerData();
  const [view, selectedIndex, updateView, select] = useUrlView();
  const detailRef = useRef<HTMLElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const rows = useMemo(() => data.snapshot?.rows ?? [], [data.snapshot]);
  const names = useMemo(() => data.snapshot?.metric_names ?? [], [data.snapshot]);
  const shown = useMemo(() => sortRows(filterRows(rows, view), view.sort, view.dir), [rows, view]);
  const datasets = useMemo(() => datasetEntries(rows, names.length), [rows, names.length]);
  const visible = useMemo(() => new Set(shown.map((r) => r.index)), [shown]);
  const selected = useMemo(() => rows.find((r) => r.index === selectedIndex) ?? null, [rows, selectedIndex]);
  const fileMode = data.source.mode === 'file' && !!data.run.file_path;

  useEffect(() => {
    const { dataset_name: ds, run_name: run } = data.run;
    document.title = ds
      ? `قيِّم – ${ds}${run ? ` / ${run}` : ''}${data.source.mode === 'file' ? ' (Saved)' : ''}`
      : 'قيِّم viewer';
  }, [data.run, data.source.mode]);

  const open = useCallback(
    (index: number) => {
      returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      select(index);
      window.requestAnimationFrame(() => detailRef.current?.focus());
    },
    [select],
  );
  const close = useCallback(() => {
    select(null);
    const back = returnTo.current;
    window.requestAnimationFrame(() => {
      if (back && document.contains(back)) back.focus();
      else document.querySelector<HTMLElement>('tr[data-row][tabindex="0"]')?.focus();
    });
  }, [select]);

  const toggleSort = (key: SortKey) =>
    updateView(
      view.sort === key
        ? { dir: view.dir === 'asc' ? 'desc' : 'asc' }
        : { sort: key, dir: key === 'latency' ? 'desc' : 'asc' },
    );

  if (data.error && !data.snapshot) {
    return (
      <div className={s.page}>
        <Header data={data} />
        <FullError data={data} />
      </div>
    );
  }

  const hasRows = rows.length > 0;
  const live = data.source.mode === 'live';
  const loaded = !data.loading && hasRows && !!data.snapshot;
  return (
    <div className={s.page}>
      {loaded ? (
        <a
          className={s.skip}
          href="#rows"
          onClick={(e) => {
            e.preventDefault();
            document.querySelector<HTMLElement>('tr[data-row][tabindex="0"]')?.focus();
          }}
        >
          Skip to rows
        </a>
      ) : null}
      <Header data={data} />
      <main className={s.main}>
        {loaded ? (
          <h1 className={s.srOnly}>{data.run.run_name || data.run.dataset_name || 'Evaluation results'}</h1>
        ) : null}
        {live && !data.noLiveRun && !data.finished && data.connection === 'reconnecting' ? (
          <Notice tone="warning" action={{ label: 'Reload', run: data.reload }}>
            Lost the connection to the evaluation. Retrying automatically; the run may have stopped.
          </Notice>
        ) : null}
        {live && !data.noLiveRun && !data.finished && data.connection === 'closed' ? (
          <Notice tone="error" action={{ label: 'Reload', run: data.reload }}>
            The connection to the evaluation closed unexpectedly.
          </Notice>
        ) : null}
        {data.error && data.snapshot ? (
          <Notice tone="error" action={{ label: 'Retry', run: data.reload }}>
            {data.error.message}
          </Notice>
        ) : null}
        {data.loading || !hasRows || !data.snapshot ? (
          <Waiting loading={data.loading} live={live} noLiveRun={data.noLiveRun} />
        ) : (
          <>
            <Summary
              snapshot={data.snapshot}
              run={data.run}
              finished={data.finished}
              paused={live && data.connection === 'reconnecting'}
              visible={visible}
              selected={selectedIndex}
              onOpen={open}
            />
            <Datasets rows={rows} metricNames={names} onShow={(key) => updateView({ dataset: key })} />
            <div className={s.toolbar} role="search">
              <input
                className={s.control}
                type="search"
                aria-label="Search input, output and expected"
                placeholder="Search rows"
                value={view.q}
                onChange={(e) => updateView({ q: e.target.value })}
              />
              <select
                className={s.control}
                aria-label="Filter by status"
                value={view.status}
                onChange={(e) => updateView({ status: e.target.value as StatusFilter })}
              >
                {STATUS_FILTERS.map((f) => (
                  <option key={f} value={f}>
                    {f === 'all' ? 'All statuses' : STATUS_LABEL[f]}
                  </option>
                ))}
              </select>
              {datasets.length ? (
                <select
                  className={s.control}
                  aria-label="Filter by dataset"
                  data-testid="dataset-filter"
                  value={view.dataset ?? ''}
                  onChange={(e) => updateView({ dataset: e.target.value })}
                >
                  <option value="">All datasets</option>
                  {datasets.map((d) => (
                    <option key={d.key} value={d.key}>
                      {datasetKeyLabel(d.key)} ({d.items})
                    </option>
                  ))}
                </select>
              ) : null}
              <span className={s.count} role="status">
                {shown.length} of {rows.length} rows
              </span>
              {view.q ||
              view.status !== 'all' ||
              view.sort !== 'index' ||
              view.dir !== 'asc' ||
              view.dataset ? (
                <button type="button" className={s.btn} onClick={() => updateView(DEFAULT_VIEW)}>
                  Reset view
                </button>
              ) : null}
              <span className={s.grow} />
              <button
                type="button"
                className={s.btn}
                disabled={!shown.length}
                onClick={() =>
                  downloadText(
                    `qym_${safeFilename(data.run.dataset_name ?? 'run')}_${safeFilename(data.run.run_name ?? '')}.csv`,
                    rowsToCsv(shown, names),
                  )
                }
              >
                Export CSV
              </button>
            </div>
            <div className={s.body} data-open={selected ? true : undefined}>
              <div className={s.list}>
                {shown.length ? (
                  <RowList
                    rows={shown}
                    metricNames={names}
                    selected={selectedIndex}
                    sort={view.sort}
                    dir={view.dir}
                    onSort={toggleSort}
                    onOpen={open}
                  />
                ) : (
                  <div className={s.center} role="status">
                    <h2 className={s.centerTitle}>No rows match</h2>
                    <button type="button" className={s.btn} onClick={() => updateView(DEFAULT_VIEW)}>
                      Clear filters
                    </button>
                  </div>
                )}
              </div>
              <aside className={s.right} aria-label="Row detail">
                {selected ? (
                  <Detail
                    ref={detailRef}
                    row={selected}
                    metricNames={names}
                    run={data.run}
                    canEdit={fileMode && data.run.editable !== false}
                    onClose={close}
                    onSaveScore={data.saveScore}
                  />
                ) : (
                  <p className={s.hint}>
                    {rows.some((r) => r.status === 'error')
                      ? 'Select a row or a ribbon cell to read it in full. Red cells are failures.'
                      : 'Select a row or a ribbon cell to read it in full.'}
                  </p>
                )}
              </aside>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
