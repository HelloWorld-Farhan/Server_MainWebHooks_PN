import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const numbersToCheck = [
    "+917969126581",
    "+919429390110",
    "+919429391366",
    "+919429390765"
  ];

  const allCalls = await prisma.callLog.findMany({
    include: { phoneNumber: true }
  });

  const results: Record<string, any> = {};

  for (const num of numbersToCheck) {
    // Strip everything except digits to match against payload loosely
    const pureDigits = num.replace(/\D/g, "");
    const base10 = pureDigits.length > 10 ? pureDigits.slice(-10) : pureDigits;

    // 1. Find all calls where the webhook payload matches this number
    const matchingPayloads = allCalls.filter(c => {
      const w = c.providerWebhook as any;
      if (!w) return false;
      const calledNo = w.callid || w.calledno || w.message?.call?.customer?.number || w.message?.call?.phoneNumber || "";
      return calledNo.includes(base10);
    });

    // 2. See what formats came in the webhook payload
    const payloadFormats = new Set<string>();
    for (const c of matchingPayloads) {
      const w = c.providerWebhook as any;
      payloadFormats.add(w.callid || w.calledno || "unknown");
    }

    // 3. See if they were successfully mapped to a PhoneNumber record
    const successfullyMapped = matchingPayloads.filter(c => c.phoneNumberId !== null).length;
    const mappedPhoneNumbers = new Set<string>();
    for (const c of matchingPayloads) {
      if (c.phoneNumber) {
        mappedPhoneNumbers.add(c.phoneNumber.number);
      }
    }

    results[num] = {
      totalWebhookCallsReceived: matchingPayloads.length,
      formatsReceivedFromProvider: Array.from(payloadFormats),
      successfullyMappedToAccount: successfullyMapped,
      mappedToDbNumber: Array.from(mappedPhoneNumbers)
    };
  }

  console.log(JSON.stringify(results, null, 2));
}

main().finally(() => prisma.$disconnect());
