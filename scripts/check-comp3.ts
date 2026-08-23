import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const c = await prisma.company.findUnique({ where: { id: '6a8849a633c16567e76a58e7' } });
  console.log(c);
}
main().finally(()=>prisma.$disconnect());
