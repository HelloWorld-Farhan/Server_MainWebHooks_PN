const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const numbers = await prisma.phoneNumber.findMany({
    where: { companyId: { not: null } }
  });
  
  let totalUpdated = 0;
  for (const num of numbers) {
    const result = await prisma.$runCommandRaw({
      update: "CallLog",
      updates: [
        {
          q: {
            $or: [
              { "providerWebhook.callid": num.number },
              { "providerWebhook.calledno": num.number },
              { "providerWebhook.message.call.phoneNumber": num.number }
            ]
          },
          u: { $set: { companyId: { $oid: num.companyId } } },
          multi: true
        }
      ]
    });
    totalUpdated += result.nModified || 0;
  }
  console.log("Total call logs backfilled:", totalUpdated);
}
main();
