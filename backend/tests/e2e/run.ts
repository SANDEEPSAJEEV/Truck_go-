/**
 * End-to-end suite entry point.
 *
 *   npx tsx tests/e2e/run.ts                     # everything, against the deployed backend
 *   npx tsx tests/e2e/run.ts --suite auth,bids   # one area, while iterating on a fix
 *   npx tsx tests/e2e/run.ts --keep              # leave fixtures behind to inspect a failure
 *   E2E_BASE_URL=http://localhost:3001 npx tsx tests/e2e/run.ts
 *
 * Defaults to https://truckgo-api.onrender.com — the deployment the apps actually talk to.
 * Testing anything else proves the wrong thing.
 */

import { waitForServer, BASE_URL } from "./http";
import { runSuites, report } from "./runner";
import { buildActors } from "./actors";
import { db, purgeRun } from "./db";

// Importing a suite registers its cases. Order here is the order they run in, and it matters:
// bidding needs a booking, the trip lifecycle needs an accepted bid, payments need a delivered
// trip.
import "./suites/01-auth";
import "./suites/02-drivers";
import "./suites/03-kyc";
import "./suites/04-places";
import "./suites/05-bookings";
import "./suites/06-bidding";
import "./suites/07-trip-lifecycle";
import "./suites/08-payments";
import "./suites/09-notifications";
import "./suites/10-ratings";
import "./suites/11-dispatch";
import "./suites/12-realtime";
import "./suites/13-security";
import "./suites/14-negative";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main() {
  const only = arg("suite")?.split(",").map((s) => s.trim()).filter(Boolean);
  const keep = flag("keep");

  // Short enough to sit inside a VarChar(120) name, unique enough that two runs never collide,
  // and it is what teardown matches on.
  const runId = `e2e${Date.now().toString(36)}`;
  // 10 digits total, so it passes phoneSchema. The 7-digit body is derived from the clock, and
  // actors take the last three.
  const phonePrefix = `9${String(Date.now()).slice(-6)}`;

  console.log(`\n\x1b[1mTruckGo end-to-end suite\x1b[0m`);
  console.log(`  target : ${BASE_URL}`);
  console.log(`  run id : ${runId}`);
  console.log(`  phones : ${phonePrefix}xxx\n`);

  console.log("Waking the server…");
  const wakeMs = await waitForServer();
  console.log(`  healthy after ${(wakeMs / 1000).toFixed(1)}s${wakeMs > 10_000 ? " (cold start)" : ""}`);

  let exitCode = 1;
  try {
    console.log("\nBuilding actors…");
    await buildActors(runId, phonePrefix);
    console.log("  2 riders, 5 drivers (4 approved, 1 pending)");

    const results = await runSuites(only);
    exitCode = report(results);
  } catch (e) {
    console.error(`\n\x1b[31mRun aborted: ${e instanceof Error ? e.stack : String(e)}\x1b[0m`);
    exitCode = 1;
  } finally {
    if (keep) {
      console.log(`\n\x1b[2mFixtures kept (--keep). Clean up later with: --purge ${runId}\x1b[0m`);
    } else {
      try {
        const removed = await purgeRun(runId, phonePrefix);
        console.log(`\n\x1b[2mCleaned up ${removed} fixture users.\x1b[0m`);
      } catch (e) {
        console.error(`\x1b[31mCleanup failed — ${runId} left behind: ${(e as Error).message}\x1b[0m`);
      }
    }
    await db.$disconnect();
  }

  process.exit(exitCode);
}

// A standalone cleanup path, for when a previous run was killed mid-flight.
const purgeId = arg("purge");
if (purgeId) {
  purgeRun(purgeId, "9")
    .then((n) => console.log(`Removed ${n} users for run ${purgeId}`))
    .catch((e) => console.error(e))
    .finally(() => db.$disconnect().then(() => process.exit(0)));
} else {
  main();
}
