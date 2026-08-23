import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const u = await prisma.user.findFirst({ where: { email: 'satish@schoolknot.com' }, include: { memberships: { include: { company: true } } } });
  console.log(u.memberships.map(m => ({ id: m.company.id, name: m.company.name, parentId: m.company.parentCompanyId, type: m.company.tenantType })));
}
main().finally(()=>prisma.$disconnect());
