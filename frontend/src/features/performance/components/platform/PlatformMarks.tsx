import type { PerformanceSetupTarget } from '@/api/performance';
import type { PlatformTarget } from '@/api/performancePlatform';
import { StateTag } from '@/ui';
import { verdictWords, type VerdictFacts } from '../../lib/status';
import { platformCount } from './words';
import { count } from '../../lib/format';
import { Quantity, TargetEnvironment } from '../shared';
import { hostOf } from '../new/parts';
import styles from '../new/newRun.module.css';

/** The platform result uses dashboard measurements, including when no result was measured. */
export function PlatformVerdict({ run }: { run: VerdictFacts }) {
  const words =
    run.verdict === 'invalid_no_data'
      ? (['danger', 'Not valid: no measurement'] as const)
      : run.verdict === 'breakpoint_found' && run.breaking_level_users != null
        ? (['warning', `Breaks at ${platformCount(run.breaking_level_users, 'user')}`] as const)
        : run.verdict === 'not_reached' && run.safe_load_users != null
          ? (['success', `No break up to ${platformCount(run.safe_load_users, 'user')}`] as const)
          : verdictWords(run);
  return words ? <StateTag tone={words[0]}>{words[1]}</StateTag> : null;
}
export function PlatformUsers({ value }: { value: number | null | undefined }) {
  return value == null ? '–' : <Quantity value={count(value)} unit={platformCount(value, 'user', true)} />;
}
/** Both target branches use the same four facts, so selecting a target never changes other cards. */
export function TargetChoiceFacts({ target }: { target: PerformanceSetupTarget | PlatformTarget }) {
  const platform = 'kind' in target && target.kind === 'estishraf_platform';
  const expired = target.tokens.some(
    (token) => token.name === (platform ? 'session_cookie' : 'refresh_token') && token.expired,
  );
  return (
    <>
      <span className={styles.optionTitle}>
        {target.name}
        <TargetEnvironment production={target.is_production} />
      </span>
      <span className={styles.host}>{hostOf(target.base_url)}</span>
      <span>{platform ? 'Estishraf platform' : 'Insightor chat'}</span>
      <span>
        <StateTag tone={target.sign_in_ready ? 'success' : 'warning'}>
          {target.sign_in_ready ? 'Sign-in saved' : expired ? 'Sign-in ran out' : 'No sign-in saved'}
        </StateTag>
      </span>
    </>
  );
}
