import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const p = await prisma.phoneNumber.findMany({ where: { number: { endsWith: '81' } } });
  console.log(p.map(x=>x.number));
}
main().finally(()=>prisma.$disconnect());
