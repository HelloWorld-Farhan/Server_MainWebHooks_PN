const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const calls = await prisma.callLog.findRaw({
    filter: {
      "providerWebhook.callid": { $regex: '07971501546' }
    }
  });
  console.log("Found calls:", calls.length);
  for (const c of calls) {
    console.log("Call ID:", c._id);
    console.log("Company ID:", c.companyId);
  }
}

check().finally(() => prisma.$disconnect());
