import { prisma } from "./prisma";

// Push delivery sits behind an interface for the same reason SMS and KYC do: the whole
// dispatch path has to be buildable and testable before any credential exists.
//
// Expo's push service is the transport. Note that the FCM key lives in EAS credentials,
// not here — Expo signs for us — so this module needs no secret to start working. What it
// needs is a client that has actually obtained a token, which requires a real device.

export type PushMessage = {
  to: string;
  title: string;
  body: string;
  /** Arrives in the client's notification handler; used to deep-link to the booking. */
  data?: Record<string, unknown>;
  /** Android channel id. Must match one the client created, or importance is ignored. */
  channelId?: string;
};

export interface PushProvider {
  readonly name: string;
  send(messages: PushMessage[]): Promise<void>;
}

/** Logs instead of sending. Lets the whole dispatch flow be exercised with no device. */
export class MockPushProvider implements PushProvider {
  readonly name = "mock";

  async send(messages: PushMessage[]): Promise<void> {
    for (const m of messages) {
      console.log(`[push:mock] -> ${m.to}: ${m.title} — ${m.body}`);
    }
  }
}

const EXPO_ENDPOINT = "https://exp.host/--/api/v2/push/send";
/** Expo rejects payloads above 100 messages. */
const CHUNK = 100;

export class ExpoPushProvider implements PushProvider {
  readonly name = "expo";

  async send(messages: PushMessage[]): Promise<void> {
    for (let i = 0; i < messages.length; i += CHUNK) {
      const batch = messages.slice(i, i + CHUNK);
      try {
        const res = await fetch(EXPO_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "Accept-Encoding": "gzip, deflate",
          },
          body: JSON.stringify(
            batch.map((m) => ({
              to: m.to,
              title: m.title,
              body: m.body,
              data: m.data ?? {},
              sound: "default",
              // Heads-up on Android and immediate delivery on iOS. A new load is worthless
              // if it arrives batched twenty minutes later.
              priority: "high",
              channelId: m.channelId ?? "loads",
            })),
          ),
        });

        const json = (await res.json().catch(() => null)) as
          | { data?: { status: string; message?: string; details?: { error?: string } }[] }
          | null;

        if (!res.ok || !json?.data) {
          console.error(`[push:expo] send failed (${res.status})`);
          continue;
        }

        // Expo reports per-message outcomes positionally.
        const dead: string[] = [];
        json.data.forEach((ticket, idx) => {
          if (ticket.status === "error") {
            const token = batch[idx]?.to;
            console.error(`[push:expo] ${token}: ${ticket.message ?? "unknown error"}`);
            // The app was uninstalled or the token rotated. Keeping it means retrying a
            // dead address on every future dispatch, forever.
            if (ticket.details?.error === "DeviceNotRegistered" && token) dead.push(token);
          }
        });

        if (dead.length) {
          await prisma.device
            .deleteMany({ where: { expoPushToken: { in: dead } } })
            .catch((e) => console.error("[push:expo] could not prune dead tokens", e));
        }
      } catch (e) {
        // A push that fails must never take down the request that triggered it — the
        // booking is already created, and the socket path still reached anyone online.
        console.error("[push:expo] request threw", e);
      }
    }
  }
}

let provider: PushProvider | null = null;

export function getPushProvider(): PushProvider {
  if (provider) return provider;
  // Expo's endpoint needs no server-side secret, so the real provider is safe to use
  // whenever we're not explicitly asked to stay silent. `PUSH_PROVIDER=mock` keeps local
  // development from firing real notifications at a real phone.
  provider =
    process.env.PUSH_PROVIDER === "mock" || process.env.NODE_ENV === "test"
      ? new MockPushProvider()
      : new ExpoPushProvider();
  return provider;
}

/** Test seam — lets a suite swap in a spy without reaching through the module cache. */
export function setPushProvider(next: PushProvider | null): void {
  provider = next;
}
