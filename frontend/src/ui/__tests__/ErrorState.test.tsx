import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { ErrorState } from '../ErrorState';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
it('shows and copies the error code and request id from the API envelope', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('isSecureContext', true);
  const writeText = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const error = new ApiError(503, 'Worker unavailable', {
    code: 'worker_unavailable',
    body: {
      detail: 'Worker unavailable',
      error: {
        code: 'worker_unavailable',
        message: 'Worker unavailable',
        details: [],
        request_id: 'aabb1234',
      },
    },
  });
  render(<ErrorState error={error} title="Couldn’t load the worker" />);
  expect(screen.getByText(/HTTP 503/)).toHaveTextContent('worker_unavailable · request aabb1234');
  await user.click(screen.getByRole('button', { name: 'Copy report' }));
  await waitFor(() => expect(writeText).toHaveBeenCalled());
  const text = writeText.mock.calls[0]![0];
  expect(text).toContain('Title: Couldn’t load the worker');
  expect(text).toContain('HTTP status: 503');
  expect(text).toContain('Code: worker_unavailable');
  expect(text).toContain('Request id: aabb1234');
});
it('keeps plain error behavior without diagnostic identifiers or Copy report', () => {
  render(<ErrorState error={new Error('Something failed')} onRetry={() => {}} />);
  expect(screen.getByRole('button', { name: 'Retry' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Copy report' })).toBeNull();
  expect(screen.queryByText(/request /)).toBeNull();
});
it.each([{ code: 'denied' }, { request_id: 'abc123' }])('supports either identifier alone', (identifiers) => {
  render(<ErrorState error={new ApiError(403, 'Access denied', { body: { error: identifiers } })} />);
  expect(screen.getByRole('button', { name: 'Copy report' })).toBeVisible();
});
