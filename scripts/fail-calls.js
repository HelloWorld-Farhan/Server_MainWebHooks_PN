const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  for (const s of ['IN_PROGRESS', 'RINGING', 'QUEUED', 'PENDING']) {
    try {
      const res = await prisma.callLog.updateMany({
        where: { status: s },
        data: { status: 'FAILED' }
      });
      console.log(`Updated ${res.count} calls for status ${s}`);
    } catch (e) {
      console.log(`Failed to update ${s}`);
    }
  }
  
  try {
    const execs = await prisma.campaignExecution.findMany({
      where: { status: { in: ['RUNNING', 'SCHEDULED'] } }
    });
    console.log('Campaign Executions running:', execs.map(e => e.id));

    const outb = await prisma.outboundCampaign.findMany({
      where: { status: 'ACTIVE' }
    });
    console.log('Outbound Campaigns active:', outb.map(o => o.id));

  } catch (e) {
    console.log('Error fetching campaigns', e.message);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
