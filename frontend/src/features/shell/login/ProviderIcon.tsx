/** Brand marks and one-line descriptions for the identity-provider buttons. */

const DESCRIPTIONS: Record<string, string> = {
  google: 'Use your Google identity to continue',
  github: 'Use your GitHub account to continue',
  gitlab: 'Use your GitLab account to continue',
  sso: 'Enterprise identity provider',
};

export function providerDescription(id: string): string {
  return DESCRIPTIONS[id.toLowerCase()] ?? 'Continue with this provider';
}

export function ProviderIcon({ id }: { id: string }) {
  const key = id.toLowerCase();
  if (key === 'google')
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="#EA4335"
          d="M12 10.2v3.96h5.5c-.24 1.28-.98 2.37-2.08 3.1l3.36 2.61c1.96-1.81 3.09-4.47 3.09-7.63 0-.73-.06-1.43-.19-2.11H12z"
        />
        <path
          fill="#4285F4"
          d="M12 22c2.79 0 5.13-.92 6.84-2.5l-3.36-2.61c-.93.63-2.11 1-3.48 1-2.68 0-4.95-1.81-5.76-4.24H2.77v2.66A9.99 9.99 0 0012 22z"
        />
        <path
          fill="#FBBC05"
          d="M6.24 13.65A5.99 5.99 0 015.92 12c0-.57.08-1.12.22-1.65V7.69H2.77A9.99 9.99 0 002 12c0 1.61.39 3.13 1.08 4.46l3.16-2.81z"
        />
        <path
          fill="#34A853"
          d="M12 6.11c1.52 0 2.89.52 3.97 1.54l2.98-2.98C17.12 2.98 14.79 2 12 2A9.99 9.99 0 002.77 7.69l3.37 2.66C7.05 7.92 9.32 6.11 12 6.11z"
        />
      </svg>
    );
  if (key === 'github')
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
        <path d="M12 .5C5.65.5.5 5.72.5 12.15c0 5.15 3.3 9.52 7.89 11.06.58.11.79-.26.79-.58v-2.24c-3.21.71-3.89-1.39-3.89-1.39-.52-1.36-1.28-1.72-1.28-1.72-1.04-.73.08-.72.08-.72 1.15.08 1.75 1.2 1.75 1.2 1.02 1.79 2.69 1.28 3.35.98.1-.76.4-1.28.72-1.58-2.56-.3-5.26-1.31-5.26-5.85 0-1.29.46-2.34 1.2-3.17-.12-.3-.52-1.52.12-3.17 0 0 .98-.32 3.22 1.21a10.93 10.93 0 015.86 0c2.24-1.53 3.22-1.21 3.22-1.21.64 1.65.24 2.87.12 3.17.75.83 1.2 1.88 1.2 3.17 0 4.55-2.7 5.55-5.28 5.84.41.36.78 1.07.78 2.16v3.21c0 .32.21.69.8.58 4.58-1.54 7.88-5.91 7.88-11.06C23.5 5.72 18.35.5 12 .5z" />
      </svg>
    );
  if (key === 'gitlab')
    return (
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path
          fill="#FC6D26"
          d="m23.6 9.59-.03-.09L20.3.98a.85.85 0 0 0-.34-.4.87.87 0 0 0-1 .05.87.87 0 0 0-.29.44l-2.2 6.75H7.54L5.33 1.07a.86.86 0 0 0-.29-.44.87.87 0 0 0-1-.05.86.86 0 0 0-.34.4L.43 9.5l-.03.09a6.07 6.07 0 0 0 2.01 7.01l.01.01.03.02 4.98 3.73 2.46 1.86 1.5 1.13a1.01 1.01 0 0 0 1.22 0l1.5-1.13 2.46-1.86 5.01-3.75.01-.01a6.07 6.07 0 0 0 2.01-7z"
        />
      </svg>
    );
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path
        d="M4 19h16M6 19V9l6-4 6 4v10M9 13h1m4 0h1m-6 3h1m4 0h1"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
