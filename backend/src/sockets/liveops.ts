import { Server, Socket } from "socket.io";
import { verifyAccessToken } from "../lib/jwt";
import { prisma } from "../lib/prisma";

// Confirmed event names, reference/SCREENS-AND-REALTIME.md — read directly out of the
// decompiled bundle's socket subscription setup, not guessed. Room name `trip:<id>` is
// our own choice; the original's internal room naming isn't observable from the client.
//
// Not implemented yet (documented in reference/UNKNOWNS-AND-ASSUMPTIONS.md):
//   trip:eta          — needs a distance-remaining/ETA calculation we don't have
//   trip:signal_lost  — needs a stale-GPS watchdog
//   track:join         — original has a second, narrower join; merged into trip:subscribe here

/**
 * Who is allowed in a trip room.
 *
 * The handshake proves who the socket is; it says nothing about which trips are theirs. Without
 * this check any authenticated account could join `trip:<any id>` just by knowing or guessing
 * the booking id, and would then receive that trip's live driver GPS and every status change —
 * a stranger watching a truck move in real time. Booking ids are cuids and not enumerable, but
 * an id is not a secret: it appears in URLs, in support conversations, and in any client that
 * has ever legitimately held one.
 *
 * Cached briefly because a trip room is joined once per screen mount and re-joined on every
 * socket reconnect, and the answer only changes when a bid is accepted.
 */
const membershipCache = new Map<string, { at: number; ok: boolean }>();
const MEMBERSHIP_TTL_MS = 30_000;

async function mayAccessTrip(userId: string, bookingId: string): Promise<boolean> {
  if (typeof bookingId !== "string" || !bookingId) return false;

  const key = `${userId}:${bookingId}`;
  const cached = membershipCache.get(key);
  if (cached && Date.now() - cached.at < MEMBERSHIP_TTL_MS) return cached.ok;

  const booking = await prisma.booking
    .findUnique({ where: { id: bookingId }, select: { userId: true, driverId: true } })
    .catch(() => null);
  const ok = Boolean(booking && (booking.userId === userId || booking.driverId === userId));

  // Only a yes is cached. A no becomes a yes the moment the rider accepts that driver's bid,
  // and a driver left waiting 30s for their own trip room would miss the first status change.
  if (ok) membershipCache.set(key, { at: Date.now(), ok });
  return ok;
}

/** The driver actually carrying this trip — the only socket allowed to publish its position. */
async function isTripDriver(userId: string, bookingId: string): Promise<boolean> {
  if (typeof bookingId !== "string" || !bookingId) return false;
  const booking = await prisma.booking
    .findUnique({ where: { id: bookingId }, select: { driverId: true } })
    .catch(() => null);
  return Boolean(booking && booking.driverId === userId);
}

export function attachLiveops(io: Server) {
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error("unauthorized"));
    try {
      (socket.data as any).auth = verifyAccessToken(token);
      next();
    } catch {
      next(new Error("unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userId = (socket.data as any).auth.sub as string;

    // Every socket auto-joins its own user room so server code can push a private event
    // (like `trip:otp`) to one party without the shared trip room leaking it to both.
    socket.join(`user:${userId}`);

    // Which rooms this client currently wants to be in.
    //
    // The authorization check made `trip:subscribe` asynchronous, and that opened a race:
    // subscribe starts a database lookup, unsubscribe arrives and leaves a room the socket
    // has not joined yet, then the lookup finishes and joins it anyway. The socket ends up
    // in a room it explicitly asked to leave — a rider who closed the tracking screen would
    // carry on receiving that trip's live position.
    const wanted = new Set<string>();

    socket.on("trip:subscribe", async (bookingId: string) => {
      if (typeof bookingId !== "string" || !bookingId) return;
      wanted.add(bookingId);

      if (!(await mayAccessTrip(userId, bookingId))) {
        wanted.delete(bookingId);
        // Told, rather than silently ignored: a client whose join was refused should stop
        // waiting for events that are never coming.
        socket.emit("trip:subscribe:denied", { bookingId });
        return;
      }

      // Re-checked after the await: the client may have unsubscribed while we were asking.
      if (!wanted.has(bookingId)) return;
      socket.join(`trip:${bookingId}`);
    });

    socket.on("trip:unsubscribe", (bookingId: string) => {
      if (typeof bookingId !== "string" || !bookingId) return;
      wanted.delete(bookingId);
      socket.leave(`trip:${bookingId}`);
    });

    // Driver publishes GPS here; everyone else in the room gets `trip:location`.
    // Also mirrored to PUT /drivers/location for when a socket connection isn't live.
    // `heading` and `speed` ride along so the receiving map can rotate the truck marker to
    // its direction of travel rather than showing a fixed-orientation dot.
    //
    // Only the assigned driver may publish. Relaying this from anyone would let a third party
    // paint a false position onto the rider's map — the rider has no way to tell a forged fix
    // from a real one, and the map is exactly what they are trusting.
    socket.on(
      "presence:location",
      async (payload: { bookingId: string; lat: number; lng: number; heading?: number; speed?: number }) => {
        if (!payload || typeof payload.lat !== "number" || typeof payload.lng !== "number") return;
        if (!(await isTripDriver(userId, payload.bookingId))) return;

        socket.to(`trip:${payload.bookingId}`).emit("trip:location", {
          lat: payload.lat,
          lng: payload.lng,
          heading: payload.heading,
          speed: payload.speed,
          ts: new Date().toISOString(),
        });
      },
    );

    // Trip chat lives entirely on the REST endpoints (GET/POST /trips/:id/messages), which
    // authorize the caller and persist the message before broadcasting it. The socket relays
    // that used to sit here did neither: they forwarded whatever they were handed into any
    // trip room, and emitted `chat:message` with a different payload shape from the REST
    // path's, so a client could not have handled both. No client ever emitted them.
  });
}
