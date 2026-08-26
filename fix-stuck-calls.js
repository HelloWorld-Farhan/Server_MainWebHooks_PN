const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log("Fixing stuck calls...");
  const fiveMinsAgo = new Date(Date.now() - 5 * 60 * 1000);
  
  const result = await prisma.callLog.updateMany({
    where: {
      status: { in: ["RINGING", "ANSWERED", "PENDING"] }
    },
    data: {
      status: "FAILED",
      durationSeconds: 0
    }
  });
  
  console.log(`Fixed ${result.count} stuck calls.`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
