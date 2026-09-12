const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const ex = await prisma.campaignExecution.findFirst({
    orderBy: { createdAt: 'desc' },
  });
  console.log('Latest Execution:', ex);
}

main().catch(console.error).finally(() => prisma.$disconnect());
