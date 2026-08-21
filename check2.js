const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function check() {
  const c = await prisma.company.findFirst({ where: { name: "schoolKnot" } });
  console.log("SchoolKnot ID:", c.id);
  
  const calls = await prisma.callLog.findMany({ where: { companyId: c.id } });
  console.log("CallLogs count:", calls.length);
  if (calls.length > 0) {
    console.log("Sample call:", calls[0]);
  }
}
check().then(() => prisma.$disconnect());
