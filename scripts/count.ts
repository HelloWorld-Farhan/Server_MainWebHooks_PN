import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.callLog.count().then(c => console.log(c)).finally(() => prisma.$disconnect());
