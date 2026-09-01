import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const companies = await prisma.company.findMany({
    include: { creditBalance: true }
  });

  for (const company of companies) {
    if (!company.creditBalance) continue;
    
    const callLogs = await prisma.callLog.findMany({
      where: { companyId: company.id }
    });

    let totalCreditsUsed = 0;
    for (const log of callLogs) {
      totalCreditsUsed += log.creditsUsed || 0;
    }

    // Also include manual deductions made by admins
    const manualUsages = await prisma.creditUsage.findMany({
      where: { companyId: company.id, reason: "MANUAL_ADJUSTMENT" }
    });
    for (const usage of manualUsages) {
      totalCreditsUsed += usage.amount || 0;
    }

    if (totalCreditsUsed !== company.creditBalance.creditsUsed) {
      console.log(`Company ${company.name}: updating credits used from ${company.creditBalance.creditsUsed} to ${totalCreditsUsed}`);
      
      // We also need to fix creditsRemaining?
      // Since they bought X credits (allocatedCredits or total credits?), 
      // the remaining should probably just be re-calculated or we just decrement remaining by the difference.
      
      const diff = totalCreditsUsed - company.creditBalance.creditsUsed;
      
      await prisma.creditBalance.update({
        where: { id: company.creditBalance.id },
        data: {
          creditsUsed: totalCreditsUsed,
          creditsRemaining: { decrement: diff }
        }
      });
      console.log(`Decremented creditsRemaining by ${diff}`);
    }
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
