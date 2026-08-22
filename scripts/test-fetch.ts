import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const number = "07971501546";
  const cleanedNumber = number.replace(/\D/g, "");

  console.log("Testing findRaw in number.repository.ts...");
  const rawCalls = await prisma.callLog.findRaw({
    filter: {
      $or: [
        { "providerWebhook.callid": number },
        { "providerWebhook.calledno": number },
        { "providerWebhook.message.call.phoneNumber": number }
      ]
    }
  }) as unknown as any[];
  console.log(`findRaw found: ${rawCalls.length} calls`);

  console.log("Testing findMany in company.repository.ts...");
  try {
    const pastCalls = await prisma.callLog.findMany({
      where: {
        OR: [
          { providerWebhook: { string_contains: `"${cleanedNumber}"` } },
          { providerWebhook: { string_contains: `"calledno":"${cleanedNumber}"` } },
          { providerWebhook: { string_contains: `"phoneNumber":"${cleanedNumber}"` } },
        ]
      } as any 
    });
    console.log(`findMany found: ${pastCalls.length} calls`);
  } catch (err: any) {
    console.error("findMany failed:", err.message);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
