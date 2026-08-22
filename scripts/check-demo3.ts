import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.company.findFirst({ where: { name: 'Demo3' } }).then(c => console.log(JSON.stringify(c, null, 2))).finally(() => prisma.$disconnect());
