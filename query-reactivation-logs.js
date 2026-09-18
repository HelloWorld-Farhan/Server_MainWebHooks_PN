const { PrismaClient } = require('@prisma/client'); 
const prisma = new PrismaClient(); 

async function main() { 
  const logs = await prisma.callLog.findMany({ 
    where: { 
      direction: 'OUTBOUND', 
      correlationId: { startsWith: 'reactivation-' } 
    }, 
    select: { correlationId: true, startedAt: true }, 
    take: 20, 
    orderBy: { startedAt: 'asc' } 
  }); 
  console.log(JSON.stringify(logs, null, 2)); 
} 

main().catch(console.error).finally(() => prisma.$disconnect());
