import { Router } from "express";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { requireAuth, AuthedRequest } from "../middleware/auth";
import { getPlacesProvider } from "../lib/places";

export const placesRouter = Router();
placesRouter.use(requireAuth);

// Autocomplete fires on every keystroke from the client, unlike most endpoints here — the
// general limiter alone would let a fast typist (or a bug in a debounce) burn through the
// Places quota in seconds. A window this size still comfortably covers normal typing.
const autocompleteLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "Too many searches. Please slow down." } },
});

const autocompleteSchema = z.object({
  q: z.string().trim().min(2).max(200),
  lat: z.coerce.number().optional(),
  lng: z.coerce.number().optional(),
});

placesRouter.get("/autocomplete", autocompleteLimiter, async (req: AuthedRequest, res) => {
  const parsed = autocompleteSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "A search query is required." } });
  }
  const { q, lat, lng } = parsed.data;

  try {
    const suggestions = await getPlacesProvider().autocomplete(q, { lat, lng });
    return res.json({ suggestions });
  } catch (e) {
    console.error("[places] autocomplete failed:", (e as Error)?.message ?? e);
    // A search failing must never look like "no results" and must never crash the
    // screen — the caller shows a retry rather than an empty, silently-wrong list.
    return res.status(502).json({ error: { code: "PLACES_UNAVAILABLE", message: "Could not search right now." } });
  }
});

const reverseSchema = z.object({ lat: z.coerce.number(), lng: z.coerce.number() });

placesRouter.get("/reverse", async (req: AuthedRequest, res) => {
  const parsed = reverseSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "lat and lng are required." } });
  }
  try {
    const address = await getPlacesProvider().reverse(parsed.data.lat, parsed.data.lng);
    return res.json({ address });
  } catch (e) {
    console.error("[places] reverse failed:", (e as Error)?.message ?? e);
    return res.status(502).json({ error: { code: "PLACES_UNAVAILABLE", message: "Could not resolve this location." } });
  }
});

const detailsSchema = z.object({ placeId: z.string().trim().min(1) });

placesRouter.get("/details", async (req: AuthedRequest, res) => {
  const parsed = detailsSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION", message: "placeId is required." } });
  }

  try {
    const details = await getPlacesProvider().details(parsed.data.placeId);
    return res.json(details);
  } catch (e) {
    console.error("[places] details failed:", (e as Error)?.message ?? e);
    return res.status(502).json({ error: { code: "PLACES_UNAVAILABLE", message: "Could not resolve that place." } });
  }
});
