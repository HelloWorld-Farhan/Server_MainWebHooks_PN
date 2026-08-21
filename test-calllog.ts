import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const callLog = await prisma.callLog.findFirst({
    where: { direction: "INBOUND" },
    orderBy: { startedAt: "desc" }
  });
  console.log(JSON.stringify(callLog, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
