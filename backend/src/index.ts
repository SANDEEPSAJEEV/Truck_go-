import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "http";
import { Server } from "socket.io";

import { generalLimiter } from "./middleware/rate-limit";

import { authRouter } from "./routes/auth.routes";
import { bookingsRouter } from "./routes/bookings.routes";
import { tripsRouter } from "./routes/trips.routes";
import { driversRouter } from "./routes/drivers.routes";
import { usersRouter } from "./routes/users.routes";
import { ratingsRouter } from "./routes/ratings.routes";
import { notificationsRouter } from "./routes/notifications.routes";
import { documentsRouter } from "./routes/documents.routes";
import { adminRouter } from "./routes/admin.routes";
import { placesRouter } from "./routes/places.routes";
import { paymentsRouter, handlePaymentsWebhook } from "./routes/payments.routes";
import { devicesRouter } from "./routes/devices.routes";
import { dispatchBooking, RADIUS_LADDER_KM } from "./lib/dispatch";
import { prisma } from "./lib/prisma";
import { expireLapsedDocuments } from "./lib/verification";
import { attachLiveops } from "./sockets/liveops";
import { setIo } from "./sockets/io";

// `cors()` was previously wide open, so any website a user visited could call this API with
// their browser session. Native apps send no Origin header, so they are unaffected by the
// allowlist; only browsers are constrained by it.
const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const corsOptions: cors.CorsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true); // native apps, curl, server-to-server
    if (allowedOrigins.length === 0 && process.env.NODE_ENV !== "production") {
      return callback(null, true); // local dev convenience: Expo web on a random port
    }
    return allowedOrigins.includes(origin)
      ? callback(null, true)
      : callback(new Error(`Origin ${origin} is not allowed`));
  },
  credentials: true,
};

const app = express();
// Trust the first proxy hop so rate limiting keys on the real client IP rather than the
// load balancer's, which would otherwise lump every user into a single bucket.
app.set("trust proxy", 1);
app.use(helmet());
app.use(cors(corsOptions));

// Mounted on the raw body, BEFORE express.json() below. The gateway signs the exact bytes
// it sent; parsing to JSON first and re-serialising to verify would check a signature
// against data that no longer matches what was actually transmitted.
app.post("/payments/webhook", express.raw({ type: "application/json", limit: "1mb" }), handlePaymentsWebhook);

app.use(express.json({ limit: "1mb" }));
app.use(generalLimiter);

// `commit` answers the question every deploy raises: is the code I just pushed the code that
// is actually running? Without it, a test run against a stale deployment reports fixed bugs as
// still broken and there is no way to tell that from a real regression. Render sets
// RENDER_GIT_COMMIT on the builder; it is a public commit SHA, not a secret.
app.get("/health", (_req, res) =>
  res.json({ ok: true, commit: process.env.RENDER_GIT_COMMIT?.slice(0, 7) ?? "local" }),
);

app.use("/auth", authRouter);
// Confirmed as two separate service surfaces in the original — /bookings owns pre-trip
// lifecycle, /trips owns the active-trip surface (status advance, OTP, live tracking).
app.use("/bookings", bookingsRouter);
app.use("/trips", tripsRouter);
// Mounted before /drivers so the KYC surface owns its own middleware chain (multipart
// uploads, driver-only) without loosening anything on the profile routes.
app.use("/drivers/documents", documentsRouter);
app.use("/drivers", driversRouter);
app.use("/admin", adminRouter);
app.use("/places", placesRouter);
// The webhook itself is mounted above, on raw body, ahead of express.json() — this is the
// rest of the payments surface (order creation, status polling, mock-complete).
app.use("/payments", paymentsRouter);
app.use("/users", usersRouter);
app.use("/ratings", ratingsRouter);
app.use("/notifications", notificationsRouter);
app.use("/devices", devicesRouter);

app.use((_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found" } });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong" } });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: allowedOrigins.length > 0 ? allowedOrigins : true, credentials: true },
  path: "/socket.io",
});
setIo(io);
attachLiveops(io);

// Compliance is not a one-time check: a driver approved last year whose insurance lapsed
// this morning must stop being dispatchable without anyone noticing manually.
const EXPIRY_SWEEP_MS = 6 * 3600_000;
async function sweepExpiredDocuments() {
  try {
    const count = await expireLapsedDocuments();
    if (count > 0) console.log(`[verification] expired ${count} document(s)`);
  } catch (e) {
    console.error("[verification] expiry sweep failed:", e);
  }
}

// A booking nobody bids on shouldn't just sit there. Rather than blasting every driver in
// the state at creation time, dispatch starts tight and widens — so the nearest drivers
// get first refusal and the notification only reaches further out if it has to.
const REDISPATCH_SWEEP_MS = 60_000;
/** How long a booking waits at one radius before the net widens. */
const WIDEN_AFTER_MS = 90_000;

async function sweepUnbidBookings() {
  try {
    const now = Date.now();
    const stale = await prisma.booking.findMany({
      where: {
        status: "AWAITING_BIDS",
        createdAt: { lte: new Date(now - WIDEN_AFTER_MS) },
        // No *live* offer, rather than no bid row at all. Withdrawing a bid marks it
        // WITHDRAWN and leaves the row behind, so `none: {}` would strand a booking whose
        // only interested driver later backed out — it would sit at the opening radius
        // forever with nobody actually bidding on it.
        bids: { none: { status: "PENDING" } },
      },
      take: 50,
    });

    for (const booking of stale) {
      const age = now - booking.createdAt.getTime();
      // Which rung the age puts us on: 1 after the first wait, 2 after the second.
      const tier = Math.min(Math.floor(age / WIDEN_AFTER_MS), RADIUS_LADDER_KM.length - 1);
      if (tier < 1) continue;
      await dispatchBooking(booking, RADIUS_LADDER_KM[tier]);
    }
  } catch (e) {
    console.error("[dispatch] re-dispatch sweep failed:", e);
  }
}

const PORT = Number(process.env.PORT) || 3001;
httpServer.listen(PORT, () => {
  console.log(`TruckGo backend listening on :${PORT}`);
  void sweepExpiredDocuments();
  setInterval(() => void sweepExpiredDocuments(), EXPIRY_SWEEP_MS).unref();
  setInterval(() => void sweepUnbidBookings(), REDISPATCH_SWEEP_MS).unref();
});
