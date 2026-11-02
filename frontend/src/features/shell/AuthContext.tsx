import { createContext, useContext } from 'react';
import type { Me } from '@/api/types';

export interface AuthValue {
  me: Me;
  isAdmin: boolean;
  refetch: () => void;
}

export const AuthContext = createContext<AuthValue | null>(null);

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used under <RequireAuth>');
  return ctx;
}
