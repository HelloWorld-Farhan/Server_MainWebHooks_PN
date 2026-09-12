const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Check the phone number record for this DID
  const nums = await prisma.phoneNumber.findMany({
    where: {
      OR: [
        { number: { contains: '7946350797' } },
        { number: { contains: '07946350797' } },
      ]
    }
  });
  console.log('Phone numbers found:', JSON.stringify(nums, null, 2));

  // Also check all phone numbers to see what agentUrls look like
  const allNums = await prisma.phoneNumber.findMany({
    select: { number: true, agentUrl: true, direction: true, companyId: true },
    take: 10
  });
  console.log('\nAll phone numbers (first 10):', JSON.stringify(allNums, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
