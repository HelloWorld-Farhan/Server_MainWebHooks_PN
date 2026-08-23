import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const calls = await prisma.callLog.findMany({
    orderBy: { startedAt: 'desc' },
    take: 10
  });

  console.log("Recent calls:");
  for (const c of calls) {
    console.log(`- ID: ${c.id}, Time: ${c.startedAt}, LogID: ${c.callLogId}`);
  }
}

main().finally(() => prisma.$disconnect());
