import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TemporaryModelForm } from '../TemporaryModelForm';
import { validateTemporaryModel } from '../temporaryModel';

describe('validateTemporaryModel', () => {
  const base = { label: '', model: 'gpt-x', base_url: '', api_key: '' };
  it('needs a model and defaults the label to it', () => {
    expect(validateTemporaryModel({ ...base, model: ' ' }, { keysAllowed: true, allowHttp: false }).ok).toBe(
      false,
    );
    const r = validateTemporaryModel(base, { keysAllowed: true, allowHttp: false });
    expect(r.ok && r.value.label).toBe('gpt-x');
  });
  it('requires https unless private URLs are allowed', () => {
    expect(
      validateTemporaryModel(
        { ...base, base_url: 'http://a.example/v1' },
        { keysAllowed: true, allowHttp: false },
      ).ok,
    ).toBe(false);
    expect(
      validateTemporaryModel(
        { ...base, base_url: 'http://a.example/v1/' },
        { keysAllowed: true, allowHttp: true },
      ).ok,
    ).toBe(true);
    expect(
      validateTemporaryModel({ ...base, base_url: 'ftp://x' }, { keysAllowed: true, allowHttp: true }).ok,
    ).toBe(false);
  });
  it('drops the key when keys are not accepted and needs url+key to save to project', () => {
    const r = validateTemporaryModel({ ...base, api_key: 'sk-1' }, { keysAllowed: false, allowHttp: false });
    expect(r.ok && r.value.api_key).toBe('');
    expect(
      validateTemporaryModel({ ...base, saveToProject: true }, { keysAllowed: true, allowHttp: false }).ok,
    ).toBe(false);
  });
});

describe('TemporaryModelForm', () => {
  it('hands the key over once on submit and clears every field', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<TemporaryModelForm onSubmit={onSubmit} />);
    await user.type(screen.getByLabelText(/^Model/), 'gpt-x');
    await user.type(screen.getByLabelText(/^Base URL/), 'https://api.example.com/v1');
    await user.type(screen.getByLabelText(/^API key/), 'sk-secret');
    await user.click(screen.getByRole('button', { name: 'Add model' }));
    expect(onSubmit).toHaveBeenCalledWith({
      label: 'gpt-x',
      model: 'gpt-x',
      base_url: 'https://api.example.com/v1',
      api_key: 'sk-secret',
      saveToProject: false,
    });
    expect((screen.getByLabelText(/^API key/) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/^Model/) as HTMLInputElement).value).toBe('');
    expect(document.body.innerHTML).not.toContain('sk-secret');
  });

  it('clears the key on cancel and shows validation errors', async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<TemporaryModelForm onSubmit={vi.fn()} onCancel={onCancel} />);
    await user.type(screen.getByLabelText(/^API key/), 'sk-secret');
    await user.click(screen.getByRole('button', { name: 'Add model' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a model name.');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByLabelText(/^API key/) as HTMLInputElement).value).toBe('');
    expect(onCancel).toHaveBeenCalled();
  });
});
