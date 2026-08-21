const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
async function main() {
  const ph = await prisma.phoneNumber.findFirst({ where: { number: '07971501546' } });
  console.log('PhoneNumber Record:', ph);
  if (ph) {
    const callCount = await prisma.callLog.count({
      where: {
        phoneNumberId: ph.id,
        direction: 'INBOUND'
      }
    });
    console.log(`Inbound Calls in CallLog for ${ph.number}:`, callCount);
    console.log(`PhoneNumber.inboundCallsCount field:`, ph.inboundCallsCount);
  } else {
    console.log('Phone number record not found.');
  }
}
main().finally(() => prisma.$disconnect());
