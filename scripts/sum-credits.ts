import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.callLog.aggregate({ _sum: { creditsUsed: true } }).then(c => console.log(c)).finally(() => prisma.$disconnect());
