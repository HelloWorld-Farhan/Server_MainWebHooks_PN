import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
  const user = await prisma.user.findUnique({ where: { email: 'farhanthehero13@gmail.com' } });
  if (!user) return console.log("User not found");
  
  const member = await prisma.companyMember.findFirst({
    where: { userId: user.id },
    include: { company: true }
  });
  if (!member) return console.log("No company member");
  
  console.log("Company ID:", member.companyId);
  const phones = await prisma.phoneNumber.findMany({
    where: { companyId: member.companyId }
  });
  console.log("Phones:", phones);
}
check().finally(() => prisma.$disconnect());
