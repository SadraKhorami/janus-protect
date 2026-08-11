'use client';

import type { Account } from '@janus/contracts';
import type { LoginInput } from '@janus/validation';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { apiClient } from '../../lib/api-client';

type AuthContextValue = {
  account: Account | null;
  loading: boolean;
  login(input: LoginInput): Promise<void>;
  logout(): Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    apiClient
      .refresh()
      .then((result) => {
        if (active) setAccount(result.account);
      })
      .catch(() => {
        if (active) setAccount(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      account,
      loading,
      async login(input) {
        const result = await apiClient.login(input);
        setAccount(result.account);
      },
      async logout() {
        await apiClient.logout();
        setAccount(null);
      },
    }),
    [account, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider.');
  return context;
}
