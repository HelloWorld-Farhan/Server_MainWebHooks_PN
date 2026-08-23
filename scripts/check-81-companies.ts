import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const p = await prisma.phoneNumber.findMany({ where: { number: { endsWith: '81' } } });
  console.log(p.map(x=> ({ id: x.id, companyId: x.companyId, number: x.number })));
}
main().finally(()=>prisma.$disconnect());
