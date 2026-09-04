// Connects as the booking's rider and prints every trip event, to isolate whether the
// server is broadcasting correctly when a client's map doesn't move.
// Usage: npx tsx scripts/listen-rider.ts <bookingId>
import { io } from "socket.io-client";
import { prisma } from "../src/lib/prisma";
import { signAccessToken } from "../src/lib/jwt";

const API = process.env.API_URL ?? "http://localhost:3001";

async function main() {
  const bookingId = process.argv[2];
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  const token = signAccessToken({ sub: booking.userId, role: "USER" });

  const socket = io(API, { path: "/socket.io", auth: { token }, transports: ["websocket"] });

  socket.on("connect", () => {
    console.log("rider socket connected:", socket.id);
    socket.emit("trip:subscribe", bookingId);
    console.log("subscribed to trip:", bookingId);
  });
  socket.on("connect_error", (e) => console.error("connect_error:", e.message));
  socket.on("trip:location", (p) => console.log("trip:location ->", JSON.stringify(p)));
  socket.on("trip:status", (p) => console.log("trip:status ->", JSON.stringify(p)));
  socket.on("trip:otp", (p) => console.log("trip:otp ->", JSON.stringify(p)));

  setTimeout(async () => {
    socket.close();
    await prisma.$disconnect();
    process.exit(0);
  }, 15000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
