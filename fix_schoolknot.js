const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function fix() {
  const schoolKnotId = "6a87f72283ec91c0e34669db"; // from screenshot
  const numberToAssign = "07971501546";

  const company = await prisma.company.findUnique({ where: { id: schoolKnotId } });
  if (!company) {
    console.log("SchoolKnot not found!");
    return;
  }
  
  // Find the phone number
  const phoneNumber = await prisma.phoneNumber.findFirst({
    where: { number: numberToAssign }
  });

  if (!phoneNumber) {
    console.log("Phone number not found!");
    return;
  }
  
  const oldCompanyId = phoneNumber.companyId;
  console.log("Current company for number:", oldCompanyId);

  // Update phone number to schoolKnot
  await prisma.phoneNumber.update({
    where: { id: phoneNumber.id },
    data: { companyId: schoolKnotId }
  });
  console.log("Assigned number to schoolKnot.");

  // Transfer calls
  const calls = await prisma.callLog.findMany({
    where: { 
      companyId: oldCompanyId,
      direction: "INBOUND" 
    }
  });

  let transferredCalls = 0;
  let creditsToTransfer = 0;

  for (const call of calls) {
    // Check if call providerWebhook has the number
    let hasNumber = false;
    if (call.providerWebhook) {
      const p = call.providerWebhook;
      hasNumber = (p.callid === numberToAssign || p.calledno === numberToAssign || p.phone === numberToAssign || (p.message && p.message.call && p.message.call.phoneNumber === numberToAssign));
    }
    if (hasNumber || call.assignedNumber === numberToAssign) {
      await prisma.callLog.update({
        where: { id: call.id },
        data: { companyId: schoolKnotId }
      });
      transferredCalls++;
      creditsToTransfer += (call.creditsUsed || 0);
    }
  }
  
  console.log(`Transferred ${transferredCalls} calls and ${creditsToTransfer} credits.`);

  // Update credits
  if (creditsToTransfer > 0) {
    const parentCredit = await prisma.creditBalance.findUnique({ where: { companyId: oldCompanyId } });
    if (parentCredit) {
      await prisma.creditBalance.update({
        where: { companyId: oldCompanyId },
        data: { creditsUsed: { decrement: creditsToTransfer } }
      });
    }

    const childCredit = await prisma.creditBalance.findUnique({ where: { companyId: schoolKnotId } });
    if (childCredit) {
      await prisma.creditBalance.update({
        where: { companyId: schoolKnotId },
        data: { creditsUsed: { increment: creditsToTransfer } }
      });
    } else {
      await prisma.creditBalance.create({
        data: {
          companyId: schoolKnotId,
          creditsRemaining: 2000,
          creditsUsed: creditsToTransfer
        }
      });
    }
    console.log("Updated credit balances.");
  }

}

fix().finally(() => prisma.$disconnect());
