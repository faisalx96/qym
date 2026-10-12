import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonConfigEditor } from '../raw/JsonConfigEditor';

// The editor fails (a failed chunk surfaces to the same error boundary): the plain textarea must keep working.
vi.mock('../raw/CodeMirrorEditor', () => ({
  default: () => {
    throw new Error('editor failed');
  },
}));

// React re-throws a caught render error to the window in development; the boundary handles it.
const swallow = (e: ErrorEvent) => e.preventDefault();
beforeEach(() => window.addEventListener('error', swallow));
afterEach(() => window.removeEventListener('error', swallow));

describe('JSON editor fallback', () => {
  it('stays a working textarea when the editor chunk fails', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<JsonConfigEditor label="Raw JSON" value="{}" onChange={onChange} />);
    const box = await screen.findByLabelText('Raw JSON');
    await waitFor(() => expect(box.tagName).toBe('TEXTAREA'));
    await user.type(await screen.findByLabelText('Raw JSON'), 'x');
    expect(onChange).toHaveBeenCalled();
  });
});
