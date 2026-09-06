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

/**
 * Twilio, over its international gateway.
 *
 * The point of this one is timing, not economics: it is roughly twenty times MSG91's price
 * per Indian message, but it needs no DLT registration, so it can send a real code today
 * instead of in a week. Twilio's own India guidelines are explicit that the international
 * gateway bypasses DLT and the DND database, while the domestic gateway does not — this
 * class deliberately uses the former.
 *
 * Two things to know before pointing real drivers at it. Indian operators increasingly
 * filter international A2P traffic, so delivery is good but not guaranteed; and the sender
 * is an unknown international number rather than a branded header. Both are reasons this is
 * the bridge and MSG91 is the destination.
 */
export class TwilioProvider implements SmsProvider {
  readonly name = "twilio";

  constructor(
    private readonly accountSid: string,
    private readonly authToken: string,
    /** An E.164 number you own, or a Messaging Service SID (`MG...`). */
    private readonly from: string,
  ) {}

  async send(phone: string, message: string): Promise<void> {
    const body = new URLSearchParams({ To: toE164(phone), Body: message });
    // A Messaging Service handles sender selection and failover; a bare number does not.
    // Twilio distinguishes them by parameter name, not by value.
    body.set(this.from.startsWith("MG") ? "MessagingServiceSid" : "From", this.from);

    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.accountSid)}/Messages.json`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      },
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      // Never the message body — it carries the code, and this string reaches the logs.
      //
      // 21608 is worth calling out by name: on a trial account Twilio refuses any number you
      // have not verified, and the raw error does not make that obvious. It is the single
      // most likely reason a first real send appears to fail.
      const hint = text.includes("21608")
        ? " — Twilio trial accounts only send to numbers verified in Console → Verified Caller IDs"
        : "";
      throw new Error(`Twilio send failed (${res.status})${hint}: ${text.slice(0, 200)}`);
    }
  }
}

/** Twilio requires E.164. Bare 10-digit input is Indian by assumption, same as MSG91's path. */
function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  return `+${digits}`;
}

let provider: SmsProvider | null = null;

export function getSmsProvider(): SmsProvider {
  if (provider) return provider;

  const {
    MSG91_AUTH_KEY,
    MSG91_SENDER_ID,
    MSG91_DLT_TEMPLATE_ID,
    TWILIO_ACCOUNT_SID,
    TWILIO_AUTH_TOKEN,
    TWILIO_FROM,
    NODE_ENV,
  } = process.env;

  // MSG91 wins when both are configured: once DLT clears it is cheaper and sends under your
  // own branded header, so moving off the Twilio bridge is a matter of adding three
  // variables rather than removing three.
  if (MSG91_AUTH_KEY && MSG91_SENDER_ID && MSG91_DLT_TEMPLATE_ID) {
    provider = new Msg91Provider(MSG91_AUTH_KEY, MSG91_SENDER_ID, MSG91_DLT_TEMPLATE_ID);
  } else if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM) {
    provider = new TwilioProvider(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM);
  } else {
    if (NODE_ENV === "production" && process.env.ALLOW_MOCK_PROVIDERS !== "1") {
      // Silently falling back to a logger in production would mean no user could ever
      // receive a code, and the failure would be invisible until someone complained.
      throw new Error(
        "No SMS provider configured. Set MSG91_AUTH_KEY, MSG91_SENDER_ID and MSG91_DLT_TEMPLATE_ID, " +
          "or TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM.",
      );
    }
    if (NODE_ENV === "production") {
      // Deliberate escape hatch for a staging deployment that has to work before DLT
      // registration clears (a multi-day government process). It stays loud on purpose:
      // the danger was never mocking, it was mocking without anyone realising.
      console.warn(
        "[sms] ALLOW_MOCK_PROVIDERS=1 — codes are written to these logs and NOT sent by SMS. " +
          "Never leave this set on a deployment real users can reach.",
      );
    }
    provider = new MockSmsProvider();
  }

  return provider;
}
