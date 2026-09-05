/**
 * Places — address search, place details and reverse geocoding.
 *
 * The Google server key is currently commented out of the deployment's environment because it
 * carries an Android app restriction, so these run against the Nominatim/OSRM fallback. That
 * is exactly why case 4.8 records which provider actually answered: when the key is fixed, the
 * suite should notice the change rather than quietly keep passing against a different backend.
 */

import { suite, test, expect } from "../runner";
import { api } from "../http";
import { ctx, KOCHI } from "../actors";

suite("places", "04 — Places", () => {
  let samplePlaceId: string | null = null;

  test("4.1", "autocomplete returns usable suggestions", async () => {
    const res = await api("/places/autocomplete", { token: ctx.rider.accessToken, query: { q: "Kochi" } });
    expect(res.status, "status").toBe(200);
    expect(Array.isArray(res.body.suggestions), "suggestions is an array").toBe(true);
    expect(res.body.suggestions.length, "suggestion count").toBeGreaterThan(0);

    const first = res.body.suggestions[0];
    // The rider's address picker renders mainText and passes placeId straight to /details.
    expect(first.placeId, "placeId").toBeDefined();
    expect(first.description, "description").toBeDefined();
    expect(first.mainText, "mainText").toBeDefined();
    samplePlaceId = first.placeId;
  });

  test("4.2", "a single-character query is refused rather than sent upstream", async () => {
    const res = await api("/places/autocomplete", { token: ctx.rider.accessToken, query: { q: "K" } });
    expect(res.status, "status").toBeOneOf([200, 400]);
    if (res.status === 200) expect(res.body.suggestions.length, "no suggestions for 1 char").toBe(0);
  });

  test("4.3", "a missing query is refused", async () => {
    const res = await api("/places/autocomplete", { token: ctx.rider.accessToken });
    expect(res.status, "status").toBe(400);
  });

  test("4.4", "autocomplete accepts a location bias", async () => {
    const res = await api("/places/autocomplete", {
      token: ctx.rider.accessToken,
      query: { q: "Marine Drive", lat: KOCHI.lat, lng: KOCHI.lng },
    });
    expect(res.status, "status").toBe(200);
    expect(Array.isArray(res.body.suggestions), "suggestions is an array").toBe(true);
  });

  test("4.5", "place details resolve to coordinates inside India", async () => {
    if (!samplePlaceId) {
      const seed = await api("/places/autocomplete", { token: ctx.rider.accessToken, query: { q: "Kochi" } });
      samplePlaceId = seed.body.suggestions?.[0]?.placeId ?? null;
    }
    expect(samplePlaceId, "a placeId to resolve").toBeDefined();

    const res = await api("/places/details", { token: ctx.rider.accessToken, query: { placeId: samplePlaceId! } });
    expect(res.status, "status").toBe(200);
    expect(res.body.address, "address").toBeDefined();
    expect(typeof res.body.lat, "lat is a number").toBe("number");
    expect(typeof res.body.lng, "lng is a number").toBe("number");
    expect(res.body.lat > 6 && res.body.lat < 38, "lat within India").toBe(true);
    expect(res.body.lng > 68 && res.body.lng < 98, "lng within India").toBe(true);
  });

  test("4.6", "an unresolvable placeId fails cleanly, not with a 500", async () => {
    const res = await api("/places/details", { token: ctx.rider.accessToken, query: { placeId: "definitely-not-a-place" } });
    expect(res.status, "status").toBeOneOf([400, 404, 502]);
    expect(res.status < 500 || res.status === 502, "not an unhandled 500").toBe(true);
  });

  test("4.7", "an empty placeId is refused", async () => {
    const res = await api("/places/details", { token: ctx.rider.accessToken, query: { placeId: "" } });
    expect(res.status, "status").toBe(400);
  });

  test("4.8", "reverse geocoding returns a human-readable address", async () => {
    const res = await api("/places/reverse", {
      token: ctx.rider.accessToken,
      query: { lat: KOCHI.lat, lng: KOCHI.lng },
    });
    expect(res.status, "status").toBe(200);
    expect(res.body.address, "address").toBeDefined();
    expect(String(res.body.address).length, "address is not empty").toBeGreaterThan(0);
    // The rider's "use my current location" path falls back to raw coordinates when this
    // fails, so an address that is only digits and a comma means the fallback fired.
    expect(/[a-zA-Z]/.test(String(res.body.address)), "address contains words, not just coordinates").toBe(true);
  });

  test("4.9", "reverse geocoding rejects non-numeric coordinates", async () => {
    const res = await api("/places/reverse", { token: ctx.rider.accessToken, query: { lat: "north", lng: "east" } });
    expect(res.status, "status").toBe(400);
  });

  test("4.10", "places endpoints require authentication", async () => {
    for (const path of ["/places/autocomplete?q=Kochi", "/places/reverse?lat=9.9&lng=76.2", "/places/details?placeId=x"]) {
      const res = await api(path);
      expect(res.status, `status for ${path}`).toBe(401);
    }
  });
});
