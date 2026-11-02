import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, RefreshControl, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '../api';
import { useCart } from '../cart';
import { useNav } from '../nav';
import { useSession } from '../session';
import type { Category, Machine, Product } from '../types';
import { InformationCircleIcon, MagnifyingGlassIcon, PlusIcon, Banner, Btn, CartBadge, Logo, Muted, Price, Screen, Thumb, Title, WifiIcon, WrenchScrewdriverIcon } from '../ui';
import { c, radius } from '../theme';

const TABS: { key: 'all' | Category; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'drinks', label: 'Drinks' }, { key: 'snacks', label: 'Snacks' }, { key: 'sweets', label: 'Sweets' },
];

export default function Products() {
  const { go } = useNav();
  const { count, add } = useCart();
  const { signOut } = useSession();
  const [products, setProducts] = useState<Product[]>([]);
  const [machine, setMachine] = useState<Machine | null>(null);
  const [tab, setTab] = useState<'all' | Category>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await api.products();
      setProducts(r.products); setMachine(r.machine); setError(null);
    } catch (e) {
      setError(e instanceof ApiError && e.isNetwork ? 'No connection. Showing the last list we loaded; availability may be out of date.' : 'Could not load products.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  const shown = useMemo(() => products.filter((p) =>
    (tab === 'all' || p.category === tab) && p.name.toLowerCase().includes(query.trim().toLowerCase())), [products, tab, query]);

  if (machine && machine.status !== 'ACTIVE') return <Unavailable machineId={machine.id} onRefresh={load} />;

  return (
    <Screen scroll={false}>
      <View style={s.top}>
        <Logo />
        <CartBadge count={count} onPress={() => go({ name: 'cart' })} />
      </View>
      <Title>Choose an item</Title>
      <View style={s.searchWrap}>
        <MagnifyingGlassIcon size={20} color={c.muted} />
        <TextInput style={s.search} placeholder="Search" placeholderTextColor={c.muted} value={query} onChangeText={setQuery} />
      </View>
      <View style={s.tabs}>
        {TABS.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={[s.tab, tab === t.key && s.tabOn]}>
            <Text style={[s.tabText, tab === t.key && { color: c.primary, fontWeight: '700' }]}>{t.label}</Text>
          </Pressable>
        ))}
      </View>
      {error ? <Banner tone="warn" icon={<WifiIcon size={22} color={c.amber} />} title={error} /> : null}
      <FlatList
        data={shown} numColumns={2} keyExtractor={(p) => String(p.id)}
        columnWrapperStyle={{ gap: 12 }} contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        ListEmptyComponent={loading ? undefined : <Muted style={{ textAlign: 'center', marginTop: 24 }}>No items match.</Muted>}
        renderItem={({ item: p }) => (
          <View style={[s.card, p.soldOut && { opacity: 0.6 }]}>
            <View style={s.cardTop}>
              {p.listPrice ? <View style={s.offer}><Text style={s.offerText}>−{Math.round(((p.listPrice - p.price) / p.listPrice) * 100)}%</Text></View> : <View />}
              {p.soldOut ? <View style={s.sold}><Text style={s.soldText}>Sold out</Text></View> : null}
              <Pressable onPress={() => go({ name: 'details', productId: p.id })} hitSlop={10} accessibilityLabel={`Details for ${p.name}`}><InformationCircleIcon size={20} color={c.muted} /></Pressable>
            </View>
            <View style={{ alignItems: 'center', marginVertical: 8 }}><Thumb category={p.category} size={84} /></View>
            <Text style={s.name}>{p.name}</Text>
            <Muted>{p.sizeLabel}</Muted>
            <View style={s.cardBottom}>
              <Price price={p.price} list={p.listPrice} />
              <Pressable disabled={p.soldOut} onPress={() => add(p.id)} style={[s.plus, p.soldOut && { backgroundColor: c.disabled }]} accessibilityLabel={`Add ${p.name}`}>
                <PlusIcon size={22} color={c.primary} />
              </Pressable>
            </View>
          </View>
        )}
      />
      <View style={s.bottom}>
        <Muted>Machine {machine?.id ?? '…'}</Muted>
        <Pressable onPress={signOut}><Text style={{ color: c.primary, fontWeight: '600' }}>Sign out</Text></Pressable>
      </View>
    </Screen>
  );
}

export function Unavailable({ machineId, onRefresh }: { machineId: string; onRefresh: () => void }) {
  return (
    <Screen>
      <View style={s.top}><Logo /></View>
      <Title sub="This machine cannot take new orders right now.">Temporarily unavailable.</Title>
      <Banner tone="info" icon={<WrenchScrewdriverIcon size={22} color={c.primary} />} title="Under maintenance" body="We're working to restore service as soon as possible." />
      <Muted>Machine {machineId}</Muted>
      <View style={{ height: 16 }} />
      <Btn label="Check again" variant="soft" onPress={onRefresh} />
    </Screen>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  search: { height: 50, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: 14, fontSize: 16, color: c.navy },
  searchWrap: { height: 50, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: radius.md, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, paddingHorizontal: 14 },
  tabs: { flexDirection: 'row', justifyContent: 'space-around', marginVertical: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  tab: { paddingVertical: 10, paddingHorizontal: 8 },
  tabOn: { borderBottomWidth: 3, borderBottomColor: c.primary },
  tabText: { color: c.muted, fontSize: 16 },
  card: { flex: 1, backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: 12 },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 26 },
  offer: { backgroundColor: c.primary, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  offerText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  sold: { backgroundColor: c.disabled, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3 },
  soldText: { color: c.muted, fontSize: 13, fontWeight: '600' },
  name: { color: c.navy, fontSize: 16, fontWeight: '700' },
  cardBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 6 },
  plus: { width: 44, height: 44, borderRadius: 12, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
  plusText: { color: c.primary, fontSize: 26, fontWeight: '600', lineHeight: 28 },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 8 },
});
