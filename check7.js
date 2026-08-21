const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function check() {
  const c = await prisma.company.findFirst({
    where: { name: "DeveloperTest" }
  });
  const usages = await prisma.creditUsage.findMany({ where: { companyId: c.id } });
  console.log("Credit usages:");
  for (const usage of usages) {
     console.log(`Amount: ${usage.amount}, Reason: ${usage.reason}, LogId: ${usage.callLogId}`);
  }
}
check().then(() => prisma.$disconnect());
