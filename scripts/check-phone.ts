import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.phoneNumber.findMany().then(c => console.log(JSON.stringify(c, null, 2))).finally(() => prisma.$disconnect());
