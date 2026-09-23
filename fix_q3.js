require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  const companyId = "6a8bed4d3f5b7c2eea48418e"; 
  
  const q3Logs = await prisma.callLog.findMany({
    where: { 
      companyId, 
      correlationId: { endsWith: "-q3" } 
    },
    include: { lead: true }
  });
  
  console.log(`Found ${q3Logs.length} logs for Q3`);
  
  for (const log of q3Logs) {
    console.log(`Deleting Q3 log for ${log.lead.phone}, ID: ${log.id}`);
    await prisma.callLog.delete({
      where: { id: log.id }
    });
  }
  
  console.log("Q3 logs successfully deleted, they will now correctly show as Pending.");
  await prisma.$disconnect();
}
main().catch(console.error);
