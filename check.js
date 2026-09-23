require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  console.log("Fixing all pending statuses...");
  const updated = await prisma.callLog.updateMany({
    where: { 
      status: { in: ["RINGING", "PENDING", "QUEUED", "ANSWERED"] },
    },
    data: { status: "FAILED" }
  });
  console.log(`Marked ${updated.count} stuck calls as FAILED.`);
  await prisma.$disconnect();
}
main().catch(console.error);
