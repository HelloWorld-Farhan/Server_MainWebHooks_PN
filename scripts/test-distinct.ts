import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const authCompanyId = '6a8849a633c16567e76a58e7'; // Developer_Test
  const subCompanies = await prisma.company.findMany({
    where: { parentCompanyId: authCompanyId },
    select: { id: true }
  });
  const companyIdsToQuery = [authCompanyId, ...subCompanies.map(c => c.id)];

  const calls = await prisma.callLog.findMany({
    where: {
      direction: 'INBOUND',
      companyId: { in: companyIdsToQuery }
    },
    orderBy: { startedAt: 'desc' },
    distinct: ['callLogId'],
    take: 10
  });
  console.log("Found calls:", calls.length);
}
main().finally(() => prisma.$disconnect());
