const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();

async function check() {
  const nums = await prisma.phoneNumber.findMany({ where: { number: { contains: "07971501546" } } });
  console.log("Phone numbers:", JSON.stringify(nums, null, 2));
}
check().then(() => prisma.$disconnect());
