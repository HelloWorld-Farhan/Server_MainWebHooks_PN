import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const c = await prisma.company.findMany({ where: { parentCompanyId: '6a897a7c500636731c1f15da' } });
  console.log(c.map(x=> ({ id: x.id, name: x.name, parentId: x.parentCompanyId })));
}
main().finally(()=>prisma.$disconnect());
