const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const calls = await prisma.callLog.findMany({
    where: { lead: { phone: { contains: "8851860838" } }, direction: "OUTBOUND" },
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: { lead: true }
  });
  console.log(JSON.stringify(calls, null, 2));
}
check().catch(console.error).finally(() => prisma.$disconnect());
