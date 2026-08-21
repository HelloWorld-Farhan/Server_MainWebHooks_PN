const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function check() {
  const c = await prisma.company.findFirst({
    where: { name: "schoolKnot" },
    include: {
      phoneNumbers: true,
      callLogs: true,
      creditBalance: true,
    }
  });
  console.log(JSON.stringify(c, null, 2));
}
check().then(() => prisma.$disconnect());
