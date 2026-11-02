import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api, setToken, setUnauthorizedHandler } from './api';
import type { User } from './types';

const KEY = 'revov.token';
type Ctx = { user: User | null; ready: boolean; signIn: (u: string, p: string) => Promise<void>; signOut: () => Promise<void> };
const SessionCtx = createContext<Ctx>(null!);
export const useSession = () => useContext(SessionCtx);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  const signOut = useCallback(async () => {
    setToken(null);
    setUser(null);
    await SecureStore.deleteItemAsync(KEY).catch(() => {});
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { void signOut(); });
    (async () => {
      try {
        const saved = await SecureStore.getItemAsync(KEY);
        if (saved) {
          setToken(saved);
          setUser((await api.me()).user); // the server decides if the saved session is still valid
        }
      } catch {
        // expired, revoked, or backend unreachable: fall back to the sign-in screen
        setToken(null);
      } finally {
        setReady(true);
      }
    })();
    return () => setUnauthorizedHandler(null);
  }, [signOut]);

  const signIn = useCallback(async (username: string, password: string) => {
    const r = await api.login(username, password);
    setToken(r.token);
    await SecureStore.setItemAsync(KEY, r.token);
    setUser(r.user);
  }, []);

  const value = useMemo(() => ({ user, ready, signIn, signOut }), [user, ready, signIn, signOut]);
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
