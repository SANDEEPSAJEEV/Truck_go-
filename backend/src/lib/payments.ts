import crypto from "crypto";

// Payment sits behind a provider interface for the same reason SMS, KYC and routing do: the
// whole flow — order creation, the rider's screen, the webhook, the driver's payment-status
// line — has to be buildable and testable before a Razorpay account exists. Swapping in real
// keys later touches this file and nothing else.

export type CreatedOrder = {
  orderId: string;
  amount: number;
  currency: string;
  /** The gateway's own publishable key, handed to the client's checkout widget. Never the
   * secret — that never leaves this file. */
  publicKeyId: string;
};

export interface PaymentProvider {
  readonly name: string;
  createOrder(amount: number, currency: string, receipt: string): Promise<CreatedOrder>;
  /** Verifies a webhook's signature against the raw request body. Must run on the raw bytes,
   * not a re-serialised JSON.stringify — a single re-ordered key changes the HMAC. */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;
  /** Pulls the fields the webhook route needs out of a verified payload, independent of
   * Razorpay's specific event-envelope shape. */
  parseWebhookEvent(payload: any): { orderId: string; paymentId: string; status: "paid" | "failed" } | null;
}

/**
 * Deterministic stand-in for local development and demos. There is no real checkout page to
 * redirect to, so the rider's screen gets a "Simulate payment" affordance instead of a
 * Razorpay WebView — see the mock-complete route, gated to only exist when this provider is
 * active.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = "mock";

  async createOrder(amount: number, currency: string, receipt: string): Promise<CreatedOrder> {
    return {
      orderId: `mock_order_${crypto.randomBytes(8).toString("hex")}`,
      amount,
      currency,
      publicKeyId: "mock_key_id",
    };
  }

  verifyWebhookSignature(): boolean {
    // The mock path never receives a real webhook — completion happens via the dev-only
    // mock-complete route instead, which is direct proof intent came from this server.
    return true;
  }

  parseWebhookEvent(): null {
    return null;
  }
}

/**
 * Razorpay via server-side REST calls — no SDK dependency, consistent with how routing and
 * places call Google directly. Order creation and signature verification are the two places
 * money actually changes state, so both stay entirely server-side; the client only ever sees
 * a publishable key and an order id.
 */
export class RazorpayPaymentProvider implements PaymentProvider {
  readonly name = "razorpay";

  constructor(
    private readonly keyId: string,
    private readonly keySecret: string,
    private readonly webhookSecret: string,
  ) {}

  async createOrder(amount: number, currency: string, receipt: string): Promise<CreatedOrder> {
    const auth = Buffer.from(`${this.keyId}:${this.keySecret}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` },
      body: JSON.stringify({
        // Razorpay takes amount in the smallest currency unit — paise, not rupees.
        amount: Math.round(amount * 100),
        currency,
        receipt,
      }),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data?.id) {
      throw new Error(`Razorpay order creation failed: ${data?.error?.description ?? res.status}`);
    }
    return { orderId: data.id, amount, currency, publicKeyId: this.keyId };
  }

  /**
   * Razorpay signs the exact raw request body with HMAC-SHA256 under the webhook secret
   * (configured separately from the API secret, in the dashboard). Comparing against a
   * re-parsed-then-re-stringified body is a classic way to make this check pass when it
   * shouldn't — key order or whitespace differs and the signature no longer matches what was
   * actually sent, silently weakening the check rather than failing it.
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    if (!signatureHeader) return false;
    const expected = crypto.createHmac("sha256", this.webhookSecret).update(rawBody).digest("hex");
    // Timing-safe: a booking's payment status must not be discoverable by measuring how
    // long a signature comparison takes.
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhookEvent(payload: any): { orderId: string; paymentId: string; status: "paid" | "failed" } | null {
    const entity = payload?.payload?.payment?.entity;
    if (!entity?.order_id || !entity?.id) return null;
    if (payload.event === "payment.captured") return { orderId: entity.order_id, paymentId: entity.id, status: "paid" };
    if (payload.event === "payment.failed") return { orderId: entity.order_id, paymentId: entity.id, status: "failed" };
    return null;
  }
}

let provider: PaymentProvider | null = null;

export function getPaymentProvider(): PaymentProvider {
  if (provider) return provider;

  const { RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, NODE_ENV } = process.env;
  if (RAZORPAY_KEY_ID && RAZORPAY_KEY_SECRET && RAZORPAY_WEBHOOK_SECRET) {
    provider = new RazorpayPaymentProvider(RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET);
  } else {
    if (NODE_ENV === "production") {
      // Taking real payments through a mock would mean silently never collecting money —
      // the app would look fully functional while every rider's payment goes nowhere.
      throw new Error("No payment provider configured. Set RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET.");
    }
    provider = new MockPaymentProvider();
  }
  return provider;
}
