const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const result = await prisma.callLog.updateMany({
    where: { companyId: '6a841c0c82ee2da15e6dde19' },
    data: { companyId: '6a86c29fae5fc55d68a902e2' }
  });
  console.log('Migrated call logs:', result);
}
main().finally(() => prisma.$disconnect());
