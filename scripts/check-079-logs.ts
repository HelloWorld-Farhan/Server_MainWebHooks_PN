import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const logs = await prisma.callLog.findMany({
    where: { 
      providerWebhook: { path: ['phone'], string_contains: '08851860838' } // The caller phone
    }
  });
  console.log(logs.map(l => ({ id: l.id, companyId: l.companyId })));
}
main().finally(()=>prisma.$disconnect());
