const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 

async function check() { 
  const calls = await prisma.callLog.findRaw({
    filter: {
      $or: [
        { "providerWebhook.callid": { $regex: '9429390110' } },
        { "providerWebhook.calledno": { $regex: '9429390110' } },
        { "providerWebhook.message.call.phoneNumber": { $regex: '9429390110' } },
        { "providerWebhook.phone": { $regex: '9429390110' } }
      ]
    }
  });
  console.log("Found", calls.length, "calls");
  if (calls.length > 0) {
      console.log(calls[0]);
  }
} 

check().finally(() => { prisma.$disconnect(); });
