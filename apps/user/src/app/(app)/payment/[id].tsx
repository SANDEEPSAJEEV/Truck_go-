import { useCallback, useEffect, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, Modal, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Screen } from '@/components/screen';
import { AppText } from '@/components/app-text';
import { Button } from '@/components/ui/button';
import { Colors, Radii, Spacing } from '@/constants/theme';
import { apiFetch, ApiError } from '@/lib/api';
import { getSocket, subscribeToTrip } from '@/lib/socket';

type Booking = {
  id: string;
  reference: string;
  pickupAddress: string;
  dropAddress: string;
  distanceKm: number | null;
  estimatedFare: number;
  actualFare: number | null;
};

type OrderResponse = {
  paymentId: string;
  orderId: string;
  amount: number;
  currency: string;
  keyId: string;
  /** 'mock' until Razorpay keys are configured — see backend/src/lib/payments.ts. */
  provider: 'mock' | 'razorpay';
};

type PaymentStatus = 'NONE' | 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';

/**
 * Razorpay's own recommended path for Expo apps: their hosted checkout.js loaded inside a
 * WebView, rather than the native `react-native-razorpay` module — which lags behind React
 * Native's New Architecture. The page's only job is to open the widget and report back
 * which of its two outcomes fired; it never decides whether the payment succeeded. Only the
 * signed webhook (backend/src/routes/payments.routes.ts) is trusted for that.
 */
function checkoutHtml(order: OrderResponse, customerName: string): string {
  const options = {
    key: order.keyId,
    order_id: order.orderId,
    amount: order.amount * 100,
    currency: order.currency,
    name: 'TruckGo',
    description: 'Freight delivery payment',
    prefill: { name: customerName },
    theme: { color: '#001e40' },
  };
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f8f9ff;">
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  var options = ${JSON.stringify(options)};
  options.handler = function (response) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'success', response: response }));
  };
  options.modal = {
    ondismiss: function () {
      window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'dismissed' }));
    },
  };
  var rzp = new Razorpay(options);
  rzp.on('payment.failed', function (response) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ event: 'failed', response: response }));
  });
  rzp.open();
</script>
</body></html>`;
}

/**
 * Sits between delivery and feedback. The trip is not actually settled until this screen
 * confirms PAID — feedback comes after, never before.
 *
 * The gateway webhook is the only thing allowed to mark a payment PAID (see
 * backend/src/routes/payments.routes.ts). This screen never writes that state itself:
 * returning from checkout — real or mocked — only triggers a re-fetch of status.
 */
export default function Payment() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [order, setOrder] = useState<OrderResponse | null>(null);
  const [status, setStatus] = useState<PaymentStatus>('NONE');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checkoutVisible, setCheckoutVisible] = useState(false);

  const loadBooking = useCallback(() => {
    apiFetch<{ booking: Booking }>(`/bookings/${id}`)
      .then((d) => setBooking(d.booking))
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load this trip."));
  }, [id]);

  const refetchStatus = useCallback(() => {
    apiFetch<{ status: PaymentStatus }>(`/payments/${id}`)
      .then((d) => setStatus(d.status))
      .catch(() => {
        // Non-fatal — the create-order button still works even if this particular poll fails.
      });
  }, [id]);

  useEffect(() => {
    loadBooking();
    refetchStatus();
  }, [loadBooking, refetchStatus]);

  // The webhook pushes over the same private per-user socket room every other realtime
  // update in this app uses — no polling needed once a checkout is actually in flight.
  useEffect(() => {
    let cleanup = () => {};
    getSocket().then((socket) => {
      const leaveTrip = subscribeToTrip(socket, id);
      const onUpdate = (payload: { bookingId: string; status: string }) => {
        if (payload.bookingId === id) setStatus(payload.status as PaymentStatus);
      };
      socket.on('payment:update', onUpdate);
      cleanup = () => {
        leaveTrip();
        socket.off('payment:update', onUpdate);
      };
    });
    return () => cleanup();
  }, [id]);

  useEffect(() => {
    if (status === 'PAID') router.replace(`/(app)/feedback/${id}`);
  }, [status, id]);

  async function startPayment() {
    setBusy(true);
    setError('');
    try {
      const o = await apiFetch<OrderResponse>(`/payments/${id}/order`, { method: 'POST' });
      setOrder(o);

      if (o.provider === 'razorpay') {
        setCheckoutVisible(true);
      }
      // Mock mode has no real checkout to open — the "Simulate payment" button below
      // becomes visible once `order` is set instead.
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start payment. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function onCheckoutMessage(raw: string) {
    setCheckoutVisible(false);
    // Every branch here just re-checks status — the message tells us the widget closed
    // and why, never whether money actually moved. Only the webhook decides that.
    let parsed: { event?: string } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Malformed message from the page — fall through to a status refetch regardless.
    }
    if (parsed.event === 'failed') {
      setError('Payment failed. You can try again.');
    }
    refetchStatus();
  }

  async function simulatePayment() {
    setBusy(true);
    setError('');
    try {
      await apiFetch(`/payments/${id}/mock-complete`, { method: 'POST' });
      refetchStatus();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not complete the simulated payment.');
    } finally {
      setBusy(false);
    }
  }

  if (!booking) {
    return (
      <Screen style={styles.centered}>
        {error ? (
          <AppText variant="bodyLg" color="error" align="center">
            {error}
          </AppText>
        ) : (
          <ActivityIndicator color={Colors.primary} />
        )}
      </Screen>
    );
  }

  const fare = booking.actualFare ?? booking.estimatedFare;

  return (
    <Screen>
      <View style={styles.container}>
        <AppText variant="headlineLg">Complete Payment</AppText>
        <AppText variant="bodyLg" color="onSurfaceVariant">
          Shipment {booking.reference}
        </AppText>

        <View style={styles.card}>
          <Row label="From" value={booking.pickupAddress} />
          <Row label="To" value={booking.dropAddress} />
          {booking.distanceKm != null ? <Row label="Distance" value={`${booking.distanceKm} km`} /> : null}
          <View style={styles.divider} />
          <View style={styles.totalRow}>
            <AppText variant="headlineMd">Total Fare</AppText>
            <AppText variant="displayLg" color="primary">
              ₹{fare}
            </AppText>
          </View>
        </View>

        {status === 'PENDING' && order ? (
          <View style={styles.pendingBanner}>
            <ActivityIndicator color={Colors.primary} />
            <AppText variant="bodyMd" color="onSurfaceVariant">
              Waiting for payment confirmation…
            </AppText>
          </View>
        ) : null}

        {error ? (
          <AppText variant="bodySm" color="error" align="center">
            {error}
          </AppText>
        ) : null}

        {!order ? (
          <Button label={`Pay ₹${fare}`} onPress={startPayment} loading={busy} />
        ) : order.provider === 'mock' ? (
          <>
            <AppText variant="bodySm" color="onSurfaceVariant" align="center">
              No live payment gateway configured yet — this simulates what the real checkout
              would do once Razorpay keys are added.
            </AppText>
            <Button label="Simulate Payment" onPress={simulatePayment} loading={busy} />
          </>
        ) : (
          <Button label="Retry Payment" variant="outline" onPress={startPayment} loading={busy} />
        )}
      </View>

      {order?.provider === 'razorpay' ? (
        <Modal visible={checkoutVisible} animationType="slide" onRequestClose={() => setCheckoutVisible(false)}>
          <WebView
            source={{ html: checkoutHtml(order, booking.reference) }}
            onMessage={(e) => onCheckoutMessage(e.nativeEvent.data)}
            style={styles.webview}
          />
        </Modal>
      ) : null}
    </Screen>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <AppText variant="labelCaps" color="onSurfaceVariant" uppercase>
        {label}
      </AppText>
      <AppText variant="bodyLg" numberOfLines={2}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: Spacing.lg, gap: Spacing.lg },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
  card: {
    borderRadius: Radii.lg,
    borderWidth: 1,
    borderColor: Colors.outlineVariant,
    padding: Spacing.lg,
    gap: Spacing.md,
    backgroundColor: Colors.surface,
  },
  row: { gap: Spacing.xs },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.outlineVariant },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  webview: { flex: 1 },
  pendingBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radii.md,
    backgroundColor: Colors.surfaceContainer,
  },
});
