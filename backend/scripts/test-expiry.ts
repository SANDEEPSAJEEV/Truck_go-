// Manual check for the compliance watchdog: backdate a driver's insurance, run the sweep,
// and confirm the driver is taken off the dispatch board automatically.
import { prisma } from "../src/lib/prisma";
import { expireLapsedDocuments } from "../src/lib/verification";

async function main() {
  const phone = process.argv[2];
  if (!phone) throw new Error("usage: tsx scripts/test-expiry.ts <phone>");

  const user = await prisma.user.findUniqueOrThrow({
    where: { phone },
    include: { driverProfile: true },
  });
  const driverId = user.id;

  const before = await prisma.driverProfile.findUniqueOrThrow({ where: { userId: driverId } });
  console.log("before :", before.verificationStatus, "| isOnline:", before.isOnline);

  await prisma.driverDocument.update({
    where: { driverId_type: { driverId, type: "INSURANCE" } },
    data: { expiresAt: new Date(Date.now() - 86400_000) },
  });
  console.log("backdated INSURANCE expiry to yesterday");

  const expired = await expireLapsedDocuments();
  console.log("sweep expired", expired, "document(s)");

  const after = await prisma.driverProfile.findUniqueOrThrow({
    where: { userId: driverId },
    include: { documents: true },
  });
  console.log("after  :", after.verificationStatus, "| isOnline:", after.isOnline);
  console.log("reason :", after.rejectionReason);
  for (const d of after.documents) console.log("  ", d.type, "->", d.status);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
