import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { BackHandler } from 'react-native';

// Deliberately tiny: ~9 screens, one stack. No navigation library needed.
export type Route =
  | { name: 'products' }
  | { name: 'details'; productId: number }
  | { name: 'cart' }
  | { name: 'review'; promoCode?: string }
  | { name: 'order'; orderId: number }
  | { name: 'admin' };

type Ctx = { route: Route; go: (r: Route) => void; back: () => void; reset: (r: Route) => void };
const NavCtx = createContext<Ctx>(null!);
export const useNav = () => useContext(NavCtx);

export function NavProvider({ initial, children }: { initial: Route; children: React.ReactNode }) {
  const [stack, setStack] = useState<Route[]>([initial]);
  const route = stack[stack.length - 1];

  const go = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const reset = useCallback((r: Route) => setStack([r]), []);
  const back = useCallback(() => setStack((s) => {
    // A live order screen can only be left through its own buttons, so a payment is never abandoned by accident.
    if (s.length <= 1 || s[s.length - 1].name === 'order') return s;
    return s.slice(0, -1);
  }), []);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { back(); return true; });
    return () => sub.remove();
  }, [back]);

  const value = useMemo(() => ({ route, go, back, reset }), [route, go, back, reset]);
  return <NavCtx.Provider value={value}>{children}</NavCtx.Provider>;
}
