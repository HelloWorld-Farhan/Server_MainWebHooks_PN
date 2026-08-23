import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const calls = await prisma.callLog.findMany({ where: { callLogId: 'dummy-test-079-001' }, include: { phoneNumber: true } });
  console.log("Dummy calls mapped:");
  for (const c of calls) {
     console.log(`- Mapped to Company: ${c.companyId}, Phone Number: ${c.phoneNumber?.number || 'None'} (${c.phoneNumberId})`);
  }
}
main().finally(()=>prisma.$disconnect());
