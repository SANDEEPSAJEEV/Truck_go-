// Generates the real Kochi -> Thrissur road polyline used by demo mode.
//
// The previous value was hand-written and decoded to Bengaluru, ~350 km away from the
// pickup/drop markers — so the map framed a route nobody could see and rendered as empty
// ocean. Encoded polylines are not human-writable; they have to be produced.
import { routeOrFallback, encodePolyline } from "../src/lib/routing";

const PICKUP = { lat: 9.9679, lng: 76.2444 }; // Marine Drive, Kochi
const DROP = { lat: 10.5276, lng: 76.2144 }; // Swaraj Round, Thrissur

async function main() {
  const route = await routeOrFallback(PICKUP, DROP);
  console.log("provider   :", route.provider);
  console.log("distanceKm :", route.distanceKm);
  console.log("durationMin:", route.durationMin);
  console.log("");
  console.log("const DEMO_ROUTE =");
  console.log(`  '${route.polyline}';`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
