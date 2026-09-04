// Verifies the Nominatim autocomplete path directly, bypassing Express/Prisma — useful
// while the Postgres database isn't wired up yet, since every real HTTP request needs auth
// which needs the DB.
import { NominatimPlacesProvider } from "../src/lib/places";

async function main() {
  const provider = new NominatimPlacesProvider();

  for (const q of ["Koc", "Koch", "Kochi", "Thrissur"]) {
    const r = await provider.autocomplete(q);
    console.log(`=== autocomplete('${q}') -> ${r.length} results ===`);
    for (const s of r.slice(0, 3)) console.log(`  ${s.mainText} | ${s.secondaryText}`);
  }
  const suggestions = await provider.autocomplete("Kochi");

  if (suggestions[0]?.placeId) {
    console.log("\n=== details() on first suggestion ===");
    const d = await provider.details(suggestions[0].placeId);
    console.log(" ", JSON.stringify(d));
  }

  console.log("\n=== reverse(9.9679, 76.2444) ===");
  console.log(" ", await provider.reverse(9.9679, 76.2444));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
