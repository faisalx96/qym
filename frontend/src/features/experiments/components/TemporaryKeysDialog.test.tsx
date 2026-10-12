import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemporaryKeysDialog } from './TemporaryKeysDialog';

const slots = [
  { slot_key: 'endpoint:primary', label: 'Answer model', model: 'gpt-x' },
  { slot_key: 'endpoint:judge', label: 'Judge model' },
];
const SECRET = 'sk-super-secret-123';

describe('TemporaryKeysDialog', () => {
  it('asks for one labelled password field per slot and hands the keys over once', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <TemporaryKeysDialog open slots={slots} onSubmit={onSubmit} onCancel={() => {}} />,
    );
    const answer = screen.getByLabelText(/Answer model/);
    const judge = screen.getByLabelText(/Judge model/);
    expect(answer).toHaveAttribute('type', 'password');
    expect(judge).toHaveAttribute('type', 'password');
    const submit = screen.getByRole('button', { name: 'Retry with keys' });
    expect(submit).toBeDisabled();
    await user.type(answer, SECRET);
    expect(submit).toBeDisabled(); // every slot needs a key
    await user.type(judge, 'sk-judge');
    await user.click(submit);
    expect(onSubmit).toHaveBeenCalledWith({ 'endpoint:primary': SECRET, 'endpoint:judge': 'sk-judge' });

    rerender(<TemporaryKeysDialog open={false} slots={slots} onSubmit={onSubmit} onCancel={() => {}} />);
    await waitFor(() => expect(screen.queryByTestId('temporary-keys-dialog')).toBeNull());
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    expect(document.body.innerHTML).not.toContain(SECRET);
  });

  it('wipes typed keys when cancelled, and reopening starts empty', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    const props = { slots: [slots[0]!], onSubmit: vi.fn(), onCancel };
    const { rerender } = render(<TemporaryKeysDialog open {...props} />);
    await user.type(screen.getByLabelText(/Answer model/), SECRET);
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalled();
    rerender(<TemporaryKeysDialog open={false} {...props} />);
    expect(screen.queryByDisplayValue(SECRET)).toBeNull();
    rerender(<TemporaryKeysDialog open {...props} />);
    expect(screen.getByLabelText(/Answer model/)).toHaveValue('');
  });

  it('offers "Clone instead"', async () => {
    const user = userEvent.setup();
    const onClone = vi.fn();
    render(
      <TemporaryKeysDialog open slots={slots} onSubmit={() => {}} onCancel={() => {}} onClone={onClone} />,
    );
    await user.click(screen.getByRole('button', { name: 'Clone instead' }));
    expect(onClone).toHaveBeenCalled();
  });
});
