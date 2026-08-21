const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function test() {
  try {
    const parentCompanyId = '6a86f276cc43528d28d018db'; // Parent company ID
    const childCompanyId = '6a86f276cc43528d28d018dc'; // Child company ID (I'll find one)
    
    // First let's find a valid child company
    const child = await prisma.company.findFirst({
        where: { parentCompanyId }
    });
    if (!child) {
        console.log('No child company found');
        return;
    }
    console.log('Using child company:', child.id);

    const amount = 100;
    
    const result = await prisma.$transaction(async (tx) => {
        const parentCredit = await tx.creditBalance.findUnique({
          where: { companyId: parentCompanyId }
        });
        if (!parentCredit || parentCredit.creditsRemaining < amount) {
          throw new Error("Insufficient credits in main company");
        }
        await tx.creditBalance.update({
          where: { id: parentCredit.id },
          data: { creditsRemaining: { decrement: amount } }
        });
        const childCredit = await tx.creditBalance.upsert({
          where: { companyId: child.id },
          create: {
            companyId: child.id,
            creditsRemaining: amount,
            creditsUsed: 0
          },
          update: {
            creditsRemaining: { increment: amount }
          }
        });
        return childCredit;
    });
    console.log('Success, child balance:', result);
  } catch (e) {
    console.error('Error:', e);
  } finally {
    await prisma.$disconnect();
  }
}
test();
