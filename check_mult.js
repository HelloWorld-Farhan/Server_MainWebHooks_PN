require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
async function main() {
  const prisma = new PrismaClient();
  const logs = await prisma.callLog.findMany({
    where: { 
      companyId: "6a8bed4d3f5b7c2eea48418e",
      correlationId: { endsWith: "-q2" },
      lead: { phone: { in: ["+917900063490", "+918851860838"] } }
    },
    include: { lead: true },
    orderBy: { createdAt: "desc" }
  });
  console.log(`Found ${logs.length} Q2 logs for those 2 phones.`);
  for (const l of logs) {
    console.log(`Phone: ${l.lead.phone}, ID: ${l.id}, Status: ${l.status}, CreatedAt: ${l.createdAt}`);
  }
  await prisma.$disconnect();
}
main().catch(console.error);
