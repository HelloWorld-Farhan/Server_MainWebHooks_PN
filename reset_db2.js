const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

async function resetDB() {
  console.log("Starting DB Reset...");

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
  }

  // Set parentCompanyId = null to allow deletion
  await prisma.company.updateMany({
    data: { parentCompanyId: null }
  });

  // Delete all Companies except Archive
  const companyRes = await prisma.company.deleteMany({
    where: { id: { not: archive.id } }
  });
  console.log(`Deleted ${companyRes.count} Companies.`);

  console.log("DB Reset Complete! You can now sign up again as a fresh user.");
}

resetDB().catch(console.error).finally(() => prisma.$disconnect());
