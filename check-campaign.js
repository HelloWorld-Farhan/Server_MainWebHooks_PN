const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const campaigns = await prisma.outboundCampaign.findMany({
    orderBy: { createdAt: 'desc' },
    take: 1,
    include: { OutboundContact: true }
  });
  console.dir(campaigns, { depth: null });
}
main().catch(console.error).finally(() => prisma.$disconnect());
