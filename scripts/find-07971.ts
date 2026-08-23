import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const calls = await prisma.callLog.findMany({
    include: { phoneNumber: true, lead: true },
    where: { 
      OR: [
        { phoneNumber: { number: { contains: '079' } } }
      ]
    }
  });
  console.log("Found calls with 07971:", calls.length);
  console.log(JSON.stringify(calls.map(c => ({
    id: c.id,
    companyId: c.companyId,
    startedAt: c.startedAt,
    phoneNumber: c.phoneNumber?.number,
    direction: c.direction
  })), null, 2));
}

main().finally(() => prisma.$disconnect());
