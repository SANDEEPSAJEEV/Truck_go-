/** Read-only: lists every driver account's stored phone + registration time. */
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.user.findMany({
    where: { role: "DRIVER" },
    select: { phone: true, fullName: true, createdAt: true, phoneVerifiedAt: true },
    orderBy: { createdAt: "desc" },
  });
  console.log(JSON.stringify(rows, null, 2));
}
main().finally(() => prisma.$disconnect());
