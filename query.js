const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.callLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      createdAt: true,
      direction: true,
      status: true,
      callLogId: true,
      publicId: true,
      companyId: true,
      lead: { select: { phone: true, id: true } }
    }
  });
  console.log(JSON.stringify(logs, null, 2));
}

main()
  .catch(console.error)
  .finally(async () => await prisma.$disconnect());
