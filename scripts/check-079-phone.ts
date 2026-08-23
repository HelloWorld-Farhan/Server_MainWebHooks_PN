import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  console.log(await prisma.phoneNumber.findMany({ where: { number: '07971501546' } }));
}
main().finally(()=>prisma.$disconnect());
