/** Fictional Lane F story from options/data.js, expressed in the platform page contract. */
import type { PerformanceReceived, PerformanceLogPage, PerformanceRunEvents } from '@/api/performance';
import type {
  PlatformTarget,
  PlatformSetup,
  PlatformRunRead,
  PlatformDashboardRow,
  PlatformDiscoveryRow,
  PlatformStepRow,
  PlatformSummaryLevel,
  PlatformResolvedPlan,
  PlatformErrors,
  MixedPerformanceHome,
} from '@/api/performancePlatform';
import { performanceSetup, performanceHomeIdle, performanceTargetPreprod } from '../dev/performanceFixtures';

const contractRun: PlatformRunRead = {
  server_time: '2026-11-25T16:04:36Z',
  run: {
    id: 'run-1',
    number: 1,
    target_kind: 'estishraf_platform',
    test_type: 'breakpoint',
    status: 'finished',
    verdict: 'not_reached',
    target: {
      id: 'target-1',
      name: 'Estishraf · Preprod',
      kind: 'estishraf_platform',
      is_production: false,
      base_url: 'https://platform.example.test',
    },
    requested_by: 'Operator',
    requested_by_user_id: 'user-1',
    requested_at: '2026-11-25T16:00:01Z',
    started_at: '2026-11-25T16:00:05Z',
    finished_at: '2026-11-25T16:04:35Z',
    safe_load_users: 1,
    recommended_max_users: 1,
    breaking_level_users: null,
    breaking_reason: null,
    p95_at_safe_load_ms: 1000,
    p95_at_break_ms: null,
    error_rate_pct: 1.6666666666666667,
    open_p95_ms: 1000,
    filter_p95_ms: 500,
    opens_measured: 1,
    opens_total: 3,
    filters_total: 3,
    charts_drawn: 3,
    charts_failed: 0,
    duration_s: 270,
    max_users: 1,
    highest_tested_users: 1,
    discovery_counts: {
      dashboards_visible: 1,
      dashboards_discovered: 1,
      dashboards_selected: 1,
      dashboards_runnable: 1,
      charts_found: 1,
      charts_usable: 1,
      charts_unusable: 0,
      filters_found: 1,
      skipped_by_budget: 0,
    },
    coverage: 'complete',
    coverage_counts: {
      dashboards_selected: 1,
      dashboards_runnable: 1,
      dashboards_exercised: 1,
      dashboards_unexercised: 0,
      dashboards_unusable: 0,
      charts_found: 1,
      charts_usable: 1,
      charts_unusable: 0,
      discovery_partial: false,
      discovery_reasons: [],
      selection_limited: false,
    },
    status_reason: null,
    note: '',
    has_report: true,
    stored_status: 'finished',
    claimed_at: '2026-11-25T16:00:01Z',
    last_report_at: '2026-11-25T16:04:36Z',
    stop_requested_at: null,
    stop_requested_by: null,
    stop_requested_by_user_id: null,
    stop_reason: null,
    error: null,
    exit_code: 0,
  },
  effective_status: 'finished',
  status_reason: null,
  config: {
    schema: 1,
    test_type: 'breakpoint',
    target: {
      id: 'target-1',
      name: 'Estishraf · Preprod',
      kind: 'estishraf_platform',
      is_production: false,
      base_url: 'https://platform.example.test',
      settings: {
        routes: {
          session: '/api/auth/session',
          token_refresh: '/api/auth/oauth2/token',
          health_check: '/api/user-management/user/health-check',
          my_topics: '/api/core/topic/user',
          dashboards: '/api/core/dashboard/client-dashboard?page={page}&pageSize={page_size}',
          dashboard: '/api/core/dashboard/client-dashboard/{dashboard_id}',
          dashboard_logo: '/api/core/dashboard/client-dashboard/{dashboard_id}/logo',
          latest_insights: '/api/core/insight/client-insight',
          dashboard_background: '/api/core/dashboard/background-image/{dashboard_id}',
          insight_last_update: '/api/core/insight/last-update/{insight_id}',
          siblings: '/api/core/dashboard/client-dashboard/?topicId={topic_id}',
          chart_wrapper: '/api/chart?insightId={insight_id}&theme={theme}',
          chart_layout: '/chart-assets/{insight_id}/_dash-layout?theme={theme}',
          chart_dependencies: '/chart-assets/{insight_id}/_dash-dependencies?theme={theme}',
          chart_callback: '/chart-assets/{insight_id}/_dash-update-component?theme={theme}',
        },
        client_id: 'estishraf',
        request_timeout_seconds: null,
      },
      max_users: 200,
      max_duration_s: 28800,
    },
    tokens: [
      {
        name: 'session_cookie',
        hint: '2 cookies, saved 2026-11-25T16:00:00Z',
        version: 1,
      },
    ],
    plan: {
      baseline_users: 1,
      max_users: 1,
      step_users: 1,
      hold_seconds: 120,
      ramp_seconds: 30,
      limit_ms: 10000,
      max_error_rate_pct: 5,
      abort_on_break: true,
      pause_seconds: 5,
      filters_per_dashboard: 'all',
      pick: 'random',
      max_dashboards: null,
      timeout_seconds: 60,
      handoff_wait_seconds: 600,
      discovery_budget_seconds: 300,
      filter_reference_ms: 5000,
    },
    note: '',
  },
  progress: null,
  summary: {
    schema: 1,
    target_kind: 'estishraf_platform',
    test_type: 'breakpoint',
    identity: {
      run_id: 'run-1',
      run_number: 1,
      project_name: 'Performance',
      target_name: 'Estishraf · Preprod',
    },
    verdict: 'not_reached',
    verdict_reason: 'No break up to 1 user',
    source_verdict_reason:
      'All clean levels with data stayed within the configured dashboard-ready latency and error limits.',
    ended_by: 'plan',
    exit_code: 0,
    started_at: '2026-11-25T16:00:05Z',
    ended_at: '2026-11-25T16:04:35Z',
    target_url: 'https://platform.example.test',
    headline: {
      safe_load_users: 1,
      recommended_max_users: 1,
      breaking_level_users: null,
      breaking_reason: null,
      p95_at_safe_load_ms: 1000,
      p95_at_break_ms: null,
      error_rate_pct: 1.6666666666666667,
      open_p95_ms: 1000,
      filter_p95_ms: 500,
      opens_measured: 1,
      opens_total: 3,
      filters_total: 3,
      charts_drawn: 3,
      charts_failed: 0,
      duration_s: 270,
      max_users: 1,
      highest_tested_users: 1,
    },
    thresholds: [
      {
        scope: 'run',
        level: null,
        metric: 'dashboard_ready',
        expression: 'p(95)<10000',
        measured: 1000,
        ok: true,
      },
      {
        scope: 'run',
        level: null,
        metric: 'journey_errors',
        expression: 'rate<0.05',
        measured: 0.016666666666666666,
        ok: true,
      },
      {
        scope: 'level',
        level: 1,
        metric: 'j_level_ready',
        expression: 'p(95)<10000',
        measured: 1000,
        ok: true,
      },
      {
        scope: 'level',
        level: 1,
        metric: 'j_level_errors',
        expression: 'rate<0.05',
        measured: 0.025,
        ok: true,
      },
    ],
    levels: [
      {
        level: 1,
        role: 'hold',
        start_s: 90,
        end_s: 210,
        actual_duration_s: 120,
        hold_elapsed_pct: 100,
        per_minute: 0.5,
        has_data: true,
        passed: true,
        latency_breach: false,
        error_breach: false,
        auth_contaminated: false,
        result: 'pass',
        requests: 40,
        request_outcomes: 40,
        failed_request_outcomes: 1,
        dashboards_opened: 1,
        filters_applied: 1,
        charts_drawn: 1,
        chart_unavailable_errors: 0,
        charts_failed: 0,
        errors_by_class: {
          auth: 0,
          chart_unavailable: 0,
          callback_error: 1,
          timeout: 0,
          server_error: 0,
          client_error: 0,
        },
        open_p50_ms: 1000,
        open_p95_ms: 1000,
        open_p99_ms: 1000,
        open_max_ms: 1000,
        filter_p50_ms: 500,
        filter_p95_ms: 500,
        filter_max_ms: 500,
        error_rate_pct: 2.5,
        auth_error_rate_pct: 0,
        auth_waits: 0,
        auth_wait_recovered: 0,
      },
    ],
    overall: {
      request_outcomes: 60,
      failed_request_outcomes: 1,
      error_rate_pct: 1.6666666666666667,
      errors_by_class: {
        auth: 0,
        chart_unavailable: 0,
        callback_error: 1,
        timeout: 0,
        server_error: 0,
        client_error: 0,
      },
      chart_unavailable_errors: 0,
    },
    auth: {
      recovered: 0,
      unrecovered: 0,
      broker_pickups: 0,
      refreshes: 0,
      refresh_failures: 0,
      waits: 0,
      wait_recovered: 0,
      incident: null,
      handoffs: [],
      handoffs_omitted: 0,
    },
    counts: {
      planned_iterations: null,
      completed_iterations: 3,
      records_received: 7,
      records_dropped: 0,
    },
    plan: {
      users: null,
      iterations: null,
      smoke_max_duration_seconds: null,
      levels: [1],
      stages: [
        {
          role: 'baseline',
          target_users: 1,
          start_s: 0,
          end_s: 60,
        },
        {
          role: 'ramp',
          target_users: 1,
          start_s: 60,
          end_s: 90,
        },
        {
          role: 'hold',
          target_users: 1,
          start_s: 90,
          end_s: 210,
        },
        {
          role: 'cooldown',
          target_users: 1,
          start_s: 210,
          end_s: 240,
        },
        {
          role: 'cooldown',
          target_users: 0,
          start_s: 240,
          end_s: 270,
        },
      ],
      total_seconds: 270,
      dashboard_ids: [101],
      theme: 'blue',
      chart_batch: 6,
      baseline_seconds: 60,
      abort_grace_seconds: 30,
    },
    coverage: 'complete',
    coverage_counts: {
      dashboards_selected: 1,
      dashboards_runnable: 1,
      dashboards_exercised: 1,
      dashboards_unexercised: 0,
      dashboards_unusable: 0,
      charts_found: 1,
      charts_usable: 1,
      charts_unusable: 0,
      discovery_partial: false,
      discovery_reasons: [],
      selection_limited: false,
    },
    measurements: {
      source_complete: true,
      percentiles_complete: true,
      percentile_basis: 'all_completed_steps',
      reason: null,
      records_retained: 7,
    },
  },
  discovery: {
    schema: 1,
    target_kind: 'estishraf_platform',
    started_at: '2026-11-25T16:00:02Z',
    ended_at: '2026-11-25T16:00:04Z',
    duration_s: 2,
    active_duration_s: 2,
    partial: false,
    partial_reasons: [],
    selection_limited: false,
    counts: {
      dashboards_visible: 1,
      dashboards_discovered: 1,
      dashboards_selected: 1,
      dashboards_runnable: 1,
      charts_found: 1,
      charts_usable: 1,
      charts_unusable: 0,
      filters_found: 1,
      skipped_by_budget: 0,
    },
    titles_truncated: 0,
    resolved_plan: {
      users: null,
      iterations: null,
      smoke_max_duration_seconds: null,
      levels: [1],
      stages: [
        {
          role: 'baseline',
          target_users: 1,
          start_s: 0,
          end_s: 60,
        },
        {
          role: 'ramp',
          target_users: 1,
          start_s: 60,
          end_s: 90,
        },
        {
          role: 'hold',
          target_users: 1,
          start_s: 90,
          end_s: 210,
        },
        {
          role: 'cooldown',
          target_users: 1,
          start_s: 210,
          end_s: 240,
        },
        {
          role: 'cooldown',
          target_users: 0,
          start_s: 240,
          end_s: 270,
        },
      ],
      total_seconds: 270,
      dashboard_ids: [101],
      theme: 'blue',
      chart_batch: 6,
      baseline_seconds: 60,
      abort_grace_seconds: 30,
    },
  },
  dashboard_results: {
    total: 1,
    url: '/api/projects/performance/performance/runs/run-1/dashboards',
  },
  seconds_since_report: 0,
  runner: {
    name: 'Performance runner',
    reported_state: 'finishing',
    seconds_since_heartbeat: 1,
    fresh: true,
    stale: false,
  },
  stop_requested: false,
  token_needed: null,
  tokens: [
    {
      name: 'session_cookie',
      hint: '2 cookies, saved 2026-11-25T16:00:00Z',
      version: 1,
      expires_at: null,
      expired: false,
      updated_at: '2026-11-25T16:00:00Z',
      updated_by: 'Operator',
      updated_by_user_id: 'user-1',
    },
  ],
  report: {
    byte_size: 100000,
    sha256: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    received_at: '2026-11-25T16:04:35Z',
    expires_at: '2026-12-25T16:04:35Z',
    url: '/api/projects/performance/performance/runs/run-1/report',
  },
  report_expired: false,
  counts: {
    steps_received: 7,
    steps_dropped: 0,
    steps_stored: 7,
    log_lines_received: 10,
    log_lines_dropped: 0,
    events: 5,
  },
  late_results_until: '2026-11-25T16:14:36Z',
  can: {
    stop: false,
    hand_off_token: false,
  },
};
const contractTarget: PlatformTarget = {
  id: 'target-1',
  kind: 'estishraf_platform',
  name: 'Estishraf · Preprod',
  is_production: false,
  base_url: 'https://platform.example.test',
  max_users: null,
  max_duration_s: null,
  settings: {
    routes: {
      session: '/api/auth/session',
      token_refresh: '/api/auth/oauth2/token',
      health_check: '/api/user-management/user/health-check',
      my_topics: '/api/core/topic/user',
      dashboards: '/api/core/dashboard/client-dashboard?page={page}&pageSize={page_size}',
      dashboard: '/api/core/dashboard/client-dashboard/{dashboard_id}',
      dashboard_logo: '/api/core/dashboard/client-dashboard/{dashboard_id}/logo',
      latest_insights: '/api/core/insight/client-insight',
      dashboard_background: '/api/core/dashboard/background-image/{dashboard_id}',
      insight_last_update: '/api/core/insight/last-update/{insight_id}',
      siblings: '/api/core/dashboard/client-dashboard/?topicId={topic_id}',
      chart_wrapper: '/api/chart?insightId={insight_id}&theme={theme}',
      chart_layout: '/chart-assets/{insight_id}/_dash-layout?theme={theme}',
      chart_dependencies: '/chart-assets/{insight_id}/_dash-dependencies?theme={theme}',
      chart_callback: '/chart-assets/{insight_id}/_dash-update-component?theme={theme}',
    },
    client_id: 'estishraf',
    request_timeout_seconds: null,
  },
  tokens: [
    {
      name: 'session_cookie',
      hint: '2 cookies, saved 2026-11-25T16:00:00Z',
      version: 1,
      expires_at: null,
      expired: false,
      updated_at: '2026-11-25T16:00:00Z',
      updated_by: 'Operator',
      updated_by_user_id: 'user-1',
    },
  ],
  sign_in_ready: true,
  active_run_id: null,
  can_start: true,
  can_save_tokens: true,
  archived_at: null,
  created_by: 'Manager',
  created_by_user_id: 'user-2',
  created_at: '2026-11-25T15:00:00Z',
  updated_at: '2026-11-25T16:00:00Z',
  last_run: null,
};
const platformOptions: PlatformSetup['platform'] = {
  supported: true,
  blocked: null,
  defaults: {
    test_type: 'breakpoint',
    breakpoint: {
      baseline_users: 1,
      max_users: 10,
      step_users: 1,
      hold_seconds: 120,
      ramp_seconds: 30,
      limit_ms: 10000,
      max_error_rate_pct: 5,
      abort_on_break: true,
      pause_seconds: 5,
      filters_per_dashboard: 'all',
      pick: 'random',
      max_dashboards: null,
      timeout_seconds: null,
      handoff_wait_seconds: 600,
      discovery_budget_seconds: 300,
      filter_reference_ms: 5000,
    },
    smoke: {
      users: 1,
      smoke_max_duration_seconds: null,
      limit_ms: 10000,
      max_error_rate_pct: 5,
      filter_reference_ms: 5000,
      pause_seconds: 5,
      filters_per_dashboard: 'all',
      pick: 'roundrobin',
      max_dashboards: null,
      timeout_seconds: null,
      handoff_wait_seconds: 600,
      discovery_budget_seconds: 300,
    },
  },
  limits: {
    baseline_users: [1, 200],
    max_users: [1, 200],
    step_users: [1, 200],
    hold_seconds: [30, 3600],
    ramp_seconds: [0, 3600],
    limit_ms: [1000, 900000],
    max_error_rate_pct: [1, 100],
    filter_reference_ms: [1, 900000],
    users: [1, 1],
    smoke_max_duration_seconds: [1, 28800],
    pause_seconds: [0, 3600],
    filters_per_dashboard: [0, 10000],
    max_dashboards: [1, 10000],
    timeout_seconds: [30, 900],
    handoff_wait_seconds: [1, 3600],
    discovery_budget_seconds: [1, 3600],
    max_total_seconds: 28800,
    dashboards_per_run_max: 10000,
    discovery_max_bytes: 16777216,
    steps_per_run_max: 50000,
  },
  target_defaults: {
    settings: {
      routes: {
        session: '/api/auth/session',
        token_refresh: '/api/auth/oauth2/token',
        health_check: '/api/user-management/user/health-check',
        my_topics: '/api/core/topic/user',
        dashboards: '/api/core/dashboard/client-dashboard?page={page}&pageSize={page_size}',
        dashboard: '/api/core/dashboard/client-dashboard/{dashboard_id}',
        dashboard_logo: '/api/core/dashboard/client-dashboard/{dashboard_id}/logo',
        latest_insights: '/api/core/insight/client-insight',
        dashboard_background: '/api/core/dashboard/background-image/{dashboard_id}',
        insight_last_update: '/api/core/insight/last-update/{insight_id}',
        siblings: '/api/core/dashboard/client-dashboard/?topicId={topic_id}',
        chart_wrapper: '/api/chart?insightId={insight_id}&theme={theme}',
        chart_layout: '/chart-assets/{insight_id}/_dash-layout?theme={theme}',
        chart_dependencies: '/chart-assets/{insight_id}/_dash-dependencies?theme={theme}',
        chart_callback: '/chart-assets/{insight_id}/_dash-update-component?theme={theme}',
      },
      client_id: 'estishraf',
      request_timeout_seconds: null,
    },
  },
};
const storyDashboards = [
  {
    title: 'مؤشرات السكان',
    charts: 8,
    filters: 3,
    opens: 54,
    p50: 2.4,
    p95: 4.1,
    filter: 1.7,
    errors: 0,
    failed: 0,
  },
  {
    title: 'سوق العمل',
    charts: 9,
    filters: 3,
    opens: 51,
    p50: 3.1,
    p95: 5.2,
    filter: 2.2,
    errors: 0,
    failed: 0,
  },
  {
    title: 'التجارة الخارجية',
    charts: 10,
    filters: 4,
    opens: 48,
    p50: 6.8,
    p95: 12.6,
    filter: 4.8,
    errors: 5.9,
    failed: 3,
  },
  {
    title: 'الحركة عبر المنافذ',
    charts: 8,
    filters: 3,
    opens: 47,
    p50: 6.2,
    p95: 11.8,
    filter: 4.1,
    errors: 0.3,
    failed: 0,
  },
  {
    title: 'النشاط الصناعي',
    charts: 8,
    filters: 3,
    opens: 49,
    p50: 2.7,
    p95: 4.7,
    filter: 1.9,
    errors: 0,
    failed: 0,
  },
  {
    title: 'التعليم والتدريب',
    charts: 7,
    filters: 2,
    opens: 52,
    p50: 2.2,
    p95: 3.8,
    filter: 1.4,
    errors: 0,
    failed: 0,
  },
  {
    title: 'الصحة العامة',
    charts: 7,
    filters: 3,
    opens: 50,
    p50: 2.9,
    p95: 4.9,
    filter: 1.8,
    errors: 0.2,
    failed: 0,
  },
  {
    title: 'الإسكان',
    charts: 6,
    filters: 2,
    opens: 51,
    p50: 1.9,
    p95: 3.4,
    filter: 1.2,
    errors: 0,
    failed: 0,
  },
  {
    title: 'النقل والخدمات اللوجستية',
    charts: 7,
    filters: 2,
    opens: 48,
    p50: 3.2,
    p95: 5.4,
    filter: 2.1,
    errors: 0,
    failed: 0,
  },
  {
    title: 'السياحة',
    charts: 6,
    filters: 2,
    opens: 50,
    p50: 2.5,
    p95: 4.2,
    filter: 1.6,
    errors: 0,
    failed: 0,
  },
  {
    title: 'الطاقة',
    charts: 6,
    filters: 2,
    opens: 49,
    p50: 2.8,
    p95: 4.8,
    filter: 1.8,
    errors: 0,
    failed: 0,
  },
  {
    title: 'الاستثمار',
    charts: 5,
    filters: 2,
    opens: 51,
    p50: 2.6,
    p95: 4.4,
    filter: 1.5,
    errors: 0,
    failed: 0,
  },
];
const storyLevels = [
  {
    users: 1,
    opens: 19,
    p50: 2.1,
    p95: 3.4,
    filter: 1.2,
    errors: 0.4,
  },
  {
    users: 2,
    opens: 34,
    p50: 2.4,
    p95: 3.9,
    filter: 1.4,
    errors: 0.4,
  },
  {
    users: 3,
    opens: 48,
    p50: 2.8,
    p95: 4.5,
    filter: 1.7,
    errors: 0.5,
  },
  {
    users: 4,
    opens: 65,
    p50: 3.2,
    p95: 5.2,
    filter: 2,
    errors: 0.5,
  },
  {
    users: 5,
    opens: 81,
    p50: 3.7,
    p95: 6.3,
    filter: 2.4,
    errors: 0.6,
  },
  {
    users: 6,
    opens: 98,
    p50: 4.3,
    p95: 7.4,
    filter: 2.8,
    errors: 0.6,
  },
  {
    users: 7,
    opens: 115,
    p50: 5.1,
    p95: 8.9,
    filter: 3.3,
    errors: 0.6,
  },
  {
    users: 8,
    opens: 140,
    p50: 6.9,
    p95: 11.4,
    filter: 4.2,
    errors: 0.6,
  },
];

export const platformProjectSlug = 'demo';
export const PLATFORM_FIXTURE_STATES = [
  'finished',
  'smoke',
  'running',
  'waiting',
  'discovery',
  'failed',
  'stopped',
  'interrupted',
  'stopping',
] as const;
export type PlatformFixtureState = (typeof PLATFORM_FIXTURE_STATES)[number];
const emptyErrors = (): PlatformErrors => ({
  auth: 0,
  chart_unavailable: 0,
  callback_error: 0,
  timeout: 0,
  server_error: 0,
  client_error: 0,
});
export const platformTarget: PlatformTarget = {
  ...contractTarget,
  id: 'platform',
  name: 'QA - Estishraf platform (stand-in)',
  base_url: 'https://platform.qa-target.example.test',
  max_users: 10,
  max_duration_s: 3600,
  tokens: [
    {
      ...contractTarget.tokens[0]!,
      hint: '6 cookies, saved 2026-11-25T15:26:00Z',
      updated_at: '2026-11-25T15:26:00Z',
    },
  ],
};
export const platformSetup: PlatformSetup = {
  ...performanceSetup,
  targets: [performanceTargetPreprod, platformTarget],
  runner: performanceSetup.runner
    ? {
        ...performanceSetup.runner,
        info: { ...performanceSetup.runner.info, supported_target_kinds: ['chat', 'estishraf_platform'] },
      }
    : null,
  platform: platformOptions,
};
export const platformDiscoveryRows: PlatformDiscoveryRow[] = storyDashboards.map((row, index) => ({
  id: 101 + index,
  title: row.title,
  detail_loaded: true,
  runnable: true,
  charts_found: row.charts,
  charts_usable: row.charts - row.failed,
  filters_found: row.filters,
  charts_unusable:
    index === 2
      ? [
          { id: 82801, reason_class: 'server_error', http_status: 502 },
          { id: 82802, reason_class: 'server_error', http_status: 502 },
          { id: 82803, reason_class: 'no_server_callback', http_status: null },
        ]
      : [],
}));
export const platformDashboards: PlatformDashboardRow[] = storyDashboards.map((row, index) => ({
  dashboard_id: 101 + index,
  title: row.title,
  opens: row.opens,
  filters: row.opens * 2,
  open_p50_ms: row.p50 * 1000,
  open_p95_ms: row.p95 * 1000,
  filter_p95_ms: row.filter * 1000,
  charts_drawn: row.opens * (row.charts - row.failed),
  charts_failed: 0,
  errors_by_class: { ...emptyErrors(), callback_error: index === 2 ? 12 : 0 },
  charts_unusable: row.failed,
  detail_loaded: true,
  measurement_complete: true,
}));
const discoveryCounts = {
  dashboards_visible: 12,
  dashboards_discovered: 12,
  dashboards_selected: 12,
  dashboards_runnable: 12,
  charts_found: 87,
  charts_usable: 84,
  charts_unusable: 3,
  filters_found: 31,
  skipped_by_budget: 0,
};
const coverageCounts = {
  dashboards_selected: 12,
  dashboards_runnable: 12,
  dashboards_exercised: 12,
  dashboards_unexercised: 0,
  dashboards_unusable: 0,
  charts_found: 87,
  charts_usable: 84,
  charts_unusable: 3,
  discovery_partial: false,
  discovery_reasons: [],
  selection_limited: false,
};
const resolved: PlatformResolvedPlan = {
  users: null,
  iterations: null,
  smoke_max_duration_seconds: null,
  levels: Array.from({ length: 10 }, (_, i) => i + 1),
  stages: [
    { role: 'baseline', target_users: 1, start_s: 0, end_s: 60 },
    ...Array.from({ length: 10 }, (_, i) => [
      { role: 'ramp' as const, target_users: i + 1, start_s: 60 + i * 150, end_s: 90 + i * 150 },
      { role: 'hold' as const, target_users: i + 1, start_s: 90 + i * 150, end_s: 210 + i * 150 },
    ]).flat(),
    { role: 'cooldown', target_users: 1, start_s: 1560, end_s: 1590 },
    { role: 'cooldown', target_users: 0, start_s: 1590, end_s: 1620 },
  ],
  total_seconds: 1620,
  dashboard_ids: platformDiscoveryRows.map((row) => row.id),
  theme: 'blue',
  chart_batch: 6,
  baseline_seconds: 60,
  abort_grace_seconds: 30,
};
const levels: PlatformSummaryLevel[] = resolved.levels.map((level) => {
  const row = storyLevels[level - 1];
  const actual = !row ? 0 : level === 8 ? 60 : 120;
  return {
    level,
    role: 'hold',
    start_s: 90 + (level - 1) * 150,
    end_s: 210 + (level - 1) * 150,
    actual_duration_s: actual,
    hold_elapsed_pct: (actual / 120) * 100,
    per_minute: row ? (row.opens * 60) / actual : 0,
    has_data: Boolean(row),
    passed: Boolean(row && level < 8),
    latency_breach: level === 8,
    error_breach: false,
    auth_contaminated: false,
    result: !row ? 'no_data' : level === 8 ? 'break' : 'pass',
    requests: row ? 1000 : 0,
    request_outcomes: row ? 1000 : 0,
    failed_request_outcomes: row ? row.errors * 10 : 0,
    dashboards_opened: row?.opens ?? 0,
    filters_applied: row ? row.opens * 2 : 0,
    charts_drawn: row ? row.opens * 7 : 0,
    chart_unavailable_errors: 0,
    charts_failed: 0,
    errors_by_class: emptyErrors(),
    open_p50_ms: row ? row.p50 * 1000 : null,
    open_p95_ms: row ? row.p95 * 1000 : null,
    open_p99_ms: row ? row.p95 * 1200 : null,
    open_max_ms: row ? row.p95 * 1300 : null,
    filter_p50_ms: row ? row.filter * 800 : null,
    filter_p95_ms: row ? row.filter * 1000 : null,
    filter_max_ms: row ? row.filter * 1200 : null,
    error_rate_pct: row?.errors ?? null,
    auth_error_rate_pct: row ? 0 : null,
    auth_waits: 0,
    auth_wait_recovered: 0,
  };
});
export function platformRunRead(
  state: PlatformFixtureState = 'finished',
): PerformanceReceived<PlatformRunRead> {
  const read = structuredClone(contractRun);
  const smoke = state === 'smoke';
  const number = (
    {
      finished: 24,
      smoke: 23,
      running: 25,
      waiting: 26,
      discovery: 27,
      failed: 28,
      stopped: 29,
      interrupted: 30,
      stopping: 31,
    } as const
  )[state];
  const active = ['running', 'waiting', 'discovery', 'stopping'].includes(state);
  const status =
    state === 'smoke'
      ? 'finished'
      : state === 'waiting'
        ? 'running'
        : state === 'discovery'
          ? 'starting'
          : state;
  const runId = `platform-run-${number}`;
  const started = '2026-11-25T15:40:48Z';
  read.server_time = '2026-11-25T16:23:08Z';
  read.config = {
    ...read.config,
    test_type: smoke ? 'smoke' : 'breakpoint',
    target: {
      id: platformTarget.id,
      name: platformTarget.name,
      kind: platformTarget.kind,
      is_production: false,
      base_url: platformTarget.base_url,
      max_users: 10,
      max_duration_s: 3600,
      settings: platformTarget.settings,
    },
    tokens: platformTarget.tokens.map(({ name, hint, version }) => ({ name, hint, version })),
    plan: {
      ...(smoke ? platformOptions.defaults.smoke : platformOptions.defaults.breakpoint),
      timeout_seconds: 60,
    },
  };
  read.discovery = {
    ...read.discovery!,
    started_at: '2026-11-25T15:40:00Z',
    ended_at: started,
    duration_s: 48,
    active_duration_s: 48,
    counts: discoveryCounts,
    resolved_plan: smoke
      ? {
          ...resolved,
          users: 1,
          iterations: 12,
          smoke_max_duration_seconds: 600,
          total_seconds: 600,
          levels: [1],
          stages: [],
        }
      : resolved,
  };
  read.run = {
    ...read.run,
    id: runId,
    number,
    target_kind: 'estishraf_platform',
    test_type: smoke ? 'smoke' : 'breakpoint',
    status,
    stored_status: status,
    target: {
      id: platformTarget.id,
      name: platformTarget.name,
      kind: 'estishraf_platform',
      is_production: false,
      base_url: platformTarget.base_url,
    },
    requested_at: '2026-11-25T15:40:00Z',
    started_at: started,
    finished_at: active ? null : '2026-11-25T16:00:48Z',
    safe_load_users: 7,
    breaking_level_users: 8,
    breaking_reason: 'latency',
    recommended_max_users: 5,
    p95_at_safe_load_ms: 8900,
    p95_at_break_ms: 11400,
    open_p95_ms: 11400,
    filter_p95_ms: 4200,
    highest_tested_users: 8,
    error_rate_pct: 0.6,
    max_users: smoke ? 1 : 10,
    opens_measured: 600,
    opens_total: 600,
    filters_total: 1200,
    charts_drawn: 4200,
    charts_failed: 0,
    duration_s: 1200,
    discovery_counts: discoveryCounts,
    coverage: 'incomplete',
    coverage_counts: coverageCounts,
    verdict: smoke ? 'pass' : 'breakpoint_found',
    has_report: !active,
  };
  read.effective_status = status;
  read.summary = {
    ...read.summary!,
    test_type: smoke ? 'smoke' : 'breakpoint',
    identity: {
      run_id: runId,
      run_number: number,
      project_name: 'QA - Performance',
      target_name: platformTarget.name,
    },
    verdict: smoke ? 'pass' : 'breakpoint_found',
    verdict_reason: smoke ? 'Passed' : 'Breaks at 8 users (dashboard-open time)',
    source_verdict_reason: smoke
      ? 'All 12 dashboards opened once within limits.'
      : 'Dashboard-open p95 exceeded the limit at 8 users.',
    ended_by: smoke ? 'plan' : 'auto_stop',
    started_at: started,
    ended_at: '2026-11-25T16:00:48Z',
    target_url: platformTarget.base_url,
    headline: {
      ...read.summary!.headline,
      safe_load_users: smoke ? null : 7,
      recommended_max_users: smoke ? null : 5,
      breaking_level_users: smoke ? null : 8,
      breaking_reason: smoke ? null : 'latency',
      p95_at_safe_load_ms: smoke ? null : 8900,
      p95_at_break_ms: smoke ? null : 11400,
      open_p95_ms: smoke ? 4800 : 11400,
      filter_p95_ms: smoke ? 1800 : 4200,
      error_rate_pct: 0.6,
      opens_measured: smoke ? 12 : 600,
      opens_total: smoke ? 12 : 600,
      filters_total: smoke ? 31 : 1200,
      charts_drawn: smoke ? 84 : 4200,
      charts_failed: 0,
      duration_s: smoke ? 108 : 1200,
      max_users: smoke ? 1 : 10,
      highest_tested_users: smoke ? 1 : 8,
    },
    levels: smoke
      ? [
          {
            ...levels[0]!,
            role: 'steady',
            start_s: 0,
            end_s: 600,
            actual_duration_s: 108,
            hold_elapsed_pct: 18,
            dashboards_opened: 12,
            filters_applied: 31,
            open_p95_ms: 4800,
            filter_p95_ms: 1800,
            charts_drawn: 84,
            failed_request_outcomes: 6,
            error_rate_pct: 0.6,
            errors_by_class: { ...emptyErrors(), callback_error: 6 },
          },
        ]
      : levels,
    plan: read.discovery.resolved_plan!,
    coverage: 'incomplete',
    coverage_counts: coverageCounts,
    counts: {
      planned_iterations: smoke ? 12 : null,
      completed_iterations: smoke ? 12 : 600,
      records_received: smoke ? 49 : 1812,
      records_dropped: 0,
    },
    overall: {
      request_outcomes: smoke ? 1000 : 10000,
      failed_request_outcomes: smoke ? 6 : 60,
      error_rate_pct: 0.6,
      errors_by_class: { ...emptyErrors(), callback_error: smoke ? 6 : 12 },
      chart_unavailable_errors: 0,
    },
    measurements: {
      source_complete: true,
      percentiles_complete: true,
      percentile_basis: 'all_completed_steps',
      reason: null,
      records_retained: smoke ? 49 : 1812,
    },
  };
  Object.assign(read.run, read.summary.headline);
  read.summary.thresholds = [
    {
      scope: 'run',
      level: null,
      metric: 'dashboard_ready',
      expression: 'p(95)<10000',
      measured: read.summary.headline.open_p95_ms,
      ok: smoke,
    },
    {
      scope: 'run',
      level: null,
      metric: 'journey_errors',
      expression: 'rate<0.05',
      measured: 0.006,
      ok: true,
    },
    ...read.summary.levels.flatMap((row) => [
      {
        scope: 'level' as const,
        level: row.level,
        metric: 'j_level_ready' as const,
        expression: 'p(95)<10000',
        measured: row.open_p95_ms,
        ok: row.has_data ? !row.latency_breach : null,
      },
      {
        scope: 'level' as const,
        level: row.level,
        metric: 'j_level_errors' as const,
        expression: 'rate<0.05',
        measured: row.error_rate_pct == null ? null : row.error_rate_pct / 100,
        ok: row.has_data ? !row.error_breach : null,
      },
    ]),
  ];
  read.dashboard_results = { total: 12, url: `/api/projects/demo/performance/runs/${runId}/dashboards` };
  read.tokens = platformTarget.tokens;
  read.counts = {
    steps_received: smoke ? 49 : 1812,
    steps_dropped: 0,
    steps_stored: smoke ? 49 : 1812,
    log_lines_received: 7,
    log_lines_dropped: 0,
    events: 2,
  };
  read.report = { ...read.report!, url: `/api/projects/demo/performance/runs/${runId}/report` };
  read.can = { stop: active, hand_off_token: state === 'waiting' };
  read.stop_requested = state === 'stopping';
  read.late_results_until = null;
  if (active) {
    read.summary = null;
    read.report = null;
    Object.assign(read.run, {
      verdict: null,
      safe_load_users: null,
      breaking_level_users: null,
      breaking_reason: null,
      recommended_max_users: null,
      p95_at_safe_load_ms: null,
      p95_at_break_ms: null,
      open_p95_ms: null,
      filter_p95_ms: null,
      highest_tested_users: null,
      error_rate_pct: null,
      opens_measured: null,
      opens_total: null,
      filters_total: null,
      charts_drawn: null,
      charts_failed: null,
      duration_s: null,
      has_report: false,
    });
    read.progress = {
      target_kind: 'estishraf_platform',
      phase: state === 'discovery' ? 'preflight' : state === 'stopping' ? 'stopping' : 'hold',
      step: state === 'discovery' ? 'discovery' : null,
      message:
        state === 'discovery'
          ? 'Finding dashboards, charts and filters'
          : state === 'waiting'
            ? 'Sign-in needed. Paste a new session cookie to continue.'
            : 'Measuring level 5',
      error_code: null,
      elapsed_s: state === 'discovery' ? 0 : 740,
      preflight_elapsed_s: 48,
      planned_s: state === 'discovery' ? null : 1620,
      stage:
        state === 'discovery'
          ? null
          : { index: 11, of: 23, role: 'hold', target_users: 5, start_s: 690, end_s: 810 },
      level: state === 'discovery' ? null : 5,
      users: state === 'discovery' ? null : 5,
      users_sample_age_s: state === 'discovery' ? null : 0.2,
      users_max: 10,
      discovery_counts:
        state === 'discovery'
          ? {
              ...discoveryCounts,
              dashboards_visible: null,
              dashboards_discovered: 7,
              dashboards_selected: 7,
              dashboards_runnable: 7,
              charts_found: 48,
              charts_usable: 48,
              charts_unusable: 0,
              filters_found: 18,
            }
          : discoveryCounts,
      discovery_ready: state !== 'discovery',
      dashboard_opens: state === 'discovery' ? 0 : 207,
      filter_changes: state === 'discovery' ? 0 : 414,
      charts_drawn: state === 'discovery' ? 0 : 1449,
      charts_failed: 0,
      errors_by_class: emptyErrors(),
      requests: null,
      error_rate_pct: null,
      open_p50_ms: state === 'discovery' ? null : 3700,
      open_p95_ms: state === 'discovery' ? null : 6300,
      filter_p95_ms: state === 'discovery' ? null : 2400,
      levels:
        state === 'discovery'
          ? []
          : levels.slice(0, 5).map((row) => ({
              level: row.level,
              state: row.level === 5 ? 'running' : 'done',
              hold_elapsed_s: row.level === 5 ? 50 : 120,
              hold_elapsed_pct: row.level === 5 ? (50 / 120) * 100 : 100,
              dashboard_opens: row.level === 5 ? 41 : row.dashboards_opened,
              filter_changes: row.level === 5 ? 82 : row.filters_applied,
              charts_drawn: row.level === 5 ? 287 : row.charts_drawn,
              charts_failed: 0,
              errors_by_class: emptyErrors(),
              open_p50_ms: row.open_p50_ms,
              open_p95_ms: row.open_p95_ms,
              filter_p95_ms: row.filter_p95_ms,
              requests: null,
              error_rate_pct: null,
              per_minute: row.per_minute,
              result: null,
            })),
      records: {
        received: state === 'discovery' ? 0 : 621,
        dropped: 0,
        malformed: 0,
        uploaded: state === 'discovery' ? 0 : 621,
      },
      measurement: { basis: 'completed_records', complete: true, percentiles_complete: true },
      auth: {
        state: state === 'waiting' ? 'rejected' : 'ok',
        token_versions: { session_cookie: 1 },
        session_expires_at: null,
        rejected_at: state === 'waiting' ? read.server_time : null,
        recovered_at: null,
        wait_deadline_at: state === 'waiting' ? '2026-11-25T16:33:08Z' : null,
        incidents: state === 'waiting' ? 1 : 0,
        refresh_ok: 0,
        refresh_failed: state === 'waiting' ? 1 : 0,
      },
      waiting_for_token: state === 'waiting' ? 'session_cookie' : null,
      dropped: { log_lines: 0 },
      coverage: 'incomplete',
      coverage_counts: coverageCounts,
    };
    read.token_needed = state === 'waiting' ? 'session_cookie' : null;
    if (state === 'discovery') {
      read.discovery = null;
      read.dashboard_results.total = 0;
      read.progress.coverage_counts = {
        ...coverageCounts,
        dashboards_exercised: 0,
        dashboards_unexercised: 0,
        dashboards_selected: 0,
        dashboards_runnable: 0,
        charts_found: 0,
        charts_usable: 0,
        charts_unusable: 0,
        discovery_partial: true,
        discovery_reasons: ['list_incomplete'],
      };
      read.run.discovery_counts = null;
      read.run.coverage = null;
      read.run.coverage_counts = null;
    }
  } else if (state === 'failed' || state === 'interrupted' || state === 'stopped') {
    read.summary = null;
    read.report = null;
    read.run.verdict = null;
    read.run.has_report = false;
    read.status_reason = {
      code:
        state === 'failed'
          ? 'preflight_failed'
          : state === 'interrupted'
            ? 'runner_silent'
            : 'stopped_by_person',
      message:
        state === 'failed'
          ? 'No dashboard has a chart this test can use.'
          : state === 'interrupted'
            ? 'The runner stopped reporting.'
            : 'Stopped by Operator.',
    };
    read.run.error = state === 'failed' ? read.status_reason.message : null;
  }
  return { ...read, received_at: Date.parse(read.server_time) };
}
export const platformSteps: PlatformStepRow[] = [
  {
    seq: 1,
    at: '2026-11-25T15:54:08.142Z',
    elapsed_s: 800.142,
    stage: 'hold',
    level: 6,
    user_number: 1,
    type: 'open',
    dashboard_id: 103,
    title: 'التجارة الخارجية',
    insight_id: null,
    control: null,
    step: null,
    http_status: null,
    error_class: null,
    duration_ms: 8720,
    charts: 7,
    charts_ok: 7,
    errors: emptyErrors(),
  },
  {
    seq: 2,
    at: '2026-11-25T15:54:08.384Z',
    elapsed_s: 800.384,
    stage: 'hold',
    level: 6,
    user_number: 1,
    type: 'error',
    dashboard_id: 103,
    title: 'التجارة الخارجية',
    insight_id: 82801,
    control: null,
    step: 'wrapper',
    http_status: 502,
    error_class: 'server_error',
    duration_ms: null,
    charts: null,
    charts_ok: null,
    errors: emptyErrors(),
  },
  {
    seq: 3,
    at: '2026-11-25T15:54:17.104Z',
    elapsed_s: 809.104,
    stage: 'hold',
    level: 6,
    user_number: 1,
    type: 'filter',
    dashboard_id: 103,
    title: 'التجارة الخارجية',
    insight_id: null,
    control: 'year',
    step: null,
    http_status: null,
    error_class: null,
    duration_ms: 2640,
    charts: 7,
    charts_ok: null,
    errors: emptyErrors(),
  },
];
export function platformHome(state: PlatformFixtureState = 'finished'): MixedPerformanceHome {
  const read = platformRunRead(state);
  const finished = platformRunRead();
  return {
    ...performanceHomeIdle,
    targets: [platformTarget, ...performanceHomeIdle.targets],
    active_run: read.can.stop
      ? {
          id: read.run.id,
          number: read.run.number,
          target_kind: 'estishraf_platform',
          test_type: read.run.test_type,
          status: read.run.status,
          target: read.run.target,
          requested_by: read.run.requested_by,
          requested_by_user_id: read.run.requested_by_user_id,
          requested_at: read.run.requested_at,
          started_at: read.run.started_at,
          progress: read.progress,
          seconds_since_report: 0,
          stop_requested: read.stop_requested,
          token_needed: read.token_needed,
        }
      : null,
    runs: {
      rows: [read.run, platformRunRead('smoke').run, ...performanceHomeIdle.runs.rows],
      total: performanceHomeIdle.runs.total + 2,
      page: 1,
      page_size: 25,
    },
    capacity_cards: [
      {
        target: platformTarget,
        kind: 'estishraf_platform',
        metric: 'dashboard_open_p95',
        label: 'Dashboard open p95 at safe load',
        result: {
          run_id: finished.run.id,
          number: 24,
          finished_at: finished.run.finished_at!,
          verdict: 'breakpoint_found',
          safe_load_users: 7,
          breaking_level_users: 8,
          recommended_max_users: 5,
          p95_at_safe_load_ms: 8900,
          highest_tested_users: 8,
          coverage: 'incomplete',
        },
      },
    ],
    platform_safe_load_trend: [
      {
        run_id: finished.run.id,
        number: 24,
        target_id: platformTarget.id,
        kind: 'estishraf_platform',
        finished_at: finished.run.finished_at!,
        safe_load_users: 7,
        breaking_level_users: 8,
        max_users: 10,
        coverage: 'incomplete',
      },
    ],
  };
}
export const platformLogPage: PerformanceLogPage = {
  lines: [
    { seq: 1, at: '2026-11-25T15:40:00Z', level: 'info', message: 'Run accepted.' },
    {
      seq: 2,
      at: '2026-11-25T15:40:48Z',
      level: 'warning',
      message:
        'Discovery finished: 12 dashboards, 87 charts, 31 filters. Coverage incomplete: 3 charts could not be loaded.',
    },
    {
      seq: 3,
      at: '2026-11-25T16:00:48Z',
      level: 'info',
      message: 'Safe load 7 users. Recommended maximum 5 users.',
    },
  ],
  total: 3,
  next_after_seq: null,
  last_seq: 3,
  dropped: 0,
};
export const platformEvents: PerformanceRunEvents = { events: [] };

/** Read-only fixture backend shared by the gallery and intercepted browser checks. */
export function platformFixtureRead(
  sub: string,
  params = new URLSearchParams(),
  state: PlatformFixtureState = 'finished',
): unknown {
  const read = platformRunRead(state);
  const page = Number(params.get('page') ?? 1);
  const pageSize = Number(params.get('page_size') ?? 50);
  const q = (params.get('q') ?? '').toLowerCase();
  const paged = <T>(rows: T[]) => ({
    rows: rows.slice((page - 1) * pageSize, page * pageSize),
    total: rows.length,
    page,
    page_size: pageSize,
  });
  if (sub === '') return platformHome(state);
  if (sub === '/setup') return platformSetup;
  if (sub === '/targets')
    return {
      targets: [platformTarget, performanceTargetPreprod],
      can_manage: true,
      encryption_ready: true,
      platform_limits: { max_users: 200, max_duration_s: 28800 },
    };
  if (sub === '/runs') return platformHome(state).runs;
  if (sub.endsWith('/dashboards')) {
    const selected = params.getAll('dashboard');
    const dashboardRows =
      state === 'smoke'
        ? platformDashboards.map((row, index) => ({
            ...row,
            opens: 1,
            filters: platformDiscoveryRows[index]!.filters_found,
            charts_drawn: platformDiscoveryRows[index]!.charts_usable,
            errors_by_class: { ...emptyErrors(), callback_error: index === 2 ? 6 : 0 },
          }))
        : platformDashboards;
    let rows = (state === 'discovery' ? [] : dashboardRows).filter(
      (row) =>
        (!q || row.title.toLowerCase().includes(q) || String(row.dashboard_id).includes(q)) &&
        (!selected.length || selected.includes(JSON.stringify(row.dashboard_id))),
    );
    const sort = params.get('sort') ?? 'title';
    rows = [...rows].sort((a, b) =>
      sort.includes('open_p95_ms')
        ? (b.open_p95_ms ?? -1) - (a.open_p95_ms ?? -1)
        : a.title.localeCompare(b.title),
    );
    return {
      ...paged(rows),
      source: read.summary ? 'summary' : 'retained_steps',
      coverage: 'incomplete',
      coverage_counts: read.progress?.coverage_counts ?? coverageCounts,
      records_complete: true,
    };
  }
  if (sub.endsWith('/discovery'))
    return {
      ...paged(
        read.discovery
          ? platformDiscoveryRows.filter((row) => !q || row.title.includes(q) || String(row.id).includes(q))
          : [],
      ),
      discovery: read.discovery,
    };
  if (sub.endsWith('/steps')) {
    const selected = params.getAll('dashboard');
    const types = params.getAll('type');
    const stages = params.getAll('stage');
    const levels = params.getAll('level');
    const errors = params.getAll('error_class');
    const rows = platformSteps.filter(
      (row) =>
        (!selected.length || selected.includes(JSON.stringify(row.dashboard_id))) &&
        (!types.length || types.includes(row.type)) &&
        (!stages.length || stages.includes(row.stage)) &&
        (!levels.length || levels.includes(String(row.level))) &&
        (!errors.length || errors.includes(row.error_class ?? '')) &&
        (!params.has('after_seq') || row.seq > Number(params.get('after_seq'))),
    );
    return {
      ...paged(rows),
      last_seq: 3,
      counts: { received: 3, dropped: 0, retained: 3 },
      facets: {
        types: ['open', 'filter', 'error'],
        stages: ['hold'],
        levels: [6],
        error_classes: ['server_error'],
      },
      details_expired: false,
    };
  }
  if (sub.endsWith('/log'))
    return {
      ...platformLogPage,
      lines: platformLogPage.lines.filter((line) => line.seq > Number(params.get('after_seq') ?? 0)),
    };
  if (sub.endsWith('/events')) return platformEvents;
  if (/^\/runs\/[^/]+$/.test(sub)) return read;
  return {};
}
