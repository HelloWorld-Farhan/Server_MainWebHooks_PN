import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const c = await prisma.company.findMany({ where: { parentCompanyId: '6a89928d0069674051ad8a64' }});
  console.log("Subcompanies of MNHFG:", c.map(x => x.name));
}
main().finally(()=>prisma.$disconnect());
