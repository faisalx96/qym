/** Strings of the environment form's latency-sensitive policy (spec-b B5-43 to B5-45). */
export const LATENCY_ROLE_LABEL = 'Who can launch latency-sensitive runs';
export const LATENCY_ROLE_ITEMS = [
  { key: 'member', label: 'Anyone in the project' },
  { key: 'manager', label: 'Project managers only' },
] as const;
export const LATENCY_ROLE_HELP =
  'Latency-sensitive runs make other jobs on this environment wait. Project managers and admins can change this.';
export const LATENCY_ROLE_ERROR = 'Choose who can launch latency-sensitive runs.';
