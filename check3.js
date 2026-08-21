const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function check() {
  const c = await prisma.company.findFirst({ where: { name: "DeveloperTest" } });
  
  const calls = await prisma.callLog.findMany({ where: { companyId: c.id } });
  console.log("CallLogs count:", calls.length);
  for (const call of calls) {
     console.log("Call webhook:", call.providerWebhook);
     console.log("Call creditsUsed:", call.creditsUsed);
  }
}
check().then(() => prisma.$disconnect());
