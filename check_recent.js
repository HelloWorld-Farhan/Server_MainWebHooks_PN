const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 

async function check() { 
  const calls = await prisma.callLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 10
  });
  console.log("Recent calls:");
  for (const c of calls) {
      console.log(c.direction, c.status, c.createdAt, JSON.stringify(c.providerWebhook).substring(0, 150));
  }
} 

check().finally(() => { prisma.$disconnect(); });
