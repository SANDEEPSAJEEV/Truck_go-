import { io, type Socket } from 'socket.io-client';
import { getAccessToken, API_URL } from '@/lib/api';
import { DEMO_MODE, demoSocket } from '@/lib/demo';

let socket: Socket | null = null;

/**
 * Rebuilds the client with a fresh token whenever the handshake is rejected.
 *
 * The server verifies the access token on connect, and access tokens last 15 minutes. A
 * socket that drops after that — a tunnel, a lift, a screen lock — reconnects with the token
 * it was constructed with, is refused, and stays dead. Nothing surfaces: live tracking simply
 * stops updating and the map quietly freezes on the last known position.
 *
 * `getAccessToken()` returns whatever `apiFetch` last refreshed, so re-reading it here is
 * enough to recover.
 */
function attachAuthRecovery(client: Socket): void {
  let recovering = false;
  client.on('connect_error', async (err: Error) => {
    if (!err?.message?.includes('unauthorized') || recovering) return;
    recovering = true;
    try {
      const fresh = await getAccessToken();
      if (fresh) {
        client.auth = { token: fresh };
        client.connect();
      }
    } finally {
      recovering = false;
    }
  });
}

export async function getSocket(): Promise<Socket> {
  // Demo mode swaps in a local emitter so trip status changes propagate with no server.
  if (DEMO_MODE) return demoSocket as unknown as Socket;

  if (socket?.connected) return socket;
  const token = await getAccessToken();
  socket = io(API_URL, { path: '/socket.io', auth: { token }, transports: ['websocket'] });
  attachAuthRecovery(socket);
  return socket;
}

/**
 * Joins a trip's room and stays in it.
 *
 * Rooms live on the server against a specific socket id, and a reconnect produces a new
 * one — so a single `emit` at mount silently stops working after the first network blip,
 * and live tracking dies with no error anywhere. Re-emitting on every `connect` is what
 * makes the subscription survive reconnects.
 *
 * Returns an unsubscribe function for the caller's effect cleanup.
 */
export function subscribeToTrip(socket: Socket, bookingId: string): () => void {
  const join = () => socket.emit('trip:subscribe', bookingId);

  // Emit now if already connected; socket.io also buffers this when still connecting.
  join();
  socket.on('connect', join);

  return () => {
    socket.off('connect', join);
    socket.emit('trip:unsubscribe', bookingId);
  };
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
