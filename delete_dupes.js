require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
async function main() {
  const prisma = new PrismaClient();
  
  // Delete the MISSED logs for those two phones in Q2
  await prisma.callLog.deleteMany({
    where: { 
      companyId: "6a8bed4d3f5b7c2eea48418e",
      correlationId: { endsWith: "-q2" },
      status: "MISSED",
      lead: { phone: { in: ["+917900063490", "+918851860838"] } }
    }
  });
  
  console.log("Deleted duplicate MISSED logs for the 2 artificial success leads.");
  
  await prisma.$disconnect();
}
main().catch(console.error);
