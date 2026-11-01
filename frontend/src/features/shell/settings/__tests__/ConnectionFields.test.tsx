import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/http';
import { connectionFieldOf, httpsError } from '../ConnectionFields';
import { ConnectionForm } from '../LlmConnectionsTab';

describe('one connection form (C157)', () => {
  it('places server messages under the field they concern', () => {
    expect(connectionFieldOf('Base URL must use https:// for this host')).toBe('baseUrl');
    expect(connectionFieldOf('Private network addresses are blocked')).toBe('baseUrl');
    expect(connectionFieldOf('Enter the API key for the new host')).toBe('key');
    expect(connectionFieldOf('The model gpt-x does not exist')).toBe('model');
    expect(connectionFieldOf('A connection with that name already exists')).toBeNull();
  });

  it('checks the https rule only where it applies', () => {
    expect(httpsError('http://llm.example.com/v1', true)).toBe('An https:// URL is required.');
    expect(httpsError('https://llm.example.com/v1', true)).toBeNull();
    expect(httpsError('http://llm.example.com/v1', false)).toBeNull();
  });

  async function fill() {
    await userEvent.type(screen.getByRole('textbox', { name: /Name/ }), 'Local');
    await userEvent.type(screen.getByRole('textbox', { name: /Base URL/ }), 'http://llm.example.com/v1');
    await userEvent.type(screen.getByRole('textbox', { name: /Model/ }), 'm-1');
    await userEvent.type(screen.getByLabelText(/API key/), 'sk-1');
  }

  it('stops a submit with an http:// URL for experiments and says so under Base URL', async () => {
    const onSubmit = vi.fn();
    render(<ConnectionForm initial={null} busy={false} onCancel={() => {}} onSubmit={onSubmit} />);
    await fill();
    await userEvent.click(screen.getByRole('button', { name: 'Add connection' }));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/An https:\/\/ URL is required\./)).toBeInTheDocument();
  });

  it('offers an accent Test connection before saving, and puts a failed save under its field', async () => {
    const onTest = vi.fn().mockRejectedValue(new ApiError(400, 'Enter an API key to test this connection'));
    const onSubmit = vi.fn().mockRejectedValue(new ApiError(400, 'Private network addresses are blocked'));
    render(
      <ConnectionForm initial={null} busy={false} onCancel={() => {}} onSubmit={onSubmit} onTest={onTest} />,
    );
    await fill();
    await userEvent.click(screen.getByRole('checkbox', { name: /Available for experiments/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Test connection' }));
    expect(onTest).toHaveBeenCalled();
    expect(await screen.findByText('Enter an API key to test this connection')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add connection' }));
    expect(await screen.findByText('Private network addresses are blocked')).toBeInTheDocument();
  });
});
