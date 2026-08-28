const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const calls = await prisma.callLog.findMany({
    orderBy: { startedAt: 'desc' },
    take: 5,
    include: { lead: true }
  });
  console.log(calls.map(c => ({ id: c.id, time: c.startedAt, phone: c.lead?.phone, status: c.status, companyId: c.companyId })));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
