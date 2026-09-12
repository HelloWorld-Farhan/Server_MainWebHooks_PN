require('dotenv').config({ path: '/root/propnexai-main-server/.env' });
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function run() {
  // Find all outbound phone numbers and their companies
  const phones = await prisma.phoneNumber.findMany({
    where: { direction: 'OUTBOUND' },
    select: { number: true, agentUrl: true, companyId: true, status: true }
  });
  console.log('All OUTBOUND numbers:');
  console.log(JSON.stringify(phones, null, 2));

  // Find the company that owns 07946350797
  const thePhone = phones.find(p => p.number.includes('7946350797'));
  if (thePhone) {
    const company = await prisma.company.findFirst({ 
      where: { id: thePhone.companyId },
      select: { id: true, name: true, parentCompanyId: true }
    });
    console.log('\nCompany owning this DID:', JSON.stringify(company, null, 2));
  }
}
run().catch(e => { console.error(e.message); }).finally(() => prisma.$disconnect());
