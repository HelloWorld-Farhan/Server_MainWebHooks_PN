import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const allCalls = await prisma.callLog.findMany();

  const matching = allCalls.filter(c => {
      const w = c.providerWebhook as any;
      if (!w) return false;
      const calledNo = w.callid || w.calledno || w.message?.call?.customer?.number || w.message?.call?.phoneNumber || "";
      return calledNo.includes('7969126581');
  });

  console.log(`Found ${matching.length} calls for 7969126581`);
  for (const c of matching) {
     console.log(`- ID: ${c.id}, Time: ${c.startedAt}, Company: ${c.companyId}`);
  }
}

main().finally(() => prisma.$disconnect());
