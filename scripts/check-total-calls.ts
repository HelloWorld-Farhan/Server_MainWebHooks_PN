import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const allCalls = await prisma.callLog.findMany({
     include: { phoneNumber: true }
  });
  console.log("Total calls in DB:", allCalls.length);

  const phoneMap = new Map();
  for (const c of allCalls) {
     const num = c.phoneNumber?.number || "NO_PHONE_NUMBER";
     if (!phoneMap.has(num)) phoneMap.set(num, 0);
     phoneMap.set(num, phoneMap.get(num) + 1);
  }
  console.log(phoneMap);

  const webhookMap = new Map();
  for (const c of allCalls) {
      const w = c.providerWebhook as any;
      if (!w) continue;
      const num = w.callid || w.calledno || w.message?.call?.customer?.number || w.message?.call?.phoneNumber || "";
      if (!webhookMap.has(num)) webhookMap.set(num, 0);
      webhookMap.set(num, webhookMap.get(num) + 1);
  }
  console.log(webhookMap);
}
main().finally(()=>prisma.$disconnect());
