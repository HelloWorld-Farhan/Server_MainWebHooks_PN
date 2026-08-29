const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Get the RINGING webhook call (the duplicate) from 03:11
  const duplicateCall = await prisma.callLog.findFirst({
    where: {
      direction: 'OUTBOUND',
      provider: 'webhook',
      createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) }
    },
    orderBy: { createdAt: 'desc' }
  });

  if (!duplicateCall) {
    console.log('No duplicate found in last 15 mins');
    return;
  }
  
  console.log('=== DUPLICATE CALL (webhook-created) ===');
  console.log('callLogId:', duplicateCall.callLogId);
  console.log('status:', duplicateCall.status);
  const wh = duplicateCall.providerWebhook;
  if (wh && wh.call) {
    console.log('event:', wh.event);
    console.log('callObj.direction:', wh.call.direction);
    console.log('callObj.callType:', wh.call.callType);
    console.log('callObj.from:', wh.call.from);
    console.log('callObj.to:', wh.call.to);
    console.log('customParameters:', JSON.stringify(wh.call.customParameters));
    console.log('FULL wh.call:', JSON.stringify(wh.call, null, 2));
  }
}

main()
  .catch(console.error)
  .finally(async () => await prisma.$disconnect());
