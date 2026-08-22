import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.company.findFirst({ where: { name: 'Developer_Test' }, include: { creditBalance: true } }).then(c => console.log(JSON.stringify(c, null, 2))).finally(() => prisma.$disconnect());
