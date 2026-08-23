import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const allCalls = await prisma.callLog.findMany({
     where: { phoneNumber: { number: '07971501546' } },
     include: { company: true }
  });
  
  const directions = new Map();
  for (const c of allCalls) {
      if (!directions.has(c.direction)) directions.set(c.direction, 0);
      directions.set(c.direction, directions.get(c.direction) + 1);
  }
  console.log("Directions:", directions);
  
  const companies = new Map();
  for (const c of allCalls) {
      const name = c.company?.name || c.companyId;
      if (!companies.has(name)) companies.set(name, 0);
      companies.set(name, companies.get(name) + 1);
  }
  console.log("Companies:", companies);
}
main().finally(()=>prisma.$disconnect());
