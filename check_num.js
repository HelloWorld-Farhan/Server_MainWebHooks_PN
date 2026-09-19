const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const num = await prisma.phoneNumber.findFirst({
    where: { number: '+917946350798' }
  });
  console.log(num);
}

main().finally(() => prisma.$disconnect());
