import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function syncCalls() {
  const number = "07971501546";
  const user = await prisma.user.findFirst({
    where: { email: "satish@schoolknot.com" }
  });
  if (!user) { console.log("User not found!"); return; }
  
  const member = await prisma.companyMember.findFirst({
    where: { userId: user.id }
  });
  if (!member) { console.log("Member not found!"); return; }
  
  const subCompanyId = member.companyId;
  console.log("Sub company ID:", subCompanyId);
  
  // Find all calls for this number
  const matchingCalls = await prisma.callLog.findMany({
    where: {
      phoneNumber: { number: number },
      companyId: { not: subCompanyId }
    }
  });
  console.log(`Found ${matchingCalls.length} calls to backfill for schoolknot`);
  
  if (matchingCalls.length === 0) return;
  
  // Deduplicate calls by callLogId
  const uniqueCalls = new Map<string, any>();
  for (const call of matchingCalls) {
    if (call.callLogId) {
      uniqueCalls.set(call.callLogId, call);
    }
  }

  let totalCreditsToDeduct = 0;
  
  for (const call of Array.from(uniqueCalls.values())) {
    const credits = call.creditsUsed || 0;
    totalCreditsToDeduct += credits;

    // Clone it!
    const { id, ...callDataWithoutId } = call;
    await prisma.callLog.upsert({
      where: {
        companyId_callLogId: {
          companyId: subCompanyId,
          callLogId: call.callLogId,
        },
      },
      update: {
        ...callDataWithoutId,
        companyId: subCompanyId,
        publicId: call.publicId || call.callLogId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      create: {
        ...callDataWithoutId,
        companyId: subCompanyId,
        publicId: call.publicId || call.callLogId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }
  
  console.log(`Cloned ${uniqueCalls.size} calls! Total credits to deduct: ${totalCreditsToDeduct}`);
  
  // Deduct credits if > 0
  if (totalCreditsToDeduct > 0) {
    const currentBalance = await prisma.creditBalance.findUnique({
      where: { companyId: subCompanyId }
    });
    
    if (currentBalance) {
      await prisma.creditBalance.update({
        where: { companyId: subCompanyId },
        data: {
          creditsRemaining: { decrement: totalCreditsToDeduct },
          creditsUsed: { increment: totalCreditsToDeduct },
        }
      });
      console.log(`Deducted ${totalCreditsToDeduct} credits!`);
    } else {
      console.log("No credit balance record found for subcompany!");
    }
  }
  
  console.log("Backfill complete!");
}

syncCalls().catch(console.error).finally(() => prisma.$disconnect());
