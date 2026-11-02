import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../api';
import { MAX_PER_ITEM, useCart } from '../cart';
import { useNav } from '../nav';
import type { Product } from '../types';
import { ArrowLeftIcon, Btn, Card, CartBadge, ClipboardDocumentListIcon, ExclamationTriangleIcon, InformationCircleIcon, MinusIcon, Muted, PlusIcon, Price, Screen, SparklesIcon, Thumb } from '../ui';
import { c, etb } from '../theme';

// The backend does not store ingredients/nutrition/allergens yet, so we say so instead of inventing data.
const INFO = [[SparklesIcon, 'Ingredients'], [ClipboardDocumentListIcon, 'Nutrition'], [ExclamationTriangleIcon, 'Allergens']] as const;

export default function Details({ productId }: { productId: number }) {
  const { back, go } = useNav();
  const { add, count } = useCart();
  const [product, setProduct] = useState<Product | null>(null);
  const [qty, setQty] = useState(1);

  useEffect(() => { api.products().then((r) => setProduct(r.products.find((p) => p.id === productId) ?? null)).catch(() => {}); }, [productId]);

  return (
    <Screen footer={product && !product.soldOut ? (
      <Btn label={`Add to cart  •  ${etb(product.price * qty)}`} onPress={() => { add(product.id, qty); back(); }} />
    ) : undefined}>
      <View style={s.top}>
        <Pressable onPress={back} hitSlop={12} accessibilityLabel="Back"><ArrowLeftIcon size={28} color={c.navy} /></Pressable>
        <Text style={s.topTitle}>Product details</Text>
        <CartBadge count={count} onPress={() => go({ name: 'cart' })} />
      </View>
      {!product ? <Muted style={{ marginTop: 24 }}>Loading…</Muted> : (
        <>
          <View style={{ alignItems: 'center', marginVertical: 16 }}><Thumb category={product.category} size={160} /></View>
          <Text style={s.name}>{product.name}</Text>
          <Muted>{product.sizeLabel}</Muted>
          <View style={{ marginVertical: 8 }}><Price price={product.price} list={product.listPrice} big /></View>
          <Card>
            {INFO.map(([Icon, label], i) => (
              <View key={label} style={[s.infoRow, i > 0 && { borderTopWidth: 1, borderTopColor: c.border }]}>
                <Icon size={22} color={c.primary} style={{ width: 36 }} />
                <View><Text style={s.infoLabel}>{label}</Text><Muted>Information not available</Muted></View>
              </View>
            ))}
          </Card>
          {product.soldOut ? <Muted>This item is sold out.</Muted> : (
            <View style={s.qtyRow}>
              <Text style={s.infoLabel}>Quantity</Text>
              <View style={s.stepper}>
                <Pressable style={s.stepBtn} onPress={() => setQty((q) => Math.max(1, q - 1))} accessibilityLabel="Decrease quantity"><MinusIcon size={20} color={c.primary} /></Pressable>
                <Text style={s.qty}>{qty}</Text>
                <Pressable style={s.stepBtn} onPress={() => setQty((q) => Math.min(MAX_PER_ITEM, q + 1))} accessibilityLabel="Increase quantity"><PlusIcon size={20} color={c.primary} /></Pressable>
              </View>
            </View>
          )}
        </>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topTitle: { color: c.navy, fontSize: 18, fontWeight: '600' },
  name: { color: c.navy, fontSize: 28, fontWeight: '800' },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  infoLabel: { color: c.navy, fontSize: 16, fontWeight: '700' },
  qtyRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepBtn: { width: 52, height: 48, borderRadius: 12, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
  stepText: { color: c.primary, fontSize: 26 },
  qty: { color: c.navy, fontSize: 20, fontWeight: '700', minWidth: 24, textAlign: 'center' },
});
