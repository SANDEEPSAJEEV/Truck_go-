/** Read-only: lists any driver accounts currently locked out or with recent failed logins. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.user.findMany({
    where: {
      role: "DRIVER",
      OR: [{ failedLoginCount: { gt: 0 } }, { lockedUntil: { not: null } }],
    },
    select: { phone: true, fullName: true, failedLoginCount: true, lockedUntil: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(JSON.stringify(rows, null, 2));
}
main().finally(() => prisma.$disconnect());
