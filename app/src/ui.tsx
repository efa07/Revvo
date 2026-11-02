import React from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  ArrowLeftIcon,
  ArchiveBoxIcon,
  BeakerIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClipboardDocumentListIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  ShoppingBagIcon,
  SparklesIcon,
  TagIcon,
  TrashIcon,
  WrenchScrewdriverIcon,
  WifiIcon,
} from 'react-native-heroicons/outline';
import type { Category } from './types';
import { c, etb, radius } from './theme';

const TOP = Platform.OS === 'android' ? StatusBar.currentHeight ?? 0 : 0;
const ICON_SIZE = 22;

export {
  ArrowLeftIcon,
  ArchiveBoxIcon,
  BeakerIcon,
  CheckCircleIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ClipboardDocumentListIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PlusIcon,
  ShoppingBagIcon,
  SparklesIcon,
  TagIcon,
  TrashIcon,
  WrenchScrewdriverIcon,
  WifiIcon,
};

export function Screen({ children, scroll = true, footer }: { children: React.ReactNode; scroll?: boolean; footer?: React.ReactNode }) {
  return (
    <View style={[s.screen, { paddingTop: TOP + 8 }]}>
      <StatusBar barStyle="dark-content" />
      {scroll ? <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">{children}</ScrollView> : <View style={s.scroll}>{children}</View>}
      {footer ? <View style={s.footer}>{footer}</View> : null}
    </View>
  );
}

export function Logo() {
  return (
    <View style={s.logoRow}>
      <View style={s.logoMark}><Text style={s.logoR}>R</Text></View>
      <View>
        <Text style={s.logoWord}>RevoV</Text>
        <Text style={s.logoSub}>By SATEV Group</Text>
      </View>
    </View>
  );
}

export function CartBadge({ count, onPress }: { count: number; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={s.cartBtn} accessibilityLabel={`Cart, ${count} items`}>
      <ShoppingBagIcon size={ICON_SIZE} color={c.navy} />
      <View style={s.badge}><Text style={s.badgeText}>{count}</Text></View>
    </Pressable>
  );
}

export function Btn({ label, onPress, variant = 'primary', disabled, busy, style }: {
  label: string; onPress: () => void; variant?: 'primary' | 'outline' | 'soft'; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const off = disabled || busy;
  return (
    <Pressable
      onPress={onPress} disabled={off} accessibilityRole="button"
      style={({ pressed }) => [s.btn, variant === 'primary' && { backgroundColor: off ? c.disabled : c.primary }, variant === 'outline' && s.btnOutline,
        variant === 'soft' && { backgroundColor: c.primarySoft }, pressed && { opacity: 0.85 }, style]}
    >
      {busy ? <ActivityIndicator color={variant === 'primary' ? '#fff' : c.primary} /> :
        <Text style={[s.btnText, variant !== 'primary' && { color: c.primary }]}>{label}</Text>}
    </Pressable>
  );
}

export const Card = ({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) => <View style={[s.card, style]}>{children}</View>;

const TONES = {
  info: { bg: c.primarySoft, fg: c.primary }, success: { bg: c.greenSoft, fg: c.green },
  error: { bg: c.redSoft, fg: c.red }, warn: { bg: c.amberSoft, fg: c.amber },
} as const;
export function Banner({ tone, title, body, icon, busy }: { tone: keyof typeof TONES; title: string; body?: string; icon?: React.ReactNode; busy?: boolean }) {
  const t = TONES[tone];
  return (
    <View style={[s.banner, { backgroundColor: t.bg }]}>
      {busy ? <ActivityIndicator color={t.fg} /> : icon ?? <InformationCircleIcon size={ICON_SIZE} color={t.fg} />}
      <View style={{ flex: 1 }}>
        <Text style={[s.bannerTitle, { color: t.fg }]}>{title}</Text>
        {body ? <Text style={s.bannerBody}>{body}</Text> : null}
      </View>
    </View>
  );
}

const CATEGORY_ICON: Record<Category, React.ComponentType<{ color?: string; size?: number }>> = {
  drinks: BeakerIcon,
  snacks: ArchiveBoxIcon,
  sweets: SparklesIcon,
};
export const Thumb = ({ category, size = 56 }: { category: Category; size?: number }) => (
  <View style={[s.thumb, { width: size, height: size }]}>{(() => {
    const CategoryIcon = CATEGORY_ICON[category];
    return <CategoryIcon size={size * 0.55} color={c.primary} />;
  })()}</View>
);

export function Price({ price, list, big }: { price: number; list?: number | null; big?: boolean }) {
  return (
    <Text style={{ color: c.navy }}>
      <Text style={{ fontWeight: '800', fontSize: big ? 22 : 16 }}>{etb(price)}</Text>
      {list && list > price ? <Text style={{ color: c.muted, textDecorationLine: 'line-through', fontSize: big ? 16 : 12 }}>{'  '}{etb(list)}</Text> : null}
    </Text>
  );
}

export function Totals({ subtotal, offerSavings, promoCode, promoDiscount, total, count }: {
  subtotal: number; offerSavings: number; promoCode: string | null; promoDiscount: number; total: number; count?: number;
}) {
  const row = (l: string, v: string, color?: string) => (
    <View style={s.totRow}><Text style={[s.totLabel, color ? { color } : null]}>{l}</Text><Text style={[s.totVal, color ? { color } : null]}>{v}</Text></View>
  );
  return (
    <Card>
      {row(count ? `Subtotal (${count} item${count === 1 ? '' : 's'})` : 'Subtotal', etb(subtotal))}
      {offerSavings > 0 ? row('Product offer', `− ${etb(offerSavings)}`, c.green) : null}
      {promoCode ? row(`Promo code (${promoCode})`, `− ${etb(promoDiscount)}`, c.green) : null}
      <View style={s.totalBox}><Text style={s.totalLabel}>Total</Text><Text style={s.totalVal}>{etb(total)}</Text></View>
    </Card>
  );
}

export const Title = ({ children, sub }: { children: React.ReactNode; sub?: string }) => (
  <View style={{ marginVertical: 14 }}>
    <Text style={s.title}>{children}</Text>
    {sub ? <Text style={s.sub}>{sub}</Text> : null}
  </View>
);

export const Muted = ({ children, style }: { children: React.ReactNode; style?: object }) => <Text style={[{ color: c.muted, fontSize: 14 }, style]}>{children}</Text>;

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.bg },
  scroll: { padding: 16, paddingBottom: 32, flexGrow: 1 },
  footer: { padding: 16, paddingTop: 8, backgroundColor: c.bg, borderTopWidth: 1, borderTopColor: c.border, gap: 10 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoMark: { width: 38, height: 38, borderRadius: 10, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center' },
  logoR: { color: '#fff', fontWeight: '900', fontSize: 22 },
  logoWord: { color: c.navy, fontWeight: '900', fontSize: 24, lineHeight: 26 },
  logoSub: { color: c.muted, fontSize: 10 },
  cartBtn: { width: 48, height: 48, borderRadius: 14, borderWidth: 1, borderColor: c.border, backgroundColor: c.card, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -6, right: -6, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: c.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  btn: { minHeight: 54, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  btnOutline: { borderWidth: 1.5, borderColor: c.primary, backgroundColor: c.card },
  btnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  card: { backgroundColor: c.card, borderRadius: radius.lg, borderWidth: 1, borderColor: c.border, padding: 14, marginBottom: 12 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: radius.md, padding: 14, marginBottom: 12 },
  bannerTitle: { fontWeight: '700', fontSize: 16 },
  bannerBody: { color: c.navy, fontSize: 14, marginTop: 2 },
  thumb: { borderRadius: 14, backgroundColor: c.primarySoft, alignItems: 'center', justifyContent: 'center' },
  totRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  totLabel: { color: c.navy, fontSize: 15 },
  totVal: { color: c.navy, fontSize: 15, fontWeight: '700' },
  totalBox: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: c.bg, borderRadius: 12, padding: 12, marginTop: 8 },
  totalLabel: { color: c.navy, fontSize: 20, fontWeight: '800' },
  totalVal: { color: c.navy, fontSize: 22, fontWeight: '900' },
  title: { color: c.navy, fontSize: 28, fontWeight: '800', lineHeight: 34 },
  sub: { color: c.muted, fontSize: 16, marginTop: 6, lineHeight: 22 },
});
