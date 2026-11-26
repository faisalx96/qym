import type { PlatformSummary } from '@/api/performancePlatform';
import { count } from '../../lib/format';
import { performanceError } from '@/api/performance';

export const PLATFORM_NAME = 'Estishraf platform';
export const COOKIE_INSTRUCTIONS =
  'Sign in to the platform in your browser. Open Developer tools → Network, reload the page, select the /api/auth/session request, then Headers → Request Headers → Cookie. Copy the whole Cookie request-header value and paste it here.';

export const PLATFORM_ERRORS: Record<string, string> = {
  target_kind_immutable: "A target's kind cannot be changed. Add another target.",
  target_address_has_path: 'Use the address origin only; put any path prefix in the route settings.',
  target_route_invalid: 'A route template is invalid or leaves the target origin.',
  runner_kind_unsupported:
    'This runner cannot run Estishraf Platform tests. Connect a runner that supports Estishraf Platform.',
  wrong_target_kind: 'This operation does not match the target kind.',
  unsupported_test_type: 'Estishraf Platform supports Smoke and Breakpoint only.',
  session_cookie_required: 'Save a session cookie before starting.',
  session_cookie_expired: 'The saved sign-in has expired. Save a new session cookie.',
  session_cookie_invalid: 'Paste the whole Cookie header value as name=value pairs.',
  plan_exceeds_duration: 'The resolved test is longer than the allowed run duration.',
  unsupported_target_kind: 'This runner does not support this target kind.',
  target_tls_failed: 'The target certificate could not be verified.',
  target_unreachable: 'The target could not be reached within the request timeout.',
  session_invalid: 'The target did not return a valid signed-in session.',
  session_handoff_timeout: 'No working sign-in was supplied before the wait ended.',
  discovery_invalid: 'Dashboard discovery returned an unsupported or inconsistent response.',
  discovery_no_data: 'No dashboard has a chart this test can use.',
  discovery_limit_exceeded: 'Discovery is too large to record. Set a smaller maximum number of dashboards.',
  discovery_conflict: 'A different discovery result is already saved for this run.',
  discovery_required: 'Save the discovery result before sending dashboard measurements.',
  plan_mismatch: 'The plan qym computed differs from the plan the suite would run.',
  measurement_clock_missing: 'The test did not supply its measurement start time.',
  progress_too_large: 'The live measurement could not fit the configured progress limit.',
};
export function platformError(error: unknown): string {
  const refusal = performanceError<{ status: number; code: string; message: string; details: unknown }>(
    error,
  );
  return refusal
    ? (PLATFORM_ERRORS[refusal.code] ?? refusal.message)
    : 'The platform did not respond. Check the connection and try again.';
}
/** Credential failures use fixed words only, even if a proxy returns the submitted body. */
export function signInError(error: unknown): string {
  const refusal = performanceError<{ status: number; code: string; message: string; details: unknown }>(
    error,
  );
  if (refusal?.code === 'session_cookie_invalid' || refusal?.code === 'validation')
    return PLATFORM_ERRORS.session_cookie_invalid!;
  if (refusal?.code === 'production_requires_manager' || refusal?.code === 'forbidden')
    return 'Your role cannot save this sign-in.';
  if (refusal?.code === 'target_busy')
    return 'This target has an active run. Replace its sign-in on the run page.';
  return 'The sign-in could not be saved. Paste it again and retry.';
}
export const REASON_WORDS: Record<string, string> = {
  auth: 'Sign-in was not accepted',
  timeout: 'Request timed out',
  server_error: 'Server error',
  client_error: 'Request was refused',
  wrapper_invalid: 'Chart page could not be read',
  layout_invalid: 'Chart layout could not be read',
  dependencies_invalid: 'Chart filters could not be read',
  clientside_only: 'This chart runs only in the browser',
  no_server_callback: 'No server chart response is available',
  invalid_callback: 'Chart response settings could not be read',
  budget: 'Discovery time ran out',
  chart_unavailable: 'Chart unavailable',
  callback_error: 'Chart response failed',
};

export const ROUTE_LABELS: Record<string, string> = {
  session: 'Session route',
  token_refresh: 'Sign-in renewal route',
  health_check: 'Health check route',
  my_topics: 'Topics route',
  dashboards: 'Dashboards route',
  dashboard: 'Dashboard route',
  dashboard_logo: 'Dashboard logo route',
  latest_insights: 'Latest insights route',
  dashboard_background: 'Dashboard background route',
  insight_last_update: 'Chart last update route',
  siblings: 'Related dashboards route',
  chart_wrapper: 'Chart page route',
  chart_layout: 'Chart layout route',
  chart_dependencies: 'Chart filters route',
  chart_callback: 'Chart response route',
};

/** Counted nouns in platform prose and quantity units share one singular rule. */
export function platformCount(
  value: number,
  noun: 'user' | 'dashboard' | 'chart' | 'open' | 'filter' | 'level' | 'cookie' | 'run',
  unitOnly = false,
): string {
  const unit = value === 1 ? noun : `${noun}s`;
  return unitOnly ? unit : `${count(value)} ${unit}`;
}
export function invalidCapacity(verdict: string | null | undefined): boolean {
  return verdict === 'invalid_auth' || verdict === 'invalid_no_data';
}
export function platformResultExplanation(summary: PlatformSummary): string | null {
  if (!invalidCapacity(summary.verdict)) return null;
  const clean = summary.levels
    .filter((level) => level.has_data && level.passed && !level.auth_contaminated)
    .map((level) => level.level);
  const excluded = summary.levels
    .filter((level) => level.auth_contaminated || level.result === 'auth')
    .map((level) => level.level);
  const namedLevels = (levels: number[]) =>
    `${platformCount(levels.length, 'level', true)} ${levels.map(count).join(', ')}`;
  if (summary.verdict === 'invalid_auth') {
    const measured = clean.length ? `${namedLevels(clean)} passed before the sign-in was lost; ` : '';
    const lost = excluded.length
      ? `${namedLevels(excluded)} ${excluded.length === 1 ? 'was' : 'were'} not counted because sign-in was lost; `
      : 'sign-in was lost before a clean result could be established; ';
    const explanation = `${measured}${lost}this run does not establish a safe load or a recommended maximum.`;
    return explanation.charAt(0).toUpperCase() + explanation.slice(1);
  }
  if (summary.test_type === 'smoke') {
    return summary.ended_by === 'stop'
      ? 'Stopped before a usable dashboard open measurement was collected.'
      : 'No usable dashboard open measurement was collected.';
  }
  const reached = summary.levels.some((level) => level.actual_duration_s > 0 || level.has_data);
  const reason =
    summary.ended_by === 'stop' && !reached && summary.headline.duration_s < summary.plan.baseline_seconds
      ? 'Stopped during the baseline, before any level was measured'
      : !reached
        ? 'No level was reached'
        : 'No level collected usable dashboard open measurements';
  return `${reason}; this run does not establish a safe load or a recommended maximum.`;
}
export function progressSentence(message: string): string {
  const text = message
    .replace(/holding/gi, 'Measuring')
    .replace(/\bhold\b/gi, 'level')
    .trim();
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
