import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.company.findMany({ select: { id: true, name: true } }).then(c => console.log(JSON.stringify(c, null, 2))).finally(() => prisma.$disconnect());
