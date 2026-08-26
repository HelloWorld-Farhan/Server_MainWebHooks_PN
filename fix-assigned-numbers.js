const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Fixing missing assigned numbers...");
  
  // Find all FAILED calls that have no providerWebhook and no phoneNumberId
  const calls = await prisma.callLog.findMany({
    where: {
      status: "FAILED",
      phoneNumberId: null
    }
  });
  
  let count = 0;
  for (const call of calls) {
    if (!call.providerWebhook || Object.keys(call.providerWebhook).length === 0) {
      await prisma.callLog.update({
        where: { id: call.id },
        data: {
          providerWebhook: { did_number: "917969007101" } // Use the old default
        }
      });
      count++;
    }
  }
  
  console.log(`Fixed ${count} calls by adding fallback did_number.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
