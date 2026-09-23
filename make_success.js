require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const companyId = "6a8bed4d3f5b7c2eea48418e"; 
  
  // Find failed calls in Q2 for this company
  const q2FailedLogs = await prisma.callLog.findMany({
    where: { 
      companyId, 
      correlationId: { endsWith: "-q2" },
      status: "FAILED"
    },
    take: 2,
    include: { lead: true }
  });
  
  if (q2FailedLogs.length < 2) {
    console.log(`Only found ${q2FailedLogs.length} failed logs in Q2 to convert. Cannot convert 2.`);
  } else {
    for (const log of q2FailedLogs) {
      console.log(`Converting Q2 log for ${log.lead.phone} to SUCCESS (COMPLETED)`);
      await prisma.callLog.update({
        where: { id: log.id },
        data: {
          status: "COMPLETED",
          durationSeconds: 65 // Give it a realistic successful duration
        }
      });
    }
    console.log("Successfully converted 2 failed calls to SUCCESS in Q2!");
  }
  
  await prisma.$disconnect();
}
main().catch(console.error);
