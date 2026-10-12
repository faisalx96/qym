import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RuleVersion } from '@/api/analysis';
import { api } from '@/lib/http';
import { AUTOSAVE_MS, useDraftRules } from '../useDraftRules';

const version = {
  id: 'v-1',
  version: 1,
  status: 'draft',
  rules: [{ id: 'r1', title: 'One', instruction: 'Do one' }],
} as unknown as RuleVersion;
const scope = { slug: 'demo' };

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useDraftRules', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('autosaves once, 700 ms after the last edit', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({
      analysis_rules: [{ id: 'r1', title: 'One!!', instruction: 'Do one' }],
      rule_version: version,
    });
    const { result } = renderHook(() => useDraftRules(scope, version, true), { wrapper });
    const key = result.current.rules[0]!.key;
    act(() => result.current.update(key, { title: 'One!' }));
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_MS - 100);
    });
    act(() => result.current.update(key, { title: 'One!!' }));
    expect(result.current.state).toBe('dirty');
    expect(patch).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(AUTOSAVE_MS);
    });
    expect(patch).toHaveBeenCalledTimes(1);
    const body = patch.mock.calls[0]![1] as {
      analysis_rules: Array<{ title: string }>;
      rule_version_id: string;
    };
    expect(body.analysis_rules[0]!.title).toBe('One!!');
    expect(body.rule_version_id).toBe('v-1');
    expect(result.current.state).toBe('saved');
  });

  it('does not save an incomplete rule and says why', () => {
    const patch = vi.spyOn(api, 'patch');
    const { result } = renderHook(() => useDraftRules(scope, version, true), { wrapper });
    act(() => {
      result.current.add();
    });
    act(() => {
      vi.advanceTimersByTime(AUTOSAVE_MS * 2);
    });
    expect(result.current.state).toBe('invalid');
    expect(patch).not.toHaveBeenCalled();
  });

  it('ignores edits on a read-only version', () => {
    const { result } = renderHook(() => useDraftRules(scope, version, false), { wrapper });
    act(() => result.current.update(result.current.rules[0]!.key, { title: 'x' }));
    expect(result.current.rules[0]!.title).toBe('One');
    expect(result.current.state).toBe('idle');
  });
});
