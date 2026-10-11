/** API payload types for the shell area (brief 01 §4). */
export type GlobalRole = 'ADMIN' | 'MEMBER';
export type ProjectRole = '' | 'MEMBER' | 'MANAGER';
export type AuthType = 'api_key' | 'proxy_headers' | 'oidc' | 'local_password' | 'none' | string;

export interface Project {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
  member_count: number;
  run_count: number;
  role: ProjectRole;
  created_at: string;
  updated_at: string;
  correction_approvers: 'members' | 'managers';
  correction_require_different_reviewer: boolean;
}

export interface Me {
  id: string;
  email: string;
  display_name: string;
  title?: string | null;
  role: GlobalRole;
  auth_type: AuthType;
  auth_provider?: string | null;
  needs_admin_bootstrap: boolean;
  can_bootstrap_admin: boolean;
  projects: Project[];
  default_project: Project | null;
}

export interface AuthProvider {
  id: string;
  label: string;
  enabled: boolean;
  kind: string;
  coming_soon?: boolean;
}

export interface AuthProviders {
  auth_mode: string;
  providers: AuthProvider[];
  local_auth: { enabled: boolean; signup_enabled: boolean };
}

export interface Member {
  user_id: string;
  email: string;
  display_name: string;
  role: 'MEMBER' | 'MANAGER';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MemberCandidate {
  id: string;
  email: string;
  display_name: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  project_id: string;
  creator?: { id: string; email: string; display_name: string } | null;
  scopes?: string[];
  created_at: string;
  revoked_at?: string | null;
}

export interface DatasetReadToken {
  id: string;
  name: string;
  prefix?: string;
  created_at: string;
  revoked_at?: string | null;
  creator?: { id: string; email: string; display_name: string } | null;
}

export interface LlmConnection {
  id: string;
  project_id: string;
  name: string;
  llm_base_url: string;
  llm_model: string;
  llm_api_key_set: boolean;
  llm_api_key_hint: string;
  is_default: boolean;
  available_for_experiments: boolean;
  created_at: string;
  updated_at: string;
}

export interface AnalysisPrompts {
  prompts: Record<string, string>;
  defaults: Record<string, string>;
  updated_at?: string | null;
  [key: string]: unknown;
}

export interface ArchivePreview {
  running_count: number;
  running_runs: { run_id: string; run_name: string; started_at: string }[];
}

export interface UnarchivePreview {
  active_api_key_count: number;
  active_api_keys: { name: string; creator?: string | { display_name?: string; email?: string } | null }[];
}

export interface DeletionPreview {
  project_id: string;
  name: string;
  slug: string;
  archived: boolean;
  counts: Record<string, number>;
  can_delete: boolean;
  blocked_reason?: string | null;
}

export interface RemovalPreview {
  project_id: string;
  user_id: string;
  owned_runs: number;
  owned_deleted_runs: number;
}
