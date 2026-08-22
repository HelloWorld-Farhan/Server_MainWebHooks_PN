import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("Checking recent call logs...");
  const recentLogs = await prisma.callLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      company: {
        select: {
          name: true,
          tenantType: true
        }
      },
      phoneNumber: {
        select: {
          number: true
        }
      }
    }
  });

  console.log(JSON.stringify(recentLogs, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
