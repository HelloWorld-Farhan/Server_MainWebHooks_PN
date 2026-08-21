const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function check() {
  const subCompanies = await prisma.company.findMany({
    where: { parentCompanyId: "6a8754a83fb48f8c3bce4153" },
    include: {
      creditBalance: true,
      phoneNumbers: true,
      callLogs: {
        where: { direction: "INBOUND" },
      },
      _count: {
        select: { callLogs: true }
      }
    }
  });

  const formatted = subCompanies.map((c) => ({
    _id: c.id,
    companyName: c.name,
    companyEmail: "", 
    contactPhone: c.phoneNumbers?.[0]?.number || "",
    status: c.status.toLowerCase(),
    createdAt: c.createdAt.toISOString(),
    creditsUsed: c.creditBalance?.creditsUsed || 0,
    creditsRemaining: c.creditBalance?.creditsRemaining || 0,
    inboundCalls: c.callLogs?.length || 0,
    outboundCalls: (c._count?.callLogs || 0) - (c.callLogs?.length || 0)
  }));
  console.log(JSON.stringify(formatted, null, 2));
}

check().finally(() => prisma.$disconnect());
