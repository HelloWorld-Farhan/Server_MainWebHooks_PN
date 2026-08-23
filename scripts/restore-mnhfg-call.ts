import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const mnhfgId = '6a89928d0069674051ad8a64'; // MNHFG
  const callLogId = 'e75c8b0f-02b5-4a96-9ba2-335a7607cba5'; // 079 call
  const demo3Call = await prisma.callLog.findFirst({
    where: { callLogId }
  });
  
  if (demo3Call) {
    // Check if MNHFG already has it
    const existing = await prisma.callLog.findFirst({
      where: { companyId: mnhfgId, callLogId }
    });
    if (!existing) {
      console.log("Restoring call for MNHFG...");
      const newCall = await prisma.callLog.create({
        data: {
          companyId: mnhfgId,
          callLogId: demo3Call.callLogId,
          publicId: demo3Call.publicId,
          direction: demo3Call.direction,
          status: demo3Call.status,
          startedAt: demo3Call.startedAt,
          durationSeconds: demo3Call.durationSeconds,
          recordingUrl: demo3Call.recordingUrl,
          transcriptUrl: demo3Call.transcriptUrl,
          creditsUsed: demo3Call.creditsUsed,
          provider: demo3Call.provider,
          providerCallId: demo3Call.providerCallId,
          providerWebhook: demo3Call.providerWebhook as any,
          leadId: demo3Call.leadId,
          phoneNumberId: '6a89928e0069674051ad8a67' // MNHFG's phone number ID
        }
      });
      console.log("Restored:", newCall.id);
    } else {
      console.log("MNHFG already has the call.");
    }
  }
}
main().finally(()=>prisma.$disconnect());
