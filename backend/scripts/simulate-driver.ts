// Drives a fake truck along a booking's route, emitting the same `presence:location`
// events the driver app sends. Used to watch live tracking end to end without needing a
// phone with real GPS.
//
// Usage: npx tsx scripts/simulate-driver.ts <bookingId> [driverPhone] [password]
import { io } from "socket.io-client";
import { prisma } from "../src/lib/prisma";
import { signAccessToken } from "../src/lib/jwt";
import { decodePolylineServer, bearing } from "./polyline-util";

const API = process.env.API_URL ?? "http://localhost:3001";
const STEP_MS = 2000;

async function main() {
  const bookingId = process.argv[2];
  if (!bookingId) throw new Error("usage: tsx scripts/simulate-driver.ts <bookingId>");

  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: bookingId } });
  if (!booking.driverId) throw new Error("Booking has no assigned driver yet.");
  if (!booking.routePolyline) throw new Error("Booking has no stored route.");

  const points = decodePolylineServer(booking.routePolyline);
  // Thin the route down so the truck moves a visible distance per tick rather than
  // crawling point to point.
  const stride = Math.max(1, Math.floor(points.length / 120));
  const path = points.filter((_, i) => i % stride === 0);

  const driver = await prisma.user.findUniqueOrThrow({ where: { id: booking.driverId } });
  const token = signAccessToken({ sub: driver.id, role: "DRIVER" });

  const socket = io(API, { path: "/socket.io", auth: { token }, transports: ["websocket"] });

  await new Promise<void>((resolve, reject) => {
    socket.on("connect", () => resolve());
    socket.on("connect_error", (e) => reject(e));
  });

  console.log(`connected as ${driver.fullName}; driving ${path.length} points`);
  socket.emit("trip:subscribe", bookingId);

  let i = 0;
  const timer = setInterval(async () => {
    if (i >= path.length - 1) {
      clearInterval(timer);
      socket.close();
      await prisma.$disconnect();
      console.log("route complete");
      process.exit(0);
    }

    const here = path[i];
    const next = path[i + 1];
    const heading = bearing(here, next);

    socket.emit("presence:location", {
      bookingId,
      lat: here.lat,
      lng: here.lng,
      heading,
      speed: 14,
    });

    // Mirror to the REST fallback so a client opening mid-trip still sees the truck.
    await prisma.driverProfile
      .update({
        where: { userId: driver.id },
        data: { currentLat: here.lat, currentLng: here.lng, locationAt: new Date() },
      })
      .catch(() => {});

    if (i % 10 === 0) {
      console.log(`  ${i}/${path.length}  ${here.lat.toFixed(4)},${here.lng.toFixed(4)}  hdg ${Math.round(heading)}`);
    }
    i++;
  }, STEP_MS);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
