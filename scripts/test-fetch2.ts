import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.callLog.findMany({ take: 5 }).then(c => console.log(JSON.stringify(c, null, 2))).finally(() => prisma.$disconnect());
