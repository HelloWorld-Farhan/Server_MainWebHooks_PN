const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

async function resetDB() {
  console.log("Starting DB Reset...");

  // 1. Find or create Archive Company
  let archive = await prisma.company.findFirst({ where: { slug: "archive-holding" } });
  if (!archive) {
    archive = await prisma.company.create({
      data: {
        name: "Archive Holding",
        slug: "archive-holding",
        contractId: "ARCHIVE123",
        cli: "ARCH",
        companyCode: "ARCH",
        status: "ACTIVE"
      }
    });
    console.log("Created Archive Company:", archive.id);
  }

  // 2. Move all PhoneNumbers individually to avoid unique constraint
  const phones = await prisma.phoneNumber.findMany({
    where: { companyId: { not: archive.id } }
  });
  let pCount = 0;
  for (const phone of phones) {
    try {
      await prisma.phoneNumber.update({
        where: { id: phone.id },
        data: { companyId: archive.id, phoneNumberId: phone.phoneNumberId + "_" + crypto.randomBytes(4).toString('hex') }
      });
      pCount++;
    } catch (e) {
      console.log("Failed to move phone:", phone.id, e.message);
    }
  }
  console.log(`Moved ${pCount} PhoneNumbers to Archive.`);

  // 3. Move all CallLogs to Archive
  const callRes = await prisma.callLog.updateMany({
    where: { companyId: { not: archive.id } },
    data: { companyId: archive.id }
  });
  console.log(`Moved ${callRes.count} CallLogs to Archive.`);

  // 4. Delete all Users (Cascades to CompanyMember, etc.)
  const userRes = await prisma.user.deleteMany({});
  console.log(`Deleted ${userRes.count} Users.`);

  // 5. Delete all PendingApprovals and SupportRequests
  await prisma.pendingApproval.deleteMany({});
  await prisma.supportRequest.deleteMany({});
  console.log("Cleared PendingApprovals and SupportRequests.");

  // 6. Delete all Companies except Archive
  const companyRes = await prisma.company.deleteMany({
    where: { id: { not: archive.id } }
  });
  console.log(`Deleted ${companyRes.count} Companies.`);

  console.log("DB Reset Complete! You can now sign up again as a fresh user.");
}

resetDB().catch(console.error).finally(() => prisma.$disconnect());
