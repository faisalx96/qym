import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Callout } from '@/features/experiments/launch/components/Callout';
import {
  downloadExport,
  EXPORT_FORMATS,
  useFeedbackList,
  useFeedbackStatus,
  type ExportFormat,
} from '@/api/feedback';
import { useAuth } from '@/features/shell/AuthContext';
import { useDocumentTitle, useMediaQuery } from '@/features/shell/hooks';
import { constrained } from '@/features/shell/layout';
import { useSearchParamsState } from '@/lib/url-state';
import {
  Button,
  Card,
  DataTable,
  DropdownMenu,
  Drawer,
  EmptyState,
  Icon,
  MultiSelect,
  PageHeader,
  SearchField,
  SegmentedControl,
  StaleBanner,
  useToast,
  type Key,
} from '@/ui';
import { DraftsStrip } from './DraftsStrip';
import {
  activeFilterCount,
  apiParams,
  isFiltered,
  metaLine,
  PAGE_SIZE,
  sortToState,
  viewFromParams,
} from './listModel';
import { RequestsTable } from './RequestsTable';
import { FeedbackGlyph } from './FeedbackGlyph';
import styles from './feedback.module.css';

const STATUSES = ['new', 'accepted', 'planned', 'done', 'declined'].map((k) => ({
  key: k,
  label: k.charAt(0).toUpperCase() + k.slice(1),
}));
const PRIORITIES = ['low', 'medium', 'high', 'critical'].map((k) => ({
  key: k,
  label: k.charAt(0).toUpperCase() + k.slice(1),
}));
const COMPLEXITIES = ['S', 'M', 'L', 'XL'].map((k) => ({ key: k, label: k }));
const ABOUT = [
  { key: 'platform', label: 'qym itself' },
  { key: 'product', label: 'A product' },
];

const FRAME_KEY = () => `qym:feedback-list-frame:${typeof window === 'undefined' ? 0 : window.innerWidth}`;
function readFrame(): { rows: number; height: number } {
  try {
    const v = JSON.parse(sessionStorage.getItem(FRAME_KEY()) ?? 'null') as {
      rows?: number;
      height?: number;
    } | null;
    return { rows: Math.max(1, Number(v?.rows) || 8), height: Number(v?.height) || 0 };
  } catch {
    return { rows: 8, height: 0 };
  }
}
function writeFrame(rows: number, height: number) {
  try {
    sessionStorage.setItem(FRAME_KEY(), JSON.stringify({ rows, height: Math.round(height * 10) / 10 }));
  } catch {
    /* storage can be unavailable */
  }
}

export function NewFeedbackButton({ disabled, size = 'md' }: { disabled?: boolean; size?: 'md' | 'sm' }) {
  const navigate = useNavigate();
  const button = (
    <Button
      variant="accent"
      size={size}
      icon={<Icon name="plus" size={14} />}
      isDisabled={disabled}
      onPress={() => navigate('/feedback/new')}
    >
      New feedback
    </Button>
  );
  return disabled ? (
    <span title="An administrator has to connect a model first" data-testid="new-feedback-disabled">
      {button}
    </span>
  ) : (
    button
  );
}

/** /feedback: everything people asked for. Everyone signed in reads it; administrators triage (G2). */
export function FeedbackListPage() {
  useDocumentTitle('Feedback');
  const { isAdmin } = useAuth();
  const toast = useToast();
  const { params, replaceUrlQuery } = useSearchParamsState();
  const view = useMemo(() => viewFromParams(params), [params]);
  const apiQuery = useMemo(() => apiParams(view), [view]);
  const status = useFeedbackStatus();
  const list = useFeedbackList(apiQuery);
  const phone = useMediaQuery('(max-width: 599px)');
  const [drawer, setDrawer] = useState(false);
  const configured = status.data?.configured ?? list.data?.configured ?? true;
  const data = list.data;
  // QE-125: the loading frame is the loaded frame. It draws as many rows as the last page had and keeps the height the
  // table had last time at this width (both remembered for the tab); a first visit draws eight rows.
  const frame = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [remembered] = useState(readFrame);
  const rowsLoaded = data
    ? data.items.length + Object.values(data.children).reduce((n, k) => n + k.length, 0)
    : 0;
  useEffect(() => {
    if (data && frame.current && rowsLoaded > 0)
      writeFrame(rowsLoaded, frame.current.getBoundingClientRect().height);
  }, [data, rowsLoaded]);
  const filtered = isFiltered(view);
  const set = (patch: Record<string, string | string[] | boolean | null>) =>
    replaceUrlQuery({ page: null, ...patch });
  const multi = (key: 'status' | 'about' | 'project' | 'priority' | 'complexity') => (next: Set<Key>) =>
    set({ [key]: [...next].join(',') || null });

  const facetNodes = (
    <>
      <MultiSelect
        label="Status"
        triggerVariant="bar"
        items={STATUSES}
        value={new Set(view.status)}
        onChange={multi('status')}
      />
      <MultiSelect
        label="About"
        triggerVariant="bar"
        items={ABOUT}
        value={new Set(view.about)}
        onChange={multi('about')}
      />
      <MultiSelect
        label="Project"
        triggerVariant="bar"
        items={(data?.facets.projects ?? []).map((p) => ({ key: p.slug, label: p.name, count: p.count }))}
        value={new Set(view.project)}
        onChange={multi('project')}
      />
      <MultiSelect
        label="Priority"
        triggerVariant="bar"
        items={PRIORITIES}
        value={new Set(view.priority)}
        onChange={multi('priority')}
      />
      <MultiSelect
        label="Complexity"
        triggerVariant="bar"
        items={COMPLEXITIES}
        value={new Set(view.complexity)}
        onChange={multi('complexity')}
      />
    </>
  );
  const whose = (
    <SegmentedControl
      label="Whose requests"
      value={view.mine ? 'mine' : 'all'}
      onChange={(v) => set({ mine: v === 'mine' ? '1' : null })}
      options={[
        { value: 'all', label: 'Everyone' },
        { value: 'mine', label: 'Mine' },
      ]}
    />
  );
  const filterRow = phone ? (
    <>
      <Button
        variant={activeFilterCount(view) ? 'accent' : 'neutral'}
        icon={<Icon name="list" size={12} />}
        data-testid="filters-trigger"
        onPress={() => setDrawer(true)}
      >
        Filters{activeFilterCount(view) ? ` · ${activeFilterCount(view)}` : ''}
      </Button>
      <Drawer open={drawer} onOpenChange={setDrawer} title="Filters" width={360}>
        <div className={styles.drawerFacets}>
          {facetNodes}
          {whose}
        </div>
      </Drawer>
    </>
  ) : (
    <div className={styles.filterRow} data-testid="filter-row">
      <span className={styles.facets}>{facetNodes}</span>
      {whose}
    </div>
  );

  const exportMenu = isAdmin ? (
    <ExportMenu
      disabled={!data || data.matching === 0}
      onPick={async (format) => {
        try {
          const name = await downloadExport(format, apiQuery);
          toast.show(`Exported ${name}`, { tone: 'success' });
        } catch {
          toast.show('Couldn’t export the list.', { tone: 'error' });
        }
      }}
    />
  ) : null;

  // QE-150: "/" focuses the search, as on the runs list.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName))) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, []);

  const empty = data && data.counts.all === 0 && !filtered && !list.isFetching;
  return (
    <div className={`${constrained} ${styles.page}`} data-testid="feedback-list-page">
      <PageHeader
        title="Feedback"
        description="Everything people asked for, with the assistant's proposed priority and complexity. Admins triage."
        meta={data ? metaLine(data.counts) : undefined}
        actions={<NewFeedbackButton disabled={!configured} />}
      />
      {!configured ? (
        <Callout tone="warning" title="The feedback assistant is not set up">
          You can read every request. New feedback opens once an administrator connects a model.
        </Callout>
      ) : data ? (
        <DraftsStrip drafts={data.drafts} />
      ) : null}
      {list.isError && data ? (
        <StaleBanner
          since={new Date(list.dataUpdatedAt)}
          filtersApplied
          onRetry={() => void list.refetch()}
        />
      ) : null}
      {empty ? (
        <Card as="section" aria-label="No feedback">
          <EmptyState
            icon={<FeedbackGlyph size={48} />}
            title="No feedback yet"
            body="Tell the assistant what you need and it turns it into a request the team can act on."
            action={<NewFeedbackButton disabled={!configured} />}
          />
        </Card>
      ) : (
        <div
          ref={frame}
          className={styles.tableFrame}
          style={!data && remembered.height ? { minBlockSize: remembered.height } : undefined}
          data-testid="feedback-table-frame"
        >
          <RequestsTable
            data={data}
            loading={list.isPending}
            error={list.error}
            onRetry={() => void list.refetch()}
            sort={sortToState(view.sort)}
            onSortChange={(s) => set({ sort: s ? `${s.key}:${s.direction}` : null })}
            filtered={filtered}
            lastCount={remembered.rows}
            toolbar={
              <DataTable.Toolbar
                search={
                  <SearchField
                    ref={searchRef}
                    label="Search requests"
                    placeholder="Search requests"
                    width="100%"
                    value={view.q}
                    onChange={(q) => set({ q: q || null })}
                    onClear={() => set({ q: null })}
                  />
                }
                rows={filterRow}
                count={`${data?.matching ?? 0} ${data?.matching === 1 ? 'request' : 'requests'}`}
                trailing={exportMenu}
                columnsMenu={false}
                densityMenu={false}
              />
            }
            footer={
              <DataTable.Footer
                testId="feedback-footer"
                ariaLabel="Feedback status"
                pagination={
                  data && data.total > PAGE_SIZE
                    ? {
                        total: data.total,
                        page: view.page,
                        pageSize: PAGE_SIZE,
                        noun: 'requests',
                        onPageChange: (page) => replaceUrlQuery({ page: page > 1 ? page : null }),
                      }
                    : undefined
                }
              />
            }
          />
        </div>
      )}
    </div>
  );
}

function ExportMenu({ disabled, onPick }: { disabled: boolean; onPick: (f: ExportFormat) => void }) {
  const trigger = (
    <Button
      variant="neutral"
      size="sm"
      icon={<Icon name="download" size={12} />}
      isDisabled={disabled}
      data-testid="export-menu"
    >
      Export
    </Button>
  );
  if (disabled)
    return (
      <span className={styles.exportWrap} title="No requests to export" data-testid="export-disabled">
        {trigger}
      </span>
    );
  return (
    <DropdownMenu
      label="Export format"
      trigger={trigger}
      items={EXPORT_FORMATS.map((f) => ({ id: f.id, label: f.label }))}
      onAction={(id) => onPick(id as ExportFormat)}
    />
  );
}
