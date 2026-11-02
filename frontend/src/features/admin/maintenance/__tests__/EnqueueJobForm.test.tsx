import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/ui';
import type { MaintenanceOverview } from '@/api/admin';
import { EnqueueJobForm, defaultParams, describeParam } from '../EnqueueJobForm';

const kinds: MaintenanceOverview['job_kinds'] = {
  alter_column_types: {
    irreversible: false,
    description: 'Rewrite large tables.',
    params: {
      tables: {
        type: 'tables',
        default: [],
        description: 'Tables to rewrite, one per step.',
        choices: ['run_events', 'spans'],
      },
    },
  },
  vacuum_analyze: {
    irreversible: false,
    description: 'VACUUM (ANALYZE) the given tables.',
    params: {
      tables: {
        type: 'tables',
        default: ['run_events', 'spans', 'run_items'],
        description: 'Tables to vacuum and analyze, one per step.',
      },
    },
  },
  reclaim_run_events: {
    irreversible: false,
    description: 'Delete legacy rows.',
    params: {
      batch_runs: { type: 'integer', default: 10, description: 'Runs per batch.', minimum: 1 },
      vacuum_every: { type: 'integer', default: 20, description: 'VACUUM every N batches.', minimum: 1 },
    },
  },
  db_stats: { irreversible: false, description: 'Collect sizes.', params: {} },
};

function renderForm() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <EnqueueJobForm kinds={kinds} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

async function pick(user: ReturnType<typeof userEvent.setup>, kind: string) {
  await user.click(screen.getByRole('button', { name: /Job/ }));
  await user.click(await screen.findByRole('option', { name: new RegExp(kind) }));
}

afterEach(() => vi.unstubAllGlobals());

describe('EnqueueJobForm', () => {
  it('starts with no job picked and Queue job disabled', () => {
    renderForm();
    expect(screen.getByRole('button', { name: /Job/ })).toHaveTextContent('Pick a job');
    expect(screen.getByRole('button', { name: 'Queue job' })).toBeDisabled();
    expect(screen.queryByRole('list', { name: /^Params of/ })).not.toBeInTheDocument();
  });

  it('prefills the picked job defaults and lists its keys', async () => {
    const user = userEvent.setup();
    renderForm();
    await pick(user, 'vacuum_analyze');
    expect(screen.getByLabelText('Params (JSON)')).toHaveValue(
      JSON.stringify({ tables: ['run_events', 'spans', 'run_items'] }),
    );
    const keys = screen.getByRole('list', { name: 'Params of vacuum_analyze' });
    expect(within(keys).getByText('tables')).toBeInTheDocument();
    expect(keys).toHaveTextContent('default ["run_events","spans","run_items"]');
    expect(screen.getByRole('button', { name: 'Queue job' })).toBeEnabled();

    await pick(user, 'reclaim_run_events');
    expect(screen.getByLabelText('Params (JSON)')).toHaveValue(
      JSON.stringify({ batch_runs: 10, vacuum_every: 20 }),
    );
    const reclaim = screen.getByRole('list', { name: 'Params of reclaim_run_events' });
    expect(reclaim).toHaveTextContent('batch_runs');
    expect(reclaim).toHaveTextContent('integer, default 10, min 1. Runs per batch.');

    await pick(user, 'db_stats');
    expect(screen.getByLabelText('Params (JSON)')).toHaveValue('{}');
    expect(screen.getByRole('list', { name: 'Params of db_stats' })).toHaveTextContent('Takes no params.');
  });

  it('sends the picked kind with the edited params and shows the server error', async () => {
    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(
          JSON.stringify({ detail: 'vacuum_analyze does not take batch (its params: tables)' }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }),
    );
    const user = userEvent.setup();
    renderForm();
    await pick(user, 'vacuum_analyze');
    const params = screen.getByLabelText('Params (JSON)');
    await user.clear(params);
    await user.click(params);
    await user.paste('{"batch": 5}');
    await user.click(screen.getByRole('button', { name: 'Queue job' }));
    expect(await screen.findByText(/does not take batch/)).toBeInTheDocument();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/api/admin/maintenance/jobs');
    expect(calls[0]!.body).toEqual({ kind: 'vacuum_analyze', params: { batch: 5 } });
  });
});

describe('param helpers', () => {
  it('builds the defaults object and the param line', () => {
    expect(defaultParams(kinds.reclaim_run_events)).toEqual({ batch_runs: 10, vacuum_every: 20 });
    expect(defaultParams(undefined)).toEqual({});
    expect(describeParam(kinds.alter_column_types!.params.tables!)).toBe(
      'tables, default [], one of run_events, spans. Tables to rewrite, one per step.',
    );
  });
});
