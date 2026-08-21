const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const allCalls = await prisma.callLog.findMany();
  const matchingCalls = allCalls.filter(call => {
    const str = JSON.stringify(call);
    return str.includes('07971501546');
  });
  console.log(JSON.stringify(matchingCalls, null, 2));
}
main().finally(() => prisma.$disconnect());
