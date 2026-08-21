const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const companyId = "6a87f72283ec91c0e34669db"; // ID of schoolKnot from the screenshot URL

  const company = await prisma.company.findUnique({
    where: { id: companyId },
    include: {
      callLogs: true,
      phoneNumbers: true
    }
  });

  console.log("Company:", company ? company.name : "Not found");
  if (company) {
      console.log("CallLogs count in DB:", company.callLogs.length);
      console.log("Phone numbers:", company.phoneNumbers);
  }

  const calls = await prisma.callLog.findMany({
    where: { companyId: companyId }
  });
  console.log("CallLog findMany count:", calls.length);
}

check().finally(() => prisma.$disconnect());
