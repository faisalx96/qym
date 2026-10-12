/** Shared scaffolding of the Models / Evaluation / Raw JSON / best-run section tests. */
import { render } from '@testing-library/react';
import { useEffect, type ReactElement, type ReactNode } from 'react';
import { LaunchTestProvider, useLaunch, type LaunchContextValue } from '../LaunchContext';
import { makeCtx, makeEnv, PRODUCTION } from '../model/__fixtures__/fixtures';
import { createDocument, type LaunchDocument, type EnvData } from '../model';
import { newClient, Providers } from './helpers';

export { PRODUCTION, makeCtx, makeEnv };

/** What a test can read back from the live provider (doc, secrets, review ...). */
export const live: { current: LaunchContextValue | null } = { current: null };

function Probe() {
  const value = useLaunch();
  live.current = value; // eslint-disable-line react-hooks/immutability -- test probe
  useEffect(() => {
    live.current = value;
  });
  return null;
}

export function Wrap({ children }: { children: ReactNode }) {
  return (
    <Providers client={newClient()}>
      <LaunchTestProvider>{children}</LaunchTestProvider>
    </Providers>
  );
}

export interface RenderOptions {
  envs?: EnvData[];
  doc?: LaunchDocument;
  overrides?: Partial<LaunchContextValue>;
  canManage?: boolean;
  mode?: 'launch' | 'editor';
}

export function renderSection(ui: ReactElement, options: RenderOptions = {}) {
  const envs = options.envs ?? [makeEnv(PRODUCTION, 'production')];
  const doc = options.doc ?? createDocument({ environmentIds: envs.map((e) => e.id) });
  return render(
    <Providers client={newClient()}>
      <LaunchTestProvider
        envs={envs}
        doc={doc}
        canManage={options.canManage}
        mode={options.mode}
        overrides={options.overrides}
        datasetNames={['support-qa']}
      >
        <Probe />
        {ui}
      </LaunchTestProvider>
    </Providers>,
  );
}

/** The current document as JSON text. */
export function docJson(): string {
  return JSON.stringify(live.current?.doc);
}
