import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const u = await prisma.user.findFirst({ include: { memberships: { include: { company: true } } }});
  console.log(u.memberships.map(m => m.company.name));
}
main().finally(()=>prisma.$disconnect());
