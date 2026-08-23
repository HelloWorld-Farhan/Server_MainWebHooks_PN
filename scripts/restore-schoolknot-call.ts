import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const mnhgfId = '6a897a7c500636731c1f15da'; // schoolknot / MNHGF
  const callLogId = 'e75c8b0f-02b5-4a96-9ba2-335a7607cba5'; // 079 call
  const demo3Call = await prisma.callLog.findFirst({
    where: { callLogId }
  });
  
  if (demo3Call) {
    const existing = await prisma.callLog.findFirst({
      where: { companyId: mnhgfId, callLogId }
    });
    if (!existing) {
      console.log("Restoring call for schoolknot (MNHGF)...");
      const newCall = await prisma.callLog.create({
        data: {
          companyId: mnhgfId,
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
          phoneNumberId: '6a897a7e500636731c1f15dd' // schoolknot's phone number ID
        }
      });
      console.log("Restored:", newCall.id);
    } else {
      console.log("schoolknot already has the call.");
    }
  }
}
main().finally(()=>prisma.$disconnect());
