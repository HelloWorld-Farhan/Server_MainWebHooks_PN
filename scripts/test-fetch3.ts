import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const number = "07971501546";
  const calls = await prisma.callLog.findMany({
    where: {
      phoneNumber: {
        number: number
      }
    }
  });
  console.log(`Found ${calls.length} calls using phoneNumber.number!`);
}
main().catch(console.error).finally(() => prisma.$disconnect());
