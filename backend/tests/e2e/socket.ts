/**
 * Socket.IO test client.
 *
 * Every event is recorded via `onAny` from the moment the socket connects, which is what makes
 * the negative assertions possible — "the losing driver must NOT receive `bid:accepted`" needs
 * a complete log, not a listener registered after the fact and racing the emit.
 *
 * `waitFor` resolves from the log first and only then waits, so a test that acts and then
 * asserts cannot miss an event that arrived in between.
 */

import { io, type Socket } from "socket.io-client";
import { BASE_URL } from "./http";

export type Recorded = { event: string; payload: any; at: number };

export class TestSocket {
  readonly log: Recorded[] = [];
  private constructor(
    readonly label: string,
    private readonly socket: Socket,
  ) {}

  static async connect(label: string, token: string | undefined, timeoutMs = 20_000): Promise<TestSocket> {
    const socket = io(BASE_URL, {
      path: "/socket.io",
      auth: token === undefined ? {} : { token },
      transports: ["websocket"],
      reconnection: false,
      timeout: timeoutMs,
    });
    const wrapper = new TestSocket(label, socket);
    socket.onAny((event, payload) => wrapper.log.push({ event, payload, at: Date.now() }));

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`socket "${label}" connect timed out`)), timeoutMs);
      socket.once("connect", () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once("connect_error", (e: Error) => {
        clearTimeout(timer);
        reject(new Error(`socket "${label}" refused: ${e.message}`));
      });
    });
    return wrapper;
  }

  /** Asserts the handshake is refused. Resolves with the server's reason. */
  static async expectRefused(label: string, token: string | undefined, timeoutMs = 20_000): Promise<string> {
    const socket = io(BASE_URL, {
      path: "/socket.io",
      auth: token === undefined ? {} : { token },
      transports: ["websocket"],
      reconnection: false,
      timeout: timeoutMs,
    });
    try {
      return await new Promise<string>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`socket "${label}" neither connected nor errored`)), timeoutMs);
        socket.once("connect_error", (e: Error) => {
          clearTimeout(timer);
          resolve(e.message);
        });
        socket.once("connect", () => {
          clearTimeout(timer);
          reject(new Error(`socket "${label}" connected, but should have been refused`));
        });
      });
    } finally {
      socket.close();
    }
  }

  emit(event: string, payload?: unknown): void {
    this.socket.emit(event, payload);
  }

  /** Everything recorded for an event so far, oldest first. */
  received(event: string): any[] {
    return this.log.filter((r) => r.event === event).map((r) => r.payload);
  }

  /** Forget everything recorded so far, so the next assertion speaks only to what follows. */
  clear(): void {
    this.log.length = 0;
  }

  /**
   * Resolves with the first matching payload — checking what has already arrived before
   * waiting, so acting and then asserting is race-free.
   */
  async waitFor(event: string, match?: (payload: any) => boolean, timeoutMs = 12_000): Promise<any> {
    const already = this.log.find((r) => r.event === event && (!match || match(r.payload)));
    if (already) return already.payload;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.off(event, handler);
        const seen = [...new Set(this.log.map((r) => r.event))].join(", ") || "nothing";
        reject(new Error(`socket "${this.label}": no "${event}" within ${timeoutMs}ms (saw: ${seen})`));
      }, timeoutMs);

      const handler = (payload: any) => {
        if (match && !match(payload)) return;
        clearTimeout(timer);
        this.socket.off(event, handler);
        resolve(payload);
      };
      this.socket.on(event, handler);
    });
  }

  /**
   * Resolves only if the event does NOT arrive within the window. Used for every leakage and
   * exclusion assertion, so it has to actually wait — there is no way to prove a negative
   * faster than the window it is asserted over.
   */
  async expectSilence(event: string, windowMs = 6000, match?: (payload: any) => boolean): Promise<void> {
    const before = this.log.filter((r) => r.event === event && (!match || match(r.payload))).length;
    await new Promise((r) => setTimeout(r, windowMs));
    const after = this.log.filter((r) => r.event === event && (!match || match(r.payload)));
    if (after.length > before) {
      throw new Error(
        `socket "${this.label}": expected no "${event}", but got ${JSON.stringify(after[after.length - 1]).slice(0, 200)}`,
      );
    }
  }

  close(): void {
    this.socket.close();
  }
}

/** Joins a trip room the way both apps do, and gives the server a beat to process the join. */
export async function subscribeTrip(sock: TestSocket, bookingId: string): Promise<void> {
  sock.emit("trip:subscribe", bookingId);
  await new Promise((r) => setTimeout(r, 400));
}
