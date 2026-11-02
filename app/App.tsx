import React, { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { api } from './src/api';
import { CartProvider, useCart } from './src/cart';
import { NavProvider, useNav } from './src/nav';
import { SessionProvider, useSession } from './src/session';
import Admin from './src/screens/Admin';
import { CartScreen, ReviewScreen } from './src/screens/Cart';
import Details from './src/screens/Details';
import Login from './src/screens/Login';
import OrderStatus from './src/screens/OrderStatus';
import Products from './src/screens/Products';
import { Btn, Screen, Title } from './src/ui';
import { c } from './src/theme';

export default function App() {
  return (
    <SessionProvider>
      <CartProvider>
        <Root />
      </CartProvider>
    </SessionProvider>
  );
}

function Root() {
  const { user, ready } = useSession();
  const { clear } = useCart();
  useEffect(() => { if (!user) clear(); }, [user, clear]); // never leave one session's cart for the next

  if (!ready) return <View style={{ flex: 1, justifyContent: 'center', backgroundColor: c.bg }}><ActivityIndicator size="large" color={c.primary} /></View>;
  if (!user) return <Login />;
  // keyed by user so a new sign-in always starts from a clean navigation stack
  return (
    <NavProvider key={user.id} initial={user.role === 'admin' ? { name: 'admin' } : { name: 'products' }}>
      <Router />
    </NavProvider>
  );
}

/** Frontend role gate. The backend enforces the same rules on every route; this only keeps the UI honest. */
function Router() {
  const { user, signOut } = useSession();
  const { route, reset } = useNav();

  // After an app restart, go straight back to an unresolved order so a payment is never lost track of.
  useEffect(() => {
    if (user?.role !== 'staff') return;
    api.activeOrder().then((r) => { if (r.order) reset({ name: 'order', orderId: r.order.id }); }).catch(() => {});
  }, [user, reset]);

  const isAdminRoute = route.name === 'admin';
  if ((isAdminRoute && user?.role !== 'admin') || (!isAdminRoute && user?.role !== 'staff')) {
    return <Screen><Title sub="This account cannot open this screen.">Not allowed</Title><Btn label="Sign out" onPress={signOut} /><Text /></Screen>;
  }

  switch (route.name) {
    case 'admin': return <Admin />;
    case 'products': return <Products />;
    case 'details': return <Details productId={route.productId} />;
    case 'cart': return <CartScreen />;
    case 'review': return <ReviewScreen promoCode={route.promoCode} />;
    case 'order': return <OrderStatus key={route.orderId} orderId={route.orderId} />;
  }
}
