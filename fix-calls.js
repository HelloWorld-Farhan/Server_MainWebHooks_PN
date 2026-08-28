const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
  const result = await prisma.callLog.updateMany({
    where: {
      status: { in: ['PENDING', 'RINGING'] },
      createdAt: { lt: fiveMinsAgo }
    },
    data: {
      status: 'FAILED',
      durationSeconds: 0
    }
  });
  console.log('Fixed stuck calls:', result.count);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
