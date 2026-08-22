import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.callLog.findMany({ select: { durationSeconds: true, creditsUsed: true }, take: 10 }).then(c => console.log(JSON.stringify(c, null, 2))).finally(() => prisma.$disconnect());
