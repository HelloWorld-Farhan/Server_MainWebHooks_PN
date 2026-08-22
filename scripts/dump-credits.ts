import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.creditBalance.findMany().then(c => console.log(JSON.stringify(c, null, 2))).finally(() => prisma.$disconnect());
