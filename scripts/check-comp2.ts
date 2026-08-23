import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const c = await prisma.company.findMany({ where: { id: { in: ['6a89507516a5038974cc4170', '6a8852d1a695f94ac2b2eff8'] } }}); 
  console.log(c.map(x=>({id:x.id, name:x.name, parentId:x.parentCompanyId})));
}
main().finally(()=>prisma.$disconnect());
