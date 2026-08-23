import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const mnhgfId = '6a897a7c500636731c1f15da'; // schoolknot / MNHGF
  const schoolknotPhone = await prisma.phoneNumber.findFirst({ where: { companyId: mnhgfId, number: '07971501546' } });
  
  if (!schoolknotPhone) {
      console.log("No phone number found for schoolknot");
      return;
  }

  // Find all calls that belong to 07971501546 across ANY company
  const allCalls = await prisma.callLog.findMany({
     where: { phoneNumber: { number: '07971501546' } }
  });
  
  const distinctCallLogIds = Array.from(new Set(allCalls.map(c => c.callLogId)));
  console.log(`Found ${distinctCallLogIds.length} distinct calls for 07971501546.`);
  
  let restored = 0;
  for (const logId of distinctCallLogIds) {
    if (!logId) continue;
    const existingCopies = allCalls.filter(c => c.callLogId === logId);
    
    // Check if schoolknot already has it
    const hasCopy = existingCopies.some(c => c.companyId === mnhgfId);
    if (!hasCopy) {
        const prototypeCall = existingCopies[0];
        await prisma.callLog.create({
          data: {
            companyId: mnhgfId,
            callLogId: logId,
            publicId: prototypeCall.publicId,
            direction: prototypeCall.direction,
            status: prototypeCall.status,
            startedAt: prototypeCall.startedAt,
            durationSeconds: prototypeCall.durationSeconds,
            recordingUrl: prototypeCall.recordingUrl,
            transcriptUrl: prototypeCall.transcriptUrl,
            creditsUsed: prototypeCall.creditsUsed,
            provider: prototypeCall.provider,
            providerCallId: prototypeCall.providerCallId,
            providerWebhook: prototypeCall.providerWebhook as any,
            leadId: prototypeCall.leadId, // might belong to demo3 but that's fine
            phoneNumberId: schoolknotPhone.id
          }
        });
        restored++;
    }
  }
  
  console.log(`Successfully restored ${restored} calls into schoolknot.`);
}
main().finally(()=>prisma.$disconnect());
