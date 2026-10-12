import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/http';
import { meKey } from './me';
import type {
  AnalysisPrompts,
  ApiKey,
  DatasetReadToken,
  LlmConnection,
  Member,
  MemberCandidate,
  RemovalPreview,
} from './types';

const k = {
  members: (id: string) => ['project', id, 'members'] as const,
  candidates: (id: string, q: string) => ['project', id, 'member-candidates', q] as const,
  apiKeys: (id: string) => ['project', id, 'api-keys'] as const,
  readTokens: (id: string) => ['project', id, 'dataset-read-tokens'] as const,
  llm: (id: string) => ['project', id, 'llm-connections'] as const,
  prompts: (id: string) => ['project', id, 'analysis-prompts'] as const,
};
export const settingsKeys = k;

export function useMembers(projectId: string | undefined) {
  return useQuery({
    queryKey: k.members(projectId ?? ''),
    queryFn: () => api.get<{ members: Member[] }>(`/v1/projects/${projectId}/members`),
    enabled: Boolean(projectId),
    select: (d) => d.members,
  });
}

export function useMemberCandidates(projectId: string | undefined, q: string, enabled: boolean) {
  return useQuery({
    queryKey: k.candidates(projectId ?? '', q),
    queryFn: () =>
      api.get<{ users: MemberCandidate[]; has_more: boolean }>(
        `/v1/projects/${projectId}/member-candidates?limit=20&q=${encodeURIComponent(q)}`,
      ),
    enabled: Boolean(projectId) && enabled,
    staleTime: 10_000,
  });
}

export function useAddMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { user_id: string; role: 'MEMBER' | 'MANAGER' }) =>
      api.post<Member>(`/v1/projects/${projectId}/members`, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: k.members(projectId) });
      void qc.invalidateQueries({ queryKey: ['project'], predicate: (q) => q.queryKey.length === 2 });
      void qc.invalidateQueries({ queryKey: meKey });
    },
  });
}

export function useUpdateMemberRole(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'MEMBER' | 'MANAGER' }) =>
      api.patch<Member>(`/v1/projects/${projectId}/members/${userId}`, { role }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: k.members(projectId) }),
  });
}

export const fetchRemovalPreview = (projectId: string, userId: string) =>
  api.get<RemovalPreview>(`/v1/projects/${projectId}/members/${userId}/removal-preview`);

export function useRemoveMember(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, transferTo }: { userId: string; transferTo?: string }) =>
      api.delete<{ ok: boolean; transferred_runs?: number }>(
        `/v1/projects/${projectId}/members/${userId}${transferTo ? `?transfer_runs_to=${encodeURIComponent(transferTo)}` : ''}`,
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: k.members(projectId) });
      void qc.invalidateQueries({ queryKey: k.apiKeys(projectId) });
      void qc.invalidateQueries({ queryKey: ['project'], predicate: (q) => q.queryKey.length === 2 });
      void qc.invalidateQueries({ queryKey: meKey });
    },
  });
}

export function useApiKeys(projectId: string | undefined) {
  return useQuery({
    queryKey: k.apiKeys(projectId ?? ''),
    queryFn: () => api.get<{ api_keys: ApiKey[] }>(`/v1/projects/${projectId}/api-keys`),
    enabled: Boolean(projectId),
    select: (d) => d.api_keys,
  });
}

export function useCreateApiKey(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string }) =>
      api.post<{ id: string; prefix: string; token: string }>(`/v1/projects/${projectId}/api-keys`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: k.apiKeys(projectId) }),
  });
}

export function useRevokeApiKey(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (keyId: string) =>
      api.delete<{ ok: boolean; id: string }>(`/v1/projects/${projectId}/api-keys/${keyId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: k.apiKeys(projectId) }),
  });
}

export function useDatasetReadTokens(projectId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: k.readTokens(projectId ?? ''),
    queryFn: () => api.get<{ tokens: DatasetReadToken[] }>(`/v1/projects/${projectId}/dataset-read-tokens`),
    enabled: Boolean(projectId) && enabled,
    select: (d) => d.tokens,
  });
}

export function useCreateReadToken(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name?: string }) =>
      api.post<DatasetReadToken & { token: string }>(`/v1/projects/${projectId}/dataset-read-tokens`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: k.readTokens(projectId) }),
  });
}

export function useRevokeReadToken(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tokenId: string) =>
      api.delete<{ ok: boolean }>(`/v1/projects/${projectId}/dataset-read-tokens/${tokenId}`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: k.readTokens(projectId) }),
  });
}

export function useLlmConnections(projectId: string | undefined) {
  return useQuery({
    queryKey: k.llm(projectId ?? ''),
    queryFn: () => api.get<{ connections: LlmConnection[] }>(`/v1/projects/${projectId}/llm-connections`),
    enabled: Boolean(projectId),
    select: (d) => d.connections,
  });
}

export interface LlmConnectionBody {
  name: string;
  llm_base_url: string;
  llm_model: string;
  llm_api_key: string;
  available_for_experiments?: boolean;
}

export function useSaveLlmConnection(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: LlmConnectionBody }) =>
      id
        ? api.put<LlmConnection>(`/v1/projects/${projectId}/llm-connections/${id}`, body)
        : api.post<LlmConnection>(`/v1/projects/${projectId}/llm-connections`, body),
    onSuccess: () => void qc.invalidateQueries({ queryKey: k.llm(projectId) }),
  });
}

export type LlmActionResult = { ok?: boolean; model?: string; response?: string } | LlmConnection;

export function useLlmConnectionAction(projectId: string) {
  const qc = useQueryClient();
  return useMutation<LlmActionResult, Error, { id: string; action: 'delete' | 'set-default' | 'test' }>({
    mutationFn: ({ id, action }) =>
      action === 'delete'
        ? api.delete<LlmActionResult>(`/v1/projects/${projectId}/llm-connections/${id}`)
        : api.post<LlmActionResult>(`/v1/projects/${projectId}/llm-connections/${id}/${action}`),
    onSuccess: (_r, { action }) => {
      if (action !== 'test') void qc.invalidateQueries({ queryKey: k.llm(projectId) });
    },
  });
}

export function useAnalysisPrompts(projectId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: k.prompts(projectId ?? ''),
    queryFn: () => api.get<AnalysisPrompts>(`/v1/projects/${projectId}/analysis-prompts`),
    enabled: Boolean(projectId) && enabled,
  });
}

export function useSavePrompt(projectId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      api.patch<AnalysisPrompts>(`/v1/projects/${projectId}/analysis-prompts/${key}`, { value }),
    onSuccess: (data) => qc.setQueryData(k.prompts(projectId), data),
  });
}
