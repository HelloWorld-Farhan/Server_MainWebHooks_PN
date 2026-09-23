require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const companyId = "6a8bed4d3f5b7c2eea48418e"; 
  
  const callLogs = await prisma.callLog.findMany({
    where: { companyId },
    include: { lead: true }
  });
  
  const q2Logs = callLogs.filter(l => l.correlationId && l.correlationId.endsWith("-q2"));
  const q3Logs = callLogs.filter(l => l.correlationId && l.correlationId.endsWith("-q3"));
  
  const q3Phones = new Set(q3Logs.map(l => l.lead?.phone));
  
  const stuckInQ3 = [];
  
  for (const q2 of q2Logs) {
    if (q2.status === "FAILED") {
      const phone = q2.lead?.phone;
      if (phone && !q3Phones.has(phone)) {
        stuckInQ3.push(q2);
      }
    }
  }
  
  console.log(`Found ${stuckInQ3.length} leads that failed Q2 but have no Q3 log.`);
  for (const s of stuckInQ3) {
    console.log(`- ${s.lead?.phone}`);
  }
  
  await prisma.$disconnect();
}
main().catch(console.error);
