import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ExperimentDetail, ExperimentJob } from '@/api/experiments';
import { Credentials, revokedLabel, tokenFacts } from './Credentials';
import { TOKEN_UNAVAILABLE_REASON } from './copy';

const job = (over: Partial<ExperimentJob>): ExperimentJob =>
  ({ id: 'j', superseded: false, status: 'RUNNING', error: null, environment_id: 'e', environment_name: 'staging', dataset_token: 'sent', ...over }) as ExperimentJob;

const detail = (over: Partial<ExperimentDetail> = {}): ExperimentDetail =>
  ({
    credentials: {
      api_key: { state: 'active', revoked_at: null },
      dataset_read_token: { state: 'active', revoked_at: null },
    },
    jobs: [job({})],
    ...over,
  }) as ExperimentDetail;

describe('Credentials', () => {
  it('names the two credentials and their states', () => {
    render(<Credentials detail={detail()} />);
    const section = screen.getByRole('region', { name: 'Credentials' });
    expect(within(section).getByText('API key')).toBeTruthy();
    expect(within(section).getByText('Dataset read token')).toBeTruthy();
    expect(within(section).getAllByText('active')).toHaveLength(2);
    expect(screen.queryByTestId('token-notice')).toBeNull();
  });
  it('shows not issued for an experiment launched before the feature', () => {
    render(
      <Credentials
        detail={detail({
          credentials: {
            api_key: { state: 'active', revoked_at: null },
            dataset_read_token: { state: 'none', revoked_at: null },
          },
          jobs: [job({ dataset_token: null })],
        })}
      />,
    );
    expect(screen.getByTestId('cred-dataset-token').textContent).toBe('not issued');
    expect(screen.queryByTestId('token-notice')).toBeNull();
  });
  it('says when the token was not sent, once, naming the environments', () => {
    render(
      <Credentials
        detail={detail({
          jobs: [
            job({ id: 'a', dataset_token: 'not_declared' }),
            job({ id: 'b', dataset_token: 'not_declared', environment_name: 'production' }),
            job({ id: 'c', dataset_token: 'not_declared' }),
          ],
        })}
      />,
    );
    expect(screen.getByTestId('cred-dataset-token').textContent).toBe('not sent');
    expect(screen.getAllByTestId('token-notice')).toHaveLength(1);
    expect(screen.getByTestId('token-notice').textContent).toBe(
      'Dataset read token not sent to staging, production: the environments’ schemas do not declare QYM_DATASET_READ_TOKEN. Their jobs read datasets with the Evaluation Service’s own token.',
    );
  });
  it('uses the singular for one environment', () => {
    render(<Credentials detail={detail({ jobs: [job({ dataset_token: 'not_declared' }), job({ id: 'k' })] })} />);
    expect(screen.getByTestId('token-notice').textContent).toBe(
      'Dataset read token not sent to staging: the environment’s schema does not declare QYM_DATASET_READ_TOKEN. Its jobs read datasets with the Evaluation Service’s own token.',
    );
    // Only some jobs lack it: the badge stays active.
    expect(screen.getByTestId('cred-dataset-token').textContent).toBe('active');
  });
  it('warns when the token was revoked while jobs still need it, and the warning wins', () => {
    const at = new Date();
    at.setHours(12, 41, 0, 0);
    render(
      <Credentials
        detail={detail({
          credentials: {
            api_key: { state: 'active', revoked_at: null },
            dataset_read_token: { state: 'revoked', revoked_at: at.toISOString() },
          },
          jobs: [job({ status: 'BLOCKED', error: TOKEN_UNAVAILABLE_REASON, dataset_token: 'not_declared' })],
        })}
      />,
    );
    expect(screen.getByTestId('token-notice').textContent).toBe(
      'Dataset read token revoked 12:41. Retry the blocked jobs to issue a new one.',
    );
    expect(screen.getByTestId('cred-dataset-token').textContent).toBe('revoked 12:41');
  });
  it('does not warn about a revoked token of a settled experiment', () => {
    const facts = tokenFacts(
      detail({
        credentials: {
          api_key: { state: 'revoked', revoked_at: '2026-10-20T10:00:00Z' },
          dataset_read_token: { state: 'revoked', revoked_at: '2026-10-20T10:00:00Z' },
        },
        jobs: [job({ status: 'SUCCEEDED' })],
      }),
    );
    expect(facts.revokedStillNeeded).toBe(false);
  });
  it('formats another day with the date', () => {
    const now = new Date(2026, 9, 21, 9, 0);
    expect(revokedLabel(new Date(2026, 9, 20, 12, 41).toISOString(), now)).toBe('20 Oct 12:41');
  });
});
