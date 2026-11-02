import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { MaintenanceOverview } from '@/api/admin';
import { MaintenanceSummary, outboxText } from '../MaintenanceSummary';

const data = {
  settings: {
    role: 'all',
    service: 'all',
    maintenance_mode: false,
    event_log_mode: 'full',
    span_retention_days: 0,
    deleted_run_grace_days: 0,
    span_partition_days_ahead: 14,
  },
  workers: { loops: 'local', summary_worker_alive: true, maintenance_worker_alive: true },
} as unknown as MaintenanceOverview;

describe('Maintenance settings card (M3: C178, C074)', () => {
  it("names the setting 'Deleted runs retention' and reads 0 as Off", () => {
    render(<MaintenanceSummary data={data} sizeBytes={23e9} outbox={null} />);
    expect(screen.getByText('Deleted runs retention')).toBeInTheDocument();
    expect(screen.getByText('Off (kept until restored)')).toBeInTheDocument();
    expect(screen.queryByText('Deleted-run grace')).toBeNull();
  });

  it('shows the outbox size, rows and oldest row age next to the database size', () => {
    render(
      <MaintenanceSummary
        data={data}
        sizeBytes={23e9}
        outbox={{ total_bytes: 2_040_000_000, rows: 15174, oldest_age_seconds: 31 * 86_400 }}
      />,
    );
    expect(screen.getByText('Outbox')).toBeInTheDocument();
    expect(outboxText({ total_bytes: 2_040_000_000, rows: 15174, oldest_age_seconds: 31 * 86_400 })).toMatch(
      /15,174 rows · oldest 31 days$/,
    );
  });

  it('leaves the oldest age out of an empty outbox', () => {
    expect(outboxText({ total_bytes: 8192, rows: 0, oldest_age_seconds: null })).toMatch(/0 rows$/);
  });
});
