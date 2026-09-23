const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const q2Calls = await prisma.callLog.count({
    where: {
      direction: 'OUTBOUND',
      correlationId: {
        contains: 'reactivation-2026-09-21',
        endsWith: '-q2'
      }
    }
  });
  const q3Calls = await prisma.callLog.count({
    where: {
      direction: 'OUTBOUND',
      correlationId: {
        contains: 'reactivation-2026-09-21',
        endsWith: '-q3'
      }
    }
  });
  
  console.log("Q2 Count: " + q2Calls + ", Q3 Count: " + q3Calls);
}

main().catch(console.error).finally(() => prisma.$disconnect());
