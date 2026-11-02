import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { api, ApiError } from '../api';
import { useSession } from '../session';
import type { AdminProduct, Category, Machine } from '../types';
import { Banner, Btn, Card, ExclamationTriangleIcon, Logo, Muted, Screen, Thumb, Title } from '../ui';
import { c, etb, parseEtb } from '../theme';

const CATS: Category[] = ['drinks', 'snacks', 'sweets'];
const fail = (e: unknown) => Alert.alert('Could not save', e instanceof ApiError ? e.message : 'Something went wrong');

export default function Admin() {
  const { signOut } = useSession();
  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [machine, setMachine] = useState<Machine | null>(null);
  const [editing, setEditing] = useState<AdminProduct | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [p, m] = await Promise.all([api.adminProducts(), api.machine()]);
      setProducts(p.products); setMachine(m); setError(null);
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not load'); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const toggleMachine = async (on: boolean) => {
    try { setMachine(await api.setMachine(on ? 'ACTIVE' : 'MAINTENANCE')); } catch (e) { fail(e); }
  };

  if (editing) return <ProductForm product={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void load(); }} />;

  return (
    <Screen footer={<Btn label="Add product" onPress={() => setEditing('new')} />}>
      <View style={s.top}><Logo /><Pressable onPress={signOut}><Text style={{ color: c.primary, fontWeight: '600' }}>Sign out</Text></Pressable></View>
      <Title>Admin</Title>
      {error ? <Banner tone="error" icon={<ExclamationTriangleIcon size={22} color={c.red} />} title={error} /> : null}
      {machine ? (
        <Card style={s.rowBetween}>
          <View><Text style={s.name}>Machine {machine.id}</Text><Muted>{machine.status === 'ACTIVE' ? 'Taking orders' : 'Under maintenance, orders blocked'}</Muted></View>
          <Switch value={machine.status === 'ACTIVE'} onValueChange={toggleMachine} trackColor={{ true: c.primary }} />
        </Card>
      ) : null}
      {products.map((p) => <ProductRow key={p.id} p={p} onEdit={() => setEditing(p)} onChanged={load} />)}
    </Screen>
  );
}

function ProductRow({ p, onEdit, onChanged }: { p: AdminProduct; onEdit: () => void; onChanged: () => void }) {
  const [qty, setQty] = useState(String(p.stock.onHand));
  useEffect(() => setQty(String(p.stock.onHand)), [p.stock.onHand]);
  const changed = qty !== String(p.stock.onHand);
  const save = async () => {
    const n = Number(qty);
    if (!Number.isInteger(n) || n < 0) return Alert.alert('Stock must be a whole number, 0 or more.');
    try { await api.setStock(p.id, n, 'Set from admin screen'); onChanged(); } catch (e) { fail(e); }
  };
  return (
    <Card style={!p.active ? { opacity: 0.6 } : undefined}>
      <View style={s.rowBetween}>
        <View style={{ flexDirection: 'row', gap: 12, flex: 1 }}>
          <Thumb category={p.category} size={48} />
          <View style={{ flex: 1 }}>
            <Text style={s.name}>{p.name} {!p.active ? '(hidden)' : ''}</Text>
            <Muted>{p.sizeLabel} · {etb(p.priceMinor)}{p.listPriceMinor && p.listPriceMinor > p.priceMinor ? ` (was ${etb(p.listPriceMinor)})` : ''}{p.slot ? ` · slot ${p.slot}` : ''}</Muted>
          </View>
        </View>
        <Pressable onPress={onEdit} hitSlop={8}><Text style={{ color: c.primary, fontWeight: '700' }}>Edit</Text></Pressable>
      </View>
      <View style={[s.rowBetween, { marginTop: 10 }]}>
        <Muted>Held for orders: {p.stock.reserved} · Available: {p.stock.available}</Muted>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput style={s.qtyInput} value={qty} onChangeText={setQty} keyboardType="number-pad" accessibilityLabel={`Stock for ${p.name}`} />
          <Btn label="Set" variant={changed ? 'primary' : 'soft'} disabled={!changed} onPress={save} style={{ minHeight: 44, minWidth: 64 }} />
        </View>
      </View>
    </Card>
  );
}

function ProductForm({ product, onClose, onSaved }: { product: AdminProduct | null; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(product?.name ?? '');
  const [category, setCategory] = useState<Category>(product?.category ?? 'drinks');
  const [size, setSize] = useState(product?.sizeLabel ?? '');
  const [price, setPrice] = useState(product ? String(product.priceMinor / 100) : '');
  const [list, setList] = useState(product?.listPriceMinor ? String(product.listPriceMinor / 100) : '');
  const [slot, setSlot] = useState(product?.slot ?? '');
  const [active, setActive] = useState(product?.active ?? true);
  const [stock, setStock] = useState('0');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const priceMinor = parseEtb(price);
    const listPriceMinor = list.trim() ? parseEtb(list) : null;
    if (!name.trim()) return Alert.alert('Enter a product name.');
    if (!priceMinor) return Alert.alert('Enter a price greater than 0.');
    if (list.trim() && (!listPriceMinor || listPriceMinor < priceMinor)) return Alert.alert('Original price must be at least the price.');
    const body = { name: name.trim(), category, sizeLabel: size.trim(), priceMinor, listPriceMinor, slot: slot.trim() || null, active };
    setBusy(true);
    try {
      if (product) await api.updateProduct(product.id, body);
      else await api.createProduct({ ...body, stock: Math.max(0, parseInt(stock, 10) || 0) });
      onSaved();
    } catch (e) { fail(e); } finally { setBusy(false); }
  };

  return (
    <Screen footer={<><Btn label={product ? 'Save changes' : 'Add product'} onPress={save} busy={busy} /><Btn label="Cancel" variant="outline" onPress={onClose} disabled={busy} /></>}>
      <Title>{product ? 'Edit product' : 'Add product'}</Title>
      <Field label="Name" value={name} onChangeText={setName} />
      <Text style={s.label}>Category</Text>
      <View style={s.chips}>
        {CATS.map((k) => <Pressable key={k} onPress={() => setCategory(k)} style={[s.chip, category === k && s.chipOn]}><Text style={{ color: category === k ? '#fff' : c.navy, fontWeight: '600' }}>{k}</Text></Pressable>)}
      </View>
      <Field label="Size (e.g. 300 ml)" value={size} onChangeText={setSize} />
      <Field label="Price (ETB)" value={price} onChangeText={setPrice} keyboardType="decimal-pad" />
      <Field label="Original price before offer (ETB, optional)" value={list} onChangeText={setList} keyboardType="decimal-pad" />
      <Field label="Machine slot (optional)" value={slot} onChangeText={setSlot} />
      {!product ? <Field label="Starting stock" value={stock} onChangeText={setStock} keyboardType="number-pad" /> : null}
      <View style={[s.rowBetween, { marginTop: 8 }]}><Text style={s.name}>Visible to staff</Text><Switch value={active} onValueChange={setActive} trackColor={{ true: c.primary }} /></View>
    </Screen>
  );
}

function Field({ label, ...rest }: { label: string } & React.ComponentProps<typeof TextInput>) {
  return <><Text style={s.label}>{label}</Text><TextInput style={s.input} placeholderTextColor={c.muted} {...rest} /></>;
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  name: { color: c.navy, fontSize: 16, fontWeight: '700' },
  label: { color: c.muted, fontSize: 14, marginTop: 10, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: c.border, backgroundColor: c.card, borderRadius: 12, paddingHorizontal: 14, height: 50, fontSize: 16, color: c.navy },
  qtyInput: { width: 70, height: 44, borderWidth: 1, borderColor: c.border, borderRadius: 10, textAlign: 'center', fontSize: 16, color: c.navy, backgroundColor: c.card },
  chips: { flexDirection: 'row', gap: 8 },
  chip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20, backgroundColor: c.primarySoft },
  chipOn: { backgroundColor: c.primary },
});
