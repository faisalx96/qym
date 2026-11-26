import { isPerformanceRunActive } from '@/api/performance';
import { useState } from 'react';
import {
  usePlatformDiscovery,
  type PlatformRunRead,
  type PlatformPlanInput,
  type PlatformDiscoveryRow,
} from '@/api/performancePlatform';
import { Card, CardTitle, DataTable, InlineNotice, KeyValueGrid, type Column, type KeyValueItem } from '@/ui';
import { textDirAttrs } from '@/lib/text';
import { count, secs, span } from '../../lib/format';
import { REASON_WORDS, ROUTE_LABELS, platformCount } from './words';
import styles from './platform.module.css';

export function planFacts(plan: PlatformPlanInput): KeyValueItem[] {
  return [
    ...('baseline_users' in plan
      ? [
          {
            key: 'Load',
            value: `${plan.baseline_users} to ${platformCount(plan.max_users, 'user')}, adding ${platformCount(plan.step_users, 'user')} each level`,
          },
          { key: 'Each level', value: span(plan.hold_seconds) },
          { key: 'Between levels', value: span(plan.ramp_seconds) },
          { key: 'Stop at a break', value: plan.abort_on_break ? 'Yes' : 'No' },
        ]
      : [
          { key: 'Load', value: 'One user; each runnable dashboard once' },
          {
            key: 'Maximum run length',
            value:
              plan.smoke_max_duration_seconds == null
                ? 'Calculated after discovery'
                : span(plan.smoke_max_duration_seconds),
          },
        ]),
    { key: 'Dashboard open p95 limit', value: secs(plan.limit_ms), mono: true },
    { key: 'Errors under', value: `${plan.max_error_rate_pct}%`, mono: true },
    { key: 'Filter time reference', value: secs(plan.filter_reference_ms), mono: true },
    {
      key: 'Dashboards',
      value:
        plan.max_dashboards == null
          ? 'All dashboards the account can see'
          : `Up to ${platformCount(plan.max_dashboards, 'dashboard')}`,
    },
    {
      key: 'Filters per dashboard',
      value: plan.filters_per_dashboard === 'all' ? 'All filters' : count(plan.filters_per_dashboard),
    },
    { key: 'Next dashboard', value: plan.pick === 'random' ? 'At random' : 'In turn' },
    { key: 'Pause between dashboards', value: span(plan.pause_seconds) },
    {
      key: 'Request timeout',
      value: plan.timeout_seconds == null ? 'Automatic' : span(plan.timeout_seconds),
    },
    { key: 'Discovery time', value: span(plan.discovery_budget_seconds) },
    { key: 'Time to replace sign-in', value: span(plan.handoff_wait_seconds) },
  ];
}
export function PlatformSetupTab({
  slug,
  runId,
  read,
}: {
  slug: string;
  runId: string;
  read: PlatformRunRead;
}) {
  const [page, setPage] = useState(1);
  const discovery = usePlatformDiscovery(
    slug,
    runId,
    { page, page_size: 50 },
    { active: isPerformanceRunActive(read.effective_status) },
  );
  const facts = read.discovery;
  const resolved = facts?.resolved_plan;
  const columns: Column<PlatformDiscoveryRow>[] = [
    {
      id: 'dashboard',
      header: 'Dashboard',
      cell: (r) => (
        <div className={styles.title}>
          <span dir="auto">{r.title || String(r.id)}</span>
        </div>
      ),
    },
    {
      id: 'usable',
      header: 'Charts usable',
      type: 'number',
      cell: (r) => `${r.charts_usable} of ${r.charts_found}`,
    },
    {
      id: 'missing',
      header: 'Charts not loaded',
      wrap: true,
      cell: (r) =>
        !r.detail_loaded ? (
          'Dashboard details could not be loaded'
        ) : r.charts_unusable.length ? (
          <div className={styles.stack}>
            {r.charts_unusable.map((chart, i) => (
              <div key={i}>
                Chart <span className={styles.number}>{JSON.stringify(chart.id)}</span>:{' '}
                {REASON_WORDS[chart.reason_class] ?? 'Could not be loaded'}
                {chart.http_status ? ` (${chart.http_status})` : ''}
              </div>
            ))}
          </div>
        ) : (
          'None'
        ),
    },
  ];
  return (
    <div className={styles.stack}>
      <Card header={<CardTitle title="Plan as started" />}>
        <KeyValueGrid items={planFacts(read.config.plan)} />
      </Card>
      <Card header={<CardTitle title="Plan after discovery" />}>
        {resolved ? (
          <KeyValueGrid
            items={[
              { key: 'Run length', value: span(resolved.total_seconds), mono: true },
              { key: 'Dashboards', value: count(resolved.dashboard_ids.length), mono: true },
              { key: 'Levels', value: resolved.levels.join(', '), mono: true },
              {
                key: 'Visits',
                value:
                  resolved.iterations == null
                    ? 'Repeated for the planned run length'
                    : count(resolved.iterations),
              },
              { key: 'Baseline', value: span(resolved.baseline_seconds) },
              { key: 'Theme', value: resolved.theme === 'black' ? 'Black' : 'Blue' },
            ]}
          />
        ) : (
          <p className={styles.note}>The plan is resolved after discovery.</p>
        )}
      </Card>
      <Card header={<CardTitle title="Discovery" />}>
        <KeyValueGrid
          items={[
            { key: 'Dashboards visible', value: count(facts?.counts.dashboards_visible), mono: true },
            { key: 'Dashboards selected', value: count(facts?.counts.dashboards_selected), mono: true },
            { key: 'Runnable dashboards', value: count(facts?.counts.dashboards_runnable), mono: true },
            { key: 'Charts found', value: count(facts?.counts.charts_found), mono: true },
            { key: 'Charts usable', value: count(facts?.counts.charts_usable), mono: true },
            { key: 'Filters found', value: count(facts?.counts.filters_found), mono: true },
            { key: 'Discovery time', value: span(facts?.duration_s), mono: true },
            { key: 'Active discovery time', value: span(facts?.active_duration_s), mono: true },
          ]}
        />
        {facts?.partial ? (
          <InlineNotice tone="warning">
            Discovery was incomplete. Some dashboards or charts could not be checked within this run.
          </InlineNotice>
        ) : null}
        {facts?.selection_limited ? (
          <p className={styles.note}>The dashboard limit selected only part of the account.</p>
        ) : null}
      </Card>
      <Card
        flush
        header={
          <CardTitle
            title="Charts not loaded"
            description="Chart identifiers and reasons reported during discovery. Timing covers usable charts only."
          />
        }
      >
        <DataTable
          aria-label="Discovery charts"
          variant="embedded"
          rows={discovery.data?.rows ?? []}
          columns={columns}
          rowKey={(r) => JSON.stringify(r.id)}
          responsive="scroll"
          loading={discovery.isPending}
          error={discovery.error}
          errorTitle="Couldn’t load discovery"
          onRetry={() => void discovery.refetch()}
        >
          <DataTable.Footer
            pagination={{
              total: discovery.data?.total ?? 0,
              page,
              pageSize: 50,
              onPageChange: setPage,
              noun: platformCount(discovery.data?.total ?? 0, 'dashboard', true),
            }}
          />
        </DataTable>
      </Card>
      <Card header={<CardTitle title="Target settings as started" />}>
        <KeyValueGrid
          items={[
            { key: 'Target', value: read.config.target.name },
            { key: 'Kind', value: 'Estishraf platform' },
            { key: 'Address', value: read.config.target.base_url },
            { key: 'Production', value: read.config.target.is_production ? 'Yes' : 'No' },
            { key: 'Highest users', value: count(read.config.target.max_users), mono: true },
            { key: 'Longest run', value: span(read.config.target.max_duration_s), mono: true },
            { key: 'Client id', value: read.config.target.settings.client_id },
            {
              key: 'Request timeout',
              value:
                read.config.target.settings.request_timeout_seconds == null
                  ? 'Automatic'
                  : span(read.config.target.settings.request_timeout_seconds),
            },
            ...Object.entries(read.config.target.settings.routes).map(([key, value]) => ({
              key: ROUTE_LABELS[key] ?? 'Route',
              value,
              mono: true,
            })),
          ]}
        />
      </Card>
      {read.config.note ? (
        <Card header={<CardTitle title="Note" />}>
          <div {...textDirAttrs(read.config.note)}>{read.config.note}</div>
        </Card>
      ) : null}
    </div>
  );
}
