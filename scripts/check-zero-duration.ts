import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.callLog.count({ where: { durationSeconds: 0 } }).then(c => console.log(c)).finally(() => prisma.$disconnect());
