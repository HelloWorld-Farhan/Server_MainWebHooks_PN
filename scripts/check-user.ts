import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
prisma.user.findFirst({ where: { email: 'farhankhalid17968@gmail.com' } }).then(c => console.log(JSON.stringify(c, null, 2))).finally(() => prisma.$disconnect());
