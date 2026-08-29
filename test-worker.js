const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const dbCalls = await prisma.callLog.findMany({
    where: { companyId: "6a897a7c500636731c1f15da", campaignId: null, direction: "OUTBOUND" },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { lead: true }
  });
  
  const phone = "+918851860838";
  const corePhone = phone.replace(/\D/g, "").slice(-10);
  
  // exact timestamp from Redis campaign state: "camp-1787950898273"
  const timeout = 1787950898273;
  
  const matchingCalls = dbCalls.filter(c => c.lead?.phone?.includes(corePhone) && c.createdAt.getTime() > (timeout - 10000));
  
  const activeMatching = matchingCalls.filter(c => ["pending", "ringing", "answered", "in-progress"].includes(c.status?.toLowerCase() || ""));
  
  console.log(`DB Calls returned: ${dbCalls.length}`);
  console.log(`Matching Calls: ${matchingCalls.length}`);
  console.log(`Active Matching: ${activeMatching.length}`);
  if (matchingCalls.length > 0) {
    console.log(`First matching call status: ${matchingCalls[0].status}`);
  }
}

main()
  .catch(console.error)
  .finally(async () => await prisma.$disconnect());
