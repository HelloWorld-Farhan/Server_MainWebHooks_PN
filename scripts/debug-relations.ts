import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function debugCalls() {
  const subCompanyId = "6a897a7c500636731c1f15da";
  
  const calls = await prisma.callLog.findMany({
    where: { companyId: subCompanyId, direction: "INBOUND" },
    include: { phoneNumber: true, lead: true },
    take: 2
  });
  
  console.log(JSON.stringify(calls, null, 2));
}

debugCalls().catch(console.error).finally(() => prisma.$disconnect());
