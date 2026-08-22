import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  // Check "Demmo" sub-company
  const demmo = await prisma.company.findFirst({
    where: { name: "Demmo" },
    include: {
      phoneNumbers: true,
      creditBalance: true,
    }
  });
  
  // Check "Demo2" sub-company
  const demo2 = await prisma.company.findFirst({
    where: { name: "Demo2" },
    include: {
      phoneNumbers: true,
      creditBalance: true,
    }
  });

  console.log("=== Demmo ===");
  console.log("ID:", demmo?.id);
  console.log("Status:", demmo?.status);
  console.log("Phone Numbers:", JSON.stringify(demmo?.phoneNumbers, null, 2));
  console.log("Credits:", demmo?.creditBalance);

  console.log("\n=== Demo2 ===");
  console.log("ID:", demo2?.id);
  console.log("Status:", demo2?.status);
  console.log("Phone Numbers:", JSON.stringify(demo2?.phoneNumbers, null, 2));
  console.log("Credits:", demo2?.creditBalance);

  // Also check recent calls for Demmo
  const calls = await prisma.callLog.findMany({
    where: { companyId: demmo?.id },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: { id: true, direction: true, status: true, companyId: true, phoneNumberId: true, startedAt: true }
  });
  console.log("\n=== Recent calls for Demmo ===");
  console.log(JSON.stringify(calls, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
