import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError, newIdempotencyKey } from '../api';
import { MAX_PER_ITEM, useCart } from '../cart';
import { useNav } from '../nav';
import type { Quote } from '../types';
import { ArrowLeftIcon, Banner, Btn, Card, CartBadge, ChevronRightIcon, ChevronUpIcon, ExclamationTriangleIcon, CheckCircleIcon, Logo, MinusIcon, Muted, PlusIcon, Price, Screen, TagIcon, Thumb, Title, Totals, TrashIcon } from '../ui';
import { c, etb } from '../theme';

/** Totals always come from the server (/quote). The app only displays them. */
function useQuote(promoCode?: string) {
  const { lines } = useCart();
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const items = Object.entries(lines).map(([id, quantity]) => ({ productId: Number(id), quantity }));
    if (!items.length) { setQuote(null); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    api.quote({ items, promoCode }).then((q) => { if (alive) { setQuote(q); setError(null); } })
      .catch((e) => { if (alive) setError(e instanceof ApiError ? e : new ApiError(0, 'NETWORK', 'Cannot reach the server')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [lines, promoCode]);
  return { quote, error, loading };
}

export function CartScreen() {
  const { go, back } = useNav();
  const { lines, setQty, remove, count } = useCart();
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState<string | undefined>();
  const [promoOpen, setPromoOpen] = useState(false);
  const { quote, error, loading } = useQuote(promo);
  const promoError = error?.code === 'INVALID_PROMO' ? error.message : null;
  const blocking = error && error.code !== 'INVALID_PROMO' ? error : null;

  // If a promo was rejected, fall back to the plain quote so the cart is still usable.
  useEffect(() => { if (promoError) setPromo(undefined); }, [promoError]);

  return (
    <Screen footer={count > 0 ? (
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Btn label="Continue shopping" variant="outline" onPress={back} style={{ flex: 1 }} />
        <Btn label="Review order" onPress={() => go({ name: 'review', promoCode: promo })} disabled={!quote || !!blocking} busy={loading && !quote} style={{ flex: 1 }} />
      </View>
    ) : <Btn label="Browse items" onPress={back} />}>
      <View style={s.top}><Logo /><CartBadge count={count} /></View>
      <Title>Your cart</Title>
      {count === 0 ? <Muted>Your cart is empty. Add something from the list.</Muted> : null}
      {blocking ? <Banner tone="error" icon={<ExclamationTriangleIcon size={22} color={c.red} />} title={blocking.message} body="Change the quantity or remove the item." /> : null}
      {quote?.items.map((it) => (
        <Card key={it.productId} style={s.line}>
          <Thumb category={it.category} />
          <View style={{ flex: 1 }}>
            <View style={s.lineTop}><Text style={s.name}>{it.name}</Text><Price price={it.unitPrice * it.quantity} list={it.listPrice * it.quantity} /></View>
            <Muted>{it.sizeLabel}</Muted>
            <View style={s.stepRow}>
              <View style={s.stepper}>
                <Pressable style={s.step} onPress={() => setQty(it.productId, (lines[it.productId] ?? 1) - 1)} accessibilityLabel={`Decrease ${it.name}`}><MinusIcon size={18} color={c.primary} /></Pressable>
                <Text style={s.qty}>{lines[it.productId] ?? it.quantity}</Text>
                <Pressable style={s.step} onPress={() => setQty(it.productId, Math.min(MAX_PER_ITEM, (lines[it.productId] ?? 1) + 1))} accessibilityLabel={`Increase ${it.name}`}><PlusIcon size={18} color={c.primary} /></Pressable>
              </View>
              <Pressable onPress={() => remove(it.productId)} hitSlop={10} accessibilityLabel={`Remove ${it.name}`}><TrashIcon size={22} color={c.red} /></Pressable>
            </View>
          </View>
        </Card>
      ))}
      {quote ? (
        <>
          <Totals {...quote} />
          <Pressable style={s.promo} onPress={() => setPromoOpen((o) => !o)}>
            <TagIcon size={20} color={c.primary} />
            <Text style={[s.promoText, { flex: 1 }]}>{quote.promoCode ? `Promo ${quote.promoCode} applied` : 'Have a promo code?'}</Text>
            {promoOpen ? <ChevronUpIcon size={20} color={c.primary} /> : <ChevronRightIcon size={20} color={c.primary} />}
          </Pressable>
          {promoOpen ? (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
              <TextInput style={s.promoInput} placeholder="Code" placeholderTextColor={c.muted} value={promoInput} onChangeText={setPromoInput} autoCapitalize="characters" autoCorrect={false} />
              <Btn label="Apply" variant="soft" onPress={() => setPromo(promoInput.trim() || undefined)} style={{ minWidth: 90 }} />
            </View>
          ) : null}
          {promoError ? <Text style={{ color: c.red, marginTop: 6 }}>{promoError}</Text> : null}
        </>
      ) : null}
    </Screen>
  );
}

export function ReviewScreen({ promoCode }: { promoCode?: string }) {
  const { go, back, reset } = useNav();
  const { lines, count } = useCart();
  const { quote, error } = useQuote(promoCode);
  const keyRef = useRef(newIdempotencyKey()); // one key per review screen: a double tap or retry returns the SAME order
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const pay = async () => {
    if (!quote) return;
    setBusy(true); setProblem(null);
    try {
      const items = Object.entries(lines).map(([id, quantity]) => ({ productId: Number(id), quantity }));
      const { order } = await api.createOrder({ items, promoCode }, keyRef.current);
      const paid = await api.pay(order.id);
      go({ name: 'order', orderId: paid.order.id });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'UNRESOLVED_ORDER') {
        const id = (e.detail as { orderId?: number } | undefined)?.orderId;
        if (id) { go({ name: 'order', orderId: id }); return; }
      }
      if (e instanceof ApiError && e.code === 'MACHINE_UNAVAILABLE') { reset({ name: 'products' }); return; }
      setProblem(e instanceof ApiError ? (e.isNetwork ? 'No connection. You have not been charged. Try again.' : e.message) : 'Something went wrong. You have not been charged.');
    } finally { setBusy(false); }
  };

  return (
    <Screen footer={
      <>
        <Btn label="Change items" variant="outline" onPress={back} disabled={busy} />
        <Btn label={quote ? `Pay ${etb(quote.total)}` : 'Pay'} onPress={pay} busy={busy} disabled={!quote || !!error || count === 0} />
        <View style={s.meta}><Muted>Payment via SantimPay</Muted></View>
      </>
    }>
      <View style={s.top}><Pressable onPress={back} hitSlop={12} accessibilityLabel="Back"><ArrowLeftIcon size={28} color={c.navy} /></Pressable><Logo /><CartBadge count={count} /></View>
      <Title>Review your order</Title>
      {error ? <Banner tone="error" icon={<ExclamationTriangleIcon size={22} color={c.red} />} title={error.message} /> : null}
      {problem ? <Banner tone="error" icon={<ExclamationTriangleIcon size={22} color={c.red} />} title={problem} /> : null}
      {quote?.items.map((it) => (
        <Card key={it.productId} style={s.line}>
          <Thumb category={it.category} />
          <View style={{ flex: 1 }}><Text style={s.name}>{it.name}</Text><Muted>{it.sizeLabel} · Qty {it.quantity}</Muted></View>
          <Price price={it.unitPrice * it.quantity} list={it.listPrice * it.quantity} />
        </Card>
      ))}
      {quote ? <Totals {...quote} count={quote.items.reduce((n, i) => n + i.quantity, 0)} /> : null}
      {quote?.promoCode ? <Banner tone="success" icon={<CheckCircleIcon size={22} color={c.green} />} title="Promo code applied" body={`${quote.promoCode} has been applied to your order.`} /> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  line: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  lineTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { color: c.navy, fontWeight: '700', fontSize: 16 },
  stepRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 12 },
  step: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: c.primary, fontSize: 22 },
  qty: { color: c.navy, fontWeight: '700', fontSize: 16, minWidth: 28, textAlign: 'center' },
  promo: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 14, padding: 14 },
  promoText: { color: c.muted, fontSize: 15 },
  promoInput: { flex: 1, height: 52, borderRadius: 12, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: 14, color: c.navy, fontSize: 16 },
  meta: { alignItems: 'center' },
});
