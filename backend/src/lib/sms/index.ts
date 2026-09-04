// SMS delivery sits behind an interface so the whole OTP flow is buildable and testable
// before any vendor account exists, and swapping vendors later touches only this folder.
//
// MSG91 is the configured production provider: for Indian traffic it runs roughly
// ₹0.15–0.25/SMS against Twilio's ~₹0.45–0.63, and it offers assisted DLT compliance.
// Note that sending ANY transactional SMS in India requires DLT registration first —
// that is a government process measured in days, which is why the mock exists.

export interface SmsProvider {
  readonly name: string;
  send(phone: string, message: string): Promise<void>;
}

/** Logs instead of sending. Used in dev and tests; never selected in production. */
export class MockSmsProvider implements SmsProvider {
  readonly name = "mock";

  async send(phone: string, message: string): Promise<void> {
    console.log(`[sms:mock] -> ${phone}: ${message}`);
  }
}

export class Msg91Provider implements SmsProvider {
  readonly name = "msg91";

  constructor(
    private readonly authKey: string,
    private readonly senderId: string,
    private readonly dltTemplateId: string,
  ) {}

  async send(phone: string, message: string): Promise<void> {
    const res = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: { "Content-Type": "application/json", authkey: this.authKey },
      body: JSON.stringify({
        template_id: this.dltTemplateId,
        sender: this.senderId,
        short_url: "0",
        recipients: [{ mobiles: normalizeForMsg91(phone), message }],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Deliberately does not include the message body — OTP codes must never reach logs.
      throw new Error(`MSG91 send failed (${res.status}): ${body.slice(0, 200)}`);
    }
  }
}

/** MSG91 wants a country-coded number with no `+`. Defaults to India when none is given. */
function normalizeForMsg91(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 ? `91${digits}` : digits;
}

let provider: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (provider) return provider;

  const { MSG91_AUTH_KEY, MSG91_SENDER_ID, MSG91_DLT_TEMPLATE_ID, NODE_ENV } = process.env;

  if (MSG91_AUTH_KEY && MSG91_SENDER_ID && MSG91_DLT_TEMPLATE_ID) {
    provider = new Msg91Provider(MSG91_AUTH_KEY, MSG91_SENDER_ID, MSG91_DLT_TEMPLATE_ID);
  } else {
    if (NODE_ENV === "production") {
      // Silently falling back to a logger in production would mean no user could ever
      // receive a code, and the failure would be invisible until someone complained.
      throw new Error(
        "No SMS provider configured. Set MSG91_AUTH_KEY, MSG91_SENDER_ID and MSG91_DLT_TEMPLATE_ID.",
      );
    }
    provider = new MockSmsProvider();
  }

  return provider;
}
