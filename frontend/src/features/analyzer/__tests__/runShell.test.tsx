/**
 * cv5 Z11: with a run open on a wide screen the prompt pane stays in one place on every tab. The shell owns the pane
 * column; the run workspace (kept mounted on every tab) renders the pane into it. On the Rules tab a draft gets one
 * honest line: the prompt uses the production rules.
 */
import { render, screen, within } from '@testing-library/react';
import { createPortal } from 'react-dom';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type * as AnalysisModule from '@/api/analysis';
import type { AnalysisConfig, RuleVersion } from '@/api/analysis';
import { ToastProvider } from '@/ui';

let wide = true;

vi.mock('@/features/shell/hooks', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useMediaQuery: () => wide,
}));

vi.mock('@/api/analysis', async (importOriginal) => {
  const real = await importOriginal<typeof AnalysisModule>();
  return {
    ...real,
    useAnalysisConfig: () => ({
      data: { enabled_document_count: 1, default_categories: [] } as unknown as AnalysisConfig,
      isPending: false,
      isError: false,
    }),
    useRunSummary: () => ({ data: { run: { run_id: 'r1', run_name: 'Run one' } }, isError: false }),
    useRuleVersions: () => ({ data: undefined }),
  };
});

vi.mock('../useAnalysisRunner', () => ({
  useAnalysisRunner: () => ({ job: null, busy: false, starting: false, cancelling: false, reconnecting: false }),
}));

vi.mock('../GuidanceArea', () => ({
  GuidanceArea: ({ tab }: { tab: string }) => <div data-testid="guidance">{tab}</div>,
}));

vi.mock('../blocks/ActionRail', () => ({ CompactJobRail: () => null }));

// The real workspace needs the run data; this stand-in keeps its contract: the pane goes into the shell's slot.
vi.mock('../RunAnalyze', () => ({
  RunAnalyze: ({ pane, paneSlot }: { pane: boolean; paneSlot?: HTMLElement | null }) =>
    pane && paneSlot ? createPortal(<aside data-testid="prompt-pane">Prompt preview</aside>, paneSlot) : null,
}));

import { RunShell, rulesNote } from '../RunShell';

function renderShell(scope: 'run' | 'categories' | 'rules' | 'documents') {
  const route = { runId: 'r1', pass: null, metric: '', scope, setScope: vi.fn(), setPass: vi.fn() };
  return render(
    <MemoryRouter>
      <ToastProvider>
        <RunShell slug="p" runId="r1" canManage scope={{ kind: 'run', runId: 'r1' } as never} route={route} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe('RunShell prompt pane (cv5 Z11)', () => {
  it.each(['categories', 'rules', 'documents'] as const)(
    'renders the pane on the %s tab when a run is open on a wide screen',
    (tab) => {
      wide = true;
      renderShell(tab);
      expect(screen.getByTestId('guidance')).toHaveTextContent(tab);
      const slot = screen.getByTestId('prompt-pane-slot');
      expect(within(slot).getByTestId('prompt-pane')).toBeInTheDocument();
    },
  );

  it('has no pane column below 1500px', () => {
    wide = false;
    renderShell('rules');
    expect(screen.queryByTestId('prompt-pane-slot')).toBeNull();
    expect(screen.queryByTestId('prompt-pane')).toBeNull();
  });
});

describe('rulesNote (cv5 Z11)', () => {
  const v = (n: number, status: RuleVersion['status'], rule_count = 3) =>
    ({ id: `id-${n}`, version: n, status, rule_count, is_active: false }) as RuleVersion;
  const versions = [v(5, 'draft'), v(4, 'published'), v(3, 'published')];
  const data = { production_version_id: 'id-4' };

  it('says that a draft is not the prompt’s rules, with the production version', () => {
    expect(rulesNote(versions[0]!, versions, data)).toBe(
      'The prompt uses the production rules (v4). A draft changes it when you publish.',
    );
  });

  it('says nothing for a released version, or when production has no rules', () => {
    expect(rulesNote(versions[1]!, versions, data)).toBeNull();
    expect(rulesNote(versions[0]!, [v(5, 'draft'), v(4, 'published', 0)], data)).toBeNull();
    expect(rulesNote(versions[0]!, versions, { production_version_id: null })).toBeNull();
  });
});
