const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const latestCampaign = await prisma.campaign.findFirst({
    orderBy: { createdAt: 'desc' },
  });
  console.log('Latest Campaign:', latestCampaign);
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
