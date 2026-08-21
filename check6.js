const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function check() {
  const c = await prisma.company.findFirst({
    where: { name: "DeveloperTest" },
    include: { creditBalance: true, _count: { select: { callLogs: true } } }
  });
  console.log("DeveloperTest creditBalance:", c.creditBalance);
  console.log("CallLogs count:", c._count.callLogs);
}
check().then(() => prisma.$disconnect());
