import { Server, Socket } from "socket.io";
import { verifyAccessToken } from "../lib/jwt";

// Confirmed event names, reference/SCREENS-AND-REALTIME.md — read directly out of the
// decompiled bundle's socket subscription setup, not guessed. Room name `trip:<id>` is
// our own choice; the original's internal room naming isn't observable from the client.
//
// Not implemented yet (documented in reference/UNKNOWNS-AND-ASSUMPTIONS.md):
//   trip:eta          — needs a distance-remaining/ETA calculation we don't have
//   trip:signal_lost  — needs a stale-GPS watchdog
//   track:join         — original has a second, narrower join; merged into trip:subscribe here
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
    // Every socket auto-joins its own user room so server code can push a private event
    // (like `trip:otp`) to one party without the shared trip room leaking it to both.
    socket.join(`user:${(socket.data as any).auth.sub}`);

    socket.on("trip:subscribe", (bookingId: string) => {
      socket.join(`trip:${bookingId}`);
    });

    socket.on("trip:unsubscribe", (bookingId: string) => {
      socket.leave(`trip:${bookingId}`);
    });

    // Driver publishes GPS here; everyone else in the room gets `trip:location`.
    // Also mirrored to PUT /drivers/location for when a socket connection isn't live.
    // `heading` and `speed` ride along so the receiving map can rotate the truck marker to
    // its direction of travel rather than showing a fixed-orientation dot.
    socket.on(
      "presence:location",
      (payload: { bookingId: string; lat: number; lng: number; heading?: number; speed?: number }) => {
        socket.to(`trip:${payload.bookingId}`).emit("trip:location", {
          lat: payload.lat,
          lng: payload.lng,
          heading: payload.heading,
          speed: payload.speed,
          ts: new Date().toISOString(),
        });
      },
    );

    // Trip chat.
    socket.on("chat:send", (payload: { bookingId: string; text: string }) => {
      socket.to(`trip:${payload.bookingId}`).emit("chat:message", payload);
    });
    socket.on("chat:typing", (payload: { bookingId: string }) => {
      socket.to(`trip:${payload.bookingId}`).emit("chat:typing", payload);
    });
    socket.on("chat:read", (payload: { bookingId: string }) => {
      socket.to(`trip:${payload.bookingId}`).emit("chat:read", payload);
    });
  });
}
