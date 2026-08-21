const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const p = await prisma.phoneNumber.findMany({ select: { id: true, companyId: true, phoneNumberId: true, publicId: true } });
  console.log(p);
}
main().finally(() => prisma.$disconnect());
