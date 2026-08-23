import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const calls = await prisma.callLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { company: true }
  });
  
  for (const call of calls) {
    console.log(`Company: ${call.company?.name}`);
    console.log(`Provider Webhook:`, JSON.stringify(call.providerWebhook, null, 2));
    console.log("-------------------");
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
