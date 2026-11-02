import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Text,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { api, ApiError } from "../api";
import { useCart } from "../cart";
import { useNav } from "../nav";
import type { ItemStatus, Order } from "../types";
import {
  Banner,
  Btn,
  Card,
  CheckCircleIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  InformationCircleIcon,
  Logo,
  Muted,
  Price,
  Screen,
  Thumb,
  Title,
  Totals,
  WifiIcon,
} from "../ui";
import { c, etb } from "../theme";

/**
 * One screen, many states. EVERYTHING shown here is derived from the order the backend returned.
 * The app never decides that a payment succeeded or an item was delivered.
 */
export default function OrderStatus({ orderId }: { orderId: number }) {
  const { reset } = useNav();
  const { clear } = useCart();
  const [order, setOrder] = useState<Order | null>(null);
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setOrder((await api.getOrder(orderId)).order);
      setOffline(false);
    } catch {
      setOffline(true);
    }
  }, [orderId]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 2000);
    return () => clearInterval(t);
  }, [refresh]);

  const home = () => {
    clear();
    reset({ name: "products" });
  };
  const retry = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setOrder((await api.pay(orderId)).order);
    } catch (e) {
      setProblem(
        e instanceof ApiError ? e.message : "Could not start a new payment.",
      );
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    try {
      await api.cancel(orderId);
      home();
    } catch (e) {
      setProblem(
        e instanceof ApiError ? e.message : "Could not cancel the order.",
      );
      setBusy(false);
    }
  };
  const help = (o: Order) =>
    Alert.alert(
      "Need help?",
      `Ask the machine operator for help and give them this reference:\n\n${o.reference}\nMachine ${o.machineId}`,
    );

  if (!order)
    return (
      <Screen>
        <View style={s.top}>
          <Logo />
        </View>
        <ActivityIndicator
          style={{ marginTop: 60 }}
          color={c.primary}
          size="large"
        />
        {offline ? (
          <Muted style={{ textAlign: "center", marginTop: 16 }}>
            Reconnecting…
          </Muted>
        ) : null}
      </Screen>
    );
  const o = order;
  const when = new Date(o.createdAt).toLocaleString();

  // ----- paid -----
  if (o.paymentStatus === "PAID") {
    if (o.dispenseStatus === "DELIVERED")
      return <Receipt o={o} when={when} onDone={home} />;
    if (["PARTIAL", "FAILED", "UNKNOWN"].includes(o.dispenseStatus)) {
      const title =
        o.dispenseStatus === "PARTIAL"
          ? "Part of your order wasn't delivered"
          : o.dispenseStatus === "FAILED"
            ? "Your order wasn't delivered"
            : "We couldn't confirm delivery";
      const body =
        o.dispenseStatus === "UNKNOWN"
          ? "Check the tray before asking for help. Please do not pay again."
          : "One or more items were not delivered. Please get help if you need assistance.";
      return (
        <Screen
          footer={
            <>
              <Btn label="Get help" onPress={() => help(o)} />
              <Btn label="Done" variant="outline" onPress={home} />
            </>
          }
        >
          <View style={s.top}>
            <Logo />
          </View>
          <Title sub={`Your payment of ${etb(o.total)} was received.`}>
            {title}
          </Title>
          <Items o={o} />
          <Banner
            tone="warn"
            icon={<ExclamationTriangleIcon size={22} color={c.amber} />}
            title={
              o.dispenseStatus === "UNKNOWN"
                ? "Delivery not confirmed"
                : "One or more items were not delivered."
            }
            body={body}
          />
          <Meta o={o} when={when} label="Support reference" />
        </Screen>
      );
    }
    return (
      <Screen>
        <View style={s.top}>
          <Logo />
        </View>
        <Title sub={`Order reference: ${o.reference}`}>
          Preparing your order
        </Title>
        <Banner tone="success" icon={<CheckCircleIcon size={22} color={c.green} />} title="Payment confirmed" />
        <Items o={o} />
        <Banner
          tone="info"
          icon={<InformationCircleIcon size={22} color={c.primary} />}
          title="Please wait before collecting."
          body="Items will be dispensed to the tray."
        />
        <Muted>Machine {o.machineId}</Muted>
      </Screen>
    );
  }

  // ----- payment unresolved -----
  if (o.paymentStatus === "UNKNOWN") {
    return (
      <Screen
        footer={<Btn label="Get help" variant="soft" onPress={() => help(o)} />}
      >
        <View style={s.top}>
          <Logo />
        </View>
        <Title sub="If you approved a payment, please don't pay again yet.">
          We're checking your payment.
        </Title>
        <Banner
          tone="info"
          icon={<WifiIcon size={22} color={c.primary} />}
          busy
          title={
            offline
              ? "Connection interrupted"
              : "Checking with the payment provider"
          }
          body={offline ? "Reconnecting…" : "This can take a few minutes."}
        />
        <Items o={o} />
        <Totals {...o} />
        <Meta o={o} when={when} />
      </Screen>
    );
  }

  // ----- payment failed / cancelled / never started -----
  if (["FAILED", "CANCELLED", "UNPAID"].includes(o.paymentStatus)) {
    const cancelled = o.paymentStatus === "CANCELLED";
    return (
      <Screen
        footer={
          <>
            <Btn label="Try payment again" onPress={retry} busy={busy} />
            <Btn
              label="Cancel order"
              variant="outline"
              onPress={cancel}
              disabled={busy}
            />
          </>
        }
      >
        <View style={s.top}>
          <Logo />
        </View>
        <Title
          sub={
            cancelled
              ? "You cancelled the payment."
              : "Your payment attempt was declined."
          }
        >
          {cancelled ? "Payment cancelled" : "Payment declined"}
        </Title>
        <Items o={o} />
        <Banner
          tone="error"
          icon={<ExclamationCircleIcon size={22} color={c.red} />}
          title="Your payment was not completed."
          body="You have not been charged for this attempt."
        />
        {problem ? <Banner tone="error" icon={<ExclamationTriangleIcon size={22} color={c.red} />} title={problem} /> : null}
        <Meta o={o} when={when} label="Order reference" />
      </Screen>
    );
  }

  // ----- pending: show the QR -----
  return (
    <Screen>
      <View style={s.top}>
        <Logo />
      </View>
      <Title sub="Scan the QR code with your phone to pay.">{`Pay for your order\n${etb(o.total)}`}</Title>
      <Card>
        <Row k="Merchant" v="SATEV Group" />
        <Row
          k="Items"
          v={`${o.items.reduce((n, i) => n + i.quantity, 0)} items`}
        />
        <Row k="Order reference" v={o.reference} />
        <View style={s.qr}>
          {o.checkoutUrl ? (
            <QRCode value={o.checkoutUrl} size={190} />
          ) : (
            <ActivityIndicator color={c.primary} size="large" />
          )}
        </View>
        {o.checkoutUrl ? null : (
          <Muted style={{ textAlign: "center" }}>Preparing your payment…</Muted>
        )}
      </Card>
      <Muted style={{ textAlign: "center", marginBottom: 12 }}>
        We confirm payment automatically.
      </Muted>
      <Banner
        tone="info"
        busy
        title={offline ? "Connection interrupted" : "Waiting for payment"}
        body={offline ? "Reconnecting…" : `Order #${o.reference}`}
      />
      {__DEV__ && o.checkoutUrl ? (
        <Btn
          label="DEV: open checkout page"
          variant="soft"
          onPress={() => Linking.openURL(o.checkoutUrl!)}
        />
      ) : null}
      <View style={{ height: 8 }} />
      <Btn label="Help" variant="soft" onPress={() => help(o)} />
    </Screen>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <View style={s.row}>
    <Muted>{k}</Muted>
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>
      {typeof v === "string" ? <Text style={s.rowV}>{v}</Text> : v}
    </View>
  </View>
);

function Meta({
  o,
  when,
  label = "Support reference",
}: {
  o: Order;
  when: string;
  label?: string;
}) {
  return (
    <Card>
      <Row k={label} v={o.reference} />
      <Row k="Date & time" v={when} />
      <Row k="Machine" v={o.machineId} />
      <Row k="Total" v={etb(o.total)} />
    </Card>
  );
}

const STATUS: Record<
  ItemStatus,
  { text: string; color: string; icon: React.ReactNode }
> = {
  DELIVERED: { text: "Delivered", color: c.green, icon: <CheckCircleIcon size={18} color={c.green} /> },
  FAILED: { text: "Not delivered", color: c.red, icon: <ExclamationCircleIcon size={18} color={c.red} /> },
  UNKNOWN: { text: "Not confirmed", color: c.amber, icon: <ExclamationTriangleIcon size={18} color={c.amber} /> },
  DISPENSING: { text: "Dispensing", color: c.primary, icon: "" },
  PENDING: { text: "Waiting", color: c.muted, icon: <InformationCircleIcon size={18} color={c.muted} /> },
};

function Items({ o }: { o: Order }) {
  const showStatus = o.paymentStatus === "PAID";
  return (
    <Card style={{ paddingVertical: 4 }}>
      {o.items.map((i, idx) => {
        const st = STATUS[i.status];
        return (
          <View
            key={i.productId}
            style={[
              s.item,
              idx > 0 && { borderTopWidth: 1, borderTopColor: c.border },
            ]}
          >
            <Thumb category={i.category} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={s.itemName}>
                {i.name}
                {i.quantity > 1 ? `  ×${i.quantity}` : ""}
              </Text>
              <Muted>{i.sizeLabel}</Muted>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              {showStatus ? (
                <View
                  style={{ alignItems: "center", flexDirection: "row", gap: 6 }}
                >
                  {i.status === "DISPENSING" ? (
                    <ActivityIndicator size="small" color={c.primary} />
                  ) : (
                    st.icon
                  )}
                  <Text style={{ color: st.color, fontWeight: "600" }}>
                    {i.delivered > 0 && i.delivered < i.quantity
                      ? `${i.delivered} delivered · ${i.quantity - i.delivered} not delivered`
                      : st.text}
                  </Text>
                </View>
              ) : (
                <Price
                  price={i.unitPrice * i.quantity}
                  list={i.listPrice * i.quantity}
                />
              )}
            </View>
          </View>
        );
      })}
    </Card>
  );
}

function Receipt({
  o,
  when,
  onDone,
}: {
  o: Order;
  when: string;
  onDone: () => void;
}) {
  return (
    <Screen footer={<Btn label="Done" onPress={onDone} />}>
      <View style={s.top}>
        <Logo />
      </View>
      <Title sub="Your items have been delivered.">Thank you!</Title>
      <Card>
        <Row k="Date & time" v={when} />
        <Row k="Machine" v={o.machineId} />
        <Row k="Order" v={o.reference} />
        <Row k="Payment status" v={<><CheckCircleIcon size={18} color={c.green} /><Text style={s.rowV}>Payment confirmed</Text></>} />
        <Row k="Delivery status" v={<><CheckCircleIcon size={18} color={c.green} /><Text style={s.rowV}>Delivery confirmed</Text></>} />
        <View style={s.hr} />
        {o.items.map((i) => (
          <View key={i.productId} style={s.item}>
            <Thumb category={i.category} size={44} />
            <View style={{ flex: 1 }}>
              <Text style={s.itemName}>
                {i.name}
                {i.quantity > 1 ? `  ×${i.quantity}` : ""}
              </Text>
              <Muted>{i.sizeLabel}</Muted>
            </View>
            <Price
              price={i.unitPrice * i.quantity}
              list={i.listPrice * i.quantity}
            />
          </View>
        ))}
        <View style={s.hr} />
        <Row k="Subtotal" v={etb(o.subtotal)} />
        {o.offerSavings > 0 ? (
          <Row k="You saved" v={`− ${etb(o.offerSavings)}`} />
        ) : null}
        {o.promoDiscount > 0 ? (
          <Row k={`Promo (${o.promoCode})`} v={`− ${etb(o.promoDiscount)}`} />
        ) : null}
        <View style={s.row}>
          <Text style={s.totalK}>Total paid</Text>
          <Text style={s.totalK}>{etb(o.total)}</Text>
        </View>
      </Card>
    </Screen>
  );
}

const s = StyleSheet.create({
  top: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
    gap: 12,
  },
  rowV: { color: c.navy, fontWeight: "700", flexShrink: 1, textAlign: "right" },
  qr: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 220,
    marginVertical: 8,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
  },
  itemName: { color: c.navy, fontWeight: "700", fontSize: 16 },
  hr: { height: 1, backgroundColor: c.border, marginVertical: 8 },
  totalK: { color: c.navy, fontSize: 18, fontWeight: "800" },
});
