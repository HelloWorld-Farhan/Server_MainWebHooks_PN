const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function run() {
  const res = await prisma.callLog.updateMany({
    where: {
      status: { in: ['RINGING', 'PENDING'] },
      direction: 'OUTBOUND'
    },
    data: {
      status: 'FAILED'
    }
  });
  console.log('Updated ' + res.count + ' stuck calls to FAILED');
}
run().catch(console.error).finally(() => prisma.$disconnect());
