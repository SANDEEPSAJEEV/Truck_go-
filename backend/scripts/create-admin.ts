// Creates or promotes an admin account for the verification review queue.
// Usage: npx tsx scripts/create-admin.ts <phone> <password> [fullName]
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";

async function main() {
  const [phone, password, fullName = "TruckGo Admin"] = process.argv.slice(2);
  if (!phone || !password) {
    throw new Error("usage: tsx scripts/create-admin.ts <phone> <password> [fullName]");
  }
  if (password.length < 8) throw new Error("Choose a password of at least 8 characters.");

  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { phone },
    create: { role: "ADMIN", fullName, phone, passwordHash, phoneVerifiedAt: new Date() },
    update: { role: "ADMIN", passwordHash },
  });

  console.log(`Admin ready: ${user.fullName} (${user.phone})`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
