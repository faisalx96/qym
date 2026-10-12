/**
 * Per-environment data of the launch form: the generated form, the LLM model slots, the project
 * models and the extra-endpoint proposals, as TanStack queries (in-flight requests of one key
 * are shared, so a base that loads while the selection loads never reads half a form). The same
 * data is also available imperatively (`loadEnvDataNow`) for code that lays a starting point
 * under the document and must not depend on what has rendered yet.
 */
import { useCallback, useMemo } from 'react';
import { useQueries, type QueryClient } from '@tanstack/react-query';
import { errorMessage, type EvalEnvironment } from '@/api/evalCommon';
import {
  fetchForm,
  fetchOptions,
  fetchProposal,
  fetchSlots,
  launchKeys,
  type ModelSlotsPayload,
} from '@/api/launch';
import { envDataFrom, type EnvData, type FormResponse, type ModelOptions, type ModelSlot } from '../model';

type Kind = 'form' | 'slots' | 'options' | 'extra';
interface Part {
  envId: string;
  kind: Kind;
  name?: string;
}
interface Group {
  form?: FormResponse;
  formError?: string;
  slots?: ModelSlotsPayload;
  options?: ModelOptions;
  optionsError?: string;
  extra: Record<string, ModelSlot | null>;
  pending: boolean;
}

function toEnvData(env: EvalEnvironment, group: Group | undefined): EnvData {
  const data = envDataFrom({
    id: env.id,
    name: env.name,
    form: group?.form,
    formError: group?.formError,
    slots: group?.slots,
    options: group?.options,
    optionsError: group?.optionsError,
    maxPriority: env.max_priority,
    defaultPriority: env.default_priority,
    schemaHash: env.schema_hash,
    extra: group?.extra,
  });
  return { ...data, loading: !group || group.pending };
}

/** EnvData of the selected environments, in selection order (`loading` until all parts arrived). */
export function useEnvData(
  projectId: string,
  selected: readonly EvalEnvironment[],
  extraEndpoints: readonly string[],
): EnvData[] {
  const selectedKey = selected.map((e) => e.id).join(',');
  const extraKey = extraEndpoints.join(',');
  const parts = useMemo<Part[]>(
    () =>
      selected.flatMap((e) => [
        { envId: e.id, kind: 'form' as const },
        { envId: e.id, kind: 'slots' as const },
        { envId: e.id, kind: 'options' as const },
        ...extraEndpoints.map((name) => ({ envId: e.id, kind: 'extra' as const, name })),
      ]),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the id lists
    [selectedKey, extraKey],
  );
  const queries = useMemo(
    () =>
      parts.map((p) => {
        switch (p.kind) {
          case 'form':
            return {
              queryKey: launchKeys.form(projectId, p.envId),
              queryFn: () => fetchForm(projectId, p.envId),
            };
          case 'slots':
            return {
              queryKey: launchKeys.slots(projectId, p.envId),
              queryFn: () => fetchSlots(projectId, p.envId),
            };
          case 'options':
            return {
              queryKey: launchKeys.options(projectId, p.envId),
              queryFn: () => fetchOptions(projectId, p.envId),
            };
          default:
            return {
              queryKey: launchKeys.extraSlot(projectId, p.envId, p.name ?? ''),
              queryFn: () => fetchProposal(projectId, p.envId, p.name ?? ''),
            };
        }
      }),
    [parts, projectId],
  );
  const combine = useCallback(
    (results: Array<{ data?: unknown; error: unknown; isPending: boolean }>) => {
      const groups: Record<string, Group> = {};
      parts.forEach((p, i) => {
        const r = results[i];
        if (!r) return;
        const g = (groups[p.envId] ??= { extra: {}, pending: false });
        if (r.isPending) g.pending = true;
        if (p.kind === 'form') {
          if (r.data) g.form = r.data as FormResponse;
          else if (r.error) g.formError = errorMessage(r.error) || 'Failed to load the settings form';
        } else if (p.kind === 'slots') {
          if (r.data) g.slots = r.data as ModelSlotsPayload;
        } else if (p.kind === 'options') {
          if (r.data) g.options = r.data as ModelOptions;
          else if (r.error) g.optionsError = errorMessage(r.error) || 'Failed to load project models';
        } else if (p.name) {
          g.extra[p.name] = (r.data as ModelSlot | null | undefined) ?? null;
        }
      });
      return groups;
    },
    [parts],
  );
  const groups = useQueries({ queries, combine });
  return useMemo(() => selected.map((e) => toEnvData(e, groups[e.id])), [selected, groups]);
}

/**
 * The same EnvData built from the query cache, fetching what is missing (in-flight requests are
 * shared with the hook above). Used by async flows that need a fresh form context.
 */
export async function loadEnvDataNow(
  qc: QueryClient,
  projectId: string,
  selected: readonly EvalEnvironment[],
  extraEndpoints: readonly string[],
): Promise<EnvData[]> {
  return Promise.all(
    selected.map(async (e) => {
      const settle = <T>(p: Promise<T>) =>
        p.then(
          (value) => ({ value }) as { value: T; error?: undefined },
          (error: unknown) => ({ error }) as { value?: undefined; error: unknown },
        );
      const [form, slots, options, extras] = await Promise.all([
        settle(
          qc.ensureQueryData({
            queryKey: launchKeys.form(projectId, e.id),
            queryFn: () => fetchForm(projectId, e.id),
          }),
        ),
        settle(
          qc.ensureQueryData({
            queryKey: launchKeys.slots(projectId, e.id),
            queryFn: () => fetchSlots(projectId, e.id),
          }),
        ),
        settle(
          qc.ensureQueryData({
            queryKey: launchKeys.options(projectId, e.id),
            queryFn: () => fetchOptions(projectId, e.id),
          }),
        ),
        Promise.all(
          extraEndpoints.map(async (name) => {
            const r = await settle(
              qc.ensureQueryData({
                queryKey: launchKeys.extraSlot(projectId, e.id, name),
                queryFn: () => fetchProposal(projectId, e.id, name),
              }),
            );
            return [name, r.value ?? null] as const;
          }),
        ),
      ]);
      const group: Group = {
        form: form.value,
        formError: form.error ? errorMessage(form.error) || 'Failed to load the settings form' : undefined,
        slots: slots.value,
        options: options.value,
        optionsError: options.error
          ? errorMessage(options.error) || 'Failed to load project models'
          : undefined,
        extra: Object.fromEntries(extras),
        pending: false,
      };
      return toEnvData(e, group);
    }),
  );
}
