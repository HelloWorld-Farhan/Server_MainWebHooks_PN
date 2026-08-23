import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const allCalls = await prisma.callLog.findMany();
  const calls079 = allCalls.filter(c => {
    const w = c.providerWebhook as any;
    if (!w) return false;
    const num = w.callid || w.calledno || w.message?.call?.customer?.number || w.message?.call?.phoneNumber || "";
    return num.includes("07971501546");
  });
  
  // Find all distinct callLogIds for 079
  const distinctCallLogIds = Array.from(new Set(calls079.map(c => c.callLogId)));
  console.log("Total 079 distinct webhook calls:", distinctCallLogIds.length);
  
  // For each distinct callLogId, ensure ALL companies that have 079 assigned have a copy
  const phoneNumbers = await prisma.phoneNumber.findMany({ where: { number: '07971501546' } });
  
  for (const logId of distinctCallLogIds) {
    if (!logId) continue;
    const existingCopies = calls079.filter(c => c.callLogId === logId);
    const prototypeCall = existingCopies[0];
    
    for (const p of phoneNumbers) {
      if (!p.companyId) continue;
      const hasCopy = existingCopies.some(c => c.companyId === p.companyId);
      if (!hasCopy) {
        console.log(`Restoring call ${logId} for company ${p.companyId}`);
        await prisma.callLog.create({
          data: {
            companyId: p.companyId,
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
            leadId: prototypeCall.leadId,
            phoneNumberId: p.id
          }
        });
      }
    }
  }
}
main().finally(()=>prisma.$disconnect());
