const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function check() {
  const c = await prisma.company.findFirst({ where: { name: "schoolKnot" } });
  console.log("schoolKnot created at:", c.createdAt);
  
  const devTest = await prisma.company.findFirst({ where: { name: "DeveloperTest" } });
  const calls = await prisma.callLog.findMany({ where: { companyId: devTest.id } });
  for (const call of calls) {
     console.log("Call created at:", call.createdAt);
  }
}
check().then(() => prisma.$disconnect());
