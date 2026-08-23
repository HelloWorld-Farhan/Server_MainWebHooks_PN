import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const authCompanyId = '6a89928d0069674051ad8a64'; // MNHFG
  const subCompanies = await prisma.company.findMany({
    where: { parentCompanyId: authCompanyId },
    select: { id: true }
  });
  const companyIdsToQuery = [authCompanyId, ...subCompanies.map(c => c.id)];
  
  const assignedPhoneNumberIds = (await prisma.phoneNumber.findMany({
    where: { companyId: { in: companyIdsToQuery } },
    select: { id: true }
  })).map(pn => pn.id);

  const calls = await prisma.callLog.findMany({
    where: {
      direction: 'INBOUND',
      OR: [
        { companyId: { in: companyIdsToQuery } },
        ...(assignedPhoneNumberIds.length > 0
          ? [{ phoneNumberId: { in: assignedPhoneNumberIds } }]
          : [])
      ]
    },
    orderBy: { startedAt: 'desc' },
    take: 10
  });

  console.log("Found calls:", calls.length);
  console.log(calls.map(c => ({
     id: c.id,
     companyId: c.companyId,
     callLogId: c.callLogId
  })));
}

main().finally(() => prisma.$disconnect());
