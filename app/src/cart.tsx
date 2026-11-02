import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export const MAX_PER_ITEM = 5; // matches the server limit; the server enforces it regardless
type Ctx = {
  lines: Record<number, number>;
  count: number;
  add: (id: number, qty?: number) => void;
  setQty: (id: number, qty: number) => void;
  remove: (id: number) => void;
  clear: () => void;
};
const CartCtx = createContext<Ctx>(null!);
export const useCart = () => useContext(CartCtx);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<Record<number, number>>({});
  const setQty = useCallback((id: number, qty: number) => {
    setLines((cur) => {
      const next = { ...cur };
      if (qty <= 0) delete next[id]; else next[id] = Math.min(qty, MAX_PER_ITEM);
      return next;
    });
  }, []);
  const add = useCallback((id: number, qty = 1) => setLines((cur) => ({ ...cur, [id]: Math.min((cur[id] ?? 0) + qty, MAX_PER_ITEM) })), []);
  const remove = useCallback((id: number) => setQty(id, 0), [setQty]);
  const clear = useCallback(() => setLines({}), []);
  const count = useMemo(() => Object.values(lines).reduce((a, b) => a + b, 0), [lines]);
  const value = useMemo(() => ({ lines, count, add, setQty, remove, clear }), [lines, count, add, setQty, remove, clear]);
  return <CartCtx.Provider value={value}>{children}</CartCtx.Provider>;
}
