const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const calls = await prisma.callLog.findMany({
    where: {
      direction: 'OUTBOUND',
      correlationId: { contains: 'reactivation-2026-09-21' }
    },
    take: 5,
    orderBy: { startedAt: 'desc' }
  });
  console.log(JSON.stringify(calls, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
